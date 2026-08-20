import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import { PresignTemplateUploadDto } from './dto/presign-template-upload.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import {
  TEMPLATE_LIBRARY_ALLOWED_EXTENSIONS,
  TEMPLATE_LIBRARY_KEY_PREFIX,
  TEMPLATE_LIBRARY_MAX_FILE_SIZE_BYTES,
  isAllowedTemplateExtension,
} from './template-library.constants';

@Injectable()
export class TemplateLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async presignUpload(dto: PresignTemplateUploadDto) {
    this.assertAllowedExtension(dto.fileName);
    return this.storage.presignUpload({
      keyPrefix: TEMPLATE_LIBRARY_KEY_PREFIX,
      fileName: dto.fileName,
      contentType: dto.contentType,
    });
  }

  async create(dto: CreateTemplateDto, actor: AuthenticatedUser) {
    this.assertAllowedExtension(dto.originalName);

    if (dto.fileSize > TEMPLATE_LIBRARY_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File exceeds the maximum allowed size of ${TEMPLATE_LIBRARY_MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }

    const exists = await this.storage.objectExists(dto.key);
    if (!exists) {
      throw new BadRequestException(
        'Uploaded object not found in storage — upload it before confirming',
      );
    }

    const file = await this.prisma.templateLibraryFile.create({
      data: {
        name: dto.name,
        description: dto.description,
        originalName: dto.originalName,
        storageKey: dto.key,
        mimeType: dto.mimeType,
        fileSize: dto.fileSize,
        uploadedById: actor.id,
      },
    });
    await this.auditService.record({
      eventType: 'RESOURCE_CREATED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'TEMPLATE',
      resourceId: file.id,
    });
    return file;
  }

  async findAll(query: ListTemplatesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.TemplateLibraryFileWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { originalName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.templateLibraryFile.count({ where }),
      this.prisma.templateLibraryFile.findMany({
        where,
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, total, page, limit };
  }

  async update(id: string, dto: UpdateTemplateDto, user: AuthenticatedUser) {
    const file = await this.findOrThrow(id);
    if (user.role === Role.INSTRUCTOR && file.uploadedById !== user.id) {
      throw new ForbiddenException('Instructors can only edit templates they uploaded');
    }
    return this.prisma.templateLibraryFile.update({ where: { id }, data: dto });
  }

  async getDownloadUrl(id: string) {
    const file = await this.findOrThrow(id);
    const downloadUrl = await this.storage.presignDownload({
      key: file.storageKey,
      downloadFileName: file.originalName,
    });
    return { downloadUrl };
  }

  // ADMIN-only at the controller level — re-validated here regardless of the
  // guard, and the R2 delete is awaited before the Postgres row is removed so
  // a storage failure aborts the whole operation instead of faking success.
  async remove(id: string, actor: AuthenticatedUser) {
    const file = await this.findOrThrow(id);
    await this.storage.delete(file.storageKey);
    await this.prisma.templateLibraryFile.delete({ where: { id } });
    await this.auditService.record({
      eventType: 'RESOURCE_DELETED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'TEMPLATE',
      resourceId: id,
    });
    return { deleted: true };
  }

  private assertAllowedExtension(fileName: string) {
    if (!isAllowedTemplateExtension(fileName)) {
      throw new BadRequestException(
        `File type not allowed. Allowed extensions: ${TEMPLATE_LIBRARY_ALLOWED_EXTENSIONS.join(', ')}`,
      );
    }
  }

  private async findOrThrow(id: string) {
    const file = await this.prisma.templateLibraryFile.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException('Template file not found');
    }
    return file;
  }
}
