import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CoursesService } from '../courses/courses.service';
import { mapUniqueConstraintError } from '../common/utils/prisma-errors.util';
import { PrismaService } from '../prisma/prisma.service';
import { StudyTreeExcelService } from './study-tree-excel.service';

const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

// The whole import is validated in memory first and only ever written as a
// single all-or-nothing transaction — see spec section 24. Deliberately
// synchronous (no BullMQ job/polling, unlike the quiz question importer):
// a tree import is one StudyTree row plus one createMany for its nodes, not
// hundreds of individual per-row writes, so there's no need for background
// processing here.
@Injectable()
export class StudyTreeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
    private readonly auditService: AuditService,
    private readonly excelService: StudyTreeExcelService,
  ) {}

  async importTree(courseId: string, file: Express.Multer.File | undefined, actor: AuthenticatedUser) {
    await this.coursesService.findOne(courseId, actor);

    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado (campo esperado: "file").');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('O arquivo precisa ser uma planilha .xlsx.');
    }

    const existing = await this.prisma.studyTree.findUnique({ where: { courseId } });
    if (existing) {
      throw new BadRequestException(
        'Este curso já possui uma Árvore de Estudos. Exclua a árvore atual antes de importar uma nova.',
      );
    }

    let rows;
    try {
      rows = await this.excelService.parseWorkbook(file.buffer);
    } catch (error) {
      throw new BadRequestException(
        `Não foi possível ler a planilha: ${(error as Error).message}`,
      );
    }

    const errors = this.excelService.validateRows(rows);
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    // Pre-generated so parentId can be resolved to a real id before a single
    // createMany — avoids one query per row (see spec section 60).
    const idByCode = new Map(rows.map((row) => [row.nodeCode, randomUUID()]));
    const treeId = randomUUID();

    try {
      const { nodeCount } = await this.prisma.$transaction(async (tx) => {
        await tx.studyTree.create({
          data: { id: treeId, courseId, createdById: actor.id },
        });

        await tx.studyTreeNode.createMany({
          data: rows.map((row) => ({
            id: idByCode.get(row.nodeCode)!,
            treeId,
            code: row.nodeCode,
            parentId: row.parentCode ? (idByCode.get(row.parentCode) ?? null) : null,
            title: row.title,
            order: row.order,
          })),
        });

        return { nodeCount: rows.length };
      });

      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { title: true },
      });

      await this.auditService.record({
        eventType: 'STUDY_TREE_IMPORTED',
        category: 'CONTENT',
        severity: 'INFO',
        actorUserId: actor.id,
        actorName: actor.name,
        resourceType: 'STUDY_TREE',
        resourceId: treeId,
        metadata: { courseId, courseTitle: course?.title ?? null, nodeCount },
      });

      const rootCount = rows.filter((r) => !r.parentCode).length;
      const leafCount = rows.filter(
        (r) => !rows.some((other) => other.parentCode === r.nodeCode),
      ).length;

      return { treeId, nodeCount, rootCount, leafCount };
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }
  }

  generateTemplate(): Promise<Buffer> {
    return this.excelService.generateTemplateBuffer();
  }
}
