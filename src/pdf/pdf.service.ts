import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import {
  buildDownloadFileName,
  deriveFileNameFromKey,
} from '../common/utils/storage-filename.util';
import { nextOrderLabel, parseOrderLabel } from '../common/utils/ordering.util';
import { ContentAccessService } from '../modules/content-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreatePdfItemDto } from './dto/create-pdf-item.dto';
import { PresignPdfUploadDto } from './dto/presign-pdf-upload.dto';
import { ReorderPdfDto } from './dto/reorder-pdf.dto';
import { UpdatePdfItemDto } from './dto/update-pdf-item.dto';

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly contentAccess: ContentAccessService,
    private readonly auditService: AuditService,
  ) {}

  async findAllForModule(moduleId: string, user: AuthenticatedUser) {
    await this.contentAccess.getAccessibleModule(moduleId, user);
    const items = await this.prisma.pdfItem.findMany({
      where: { moduleId },
      orderBy: { orderNum: 'asc' },
    });
    return items.map((item) => ({
      ...item,
      fileName: deriveFileNameFromKey(item.fileKey),
    }));
  }

  async presignUpload(moduleId: string, dto: PresignPdfUploadDto) {
    const targetModule = await this.findModuleOrThrow(moduleId);
    return this.storage.presignUpload({
      keyPrefix: `courses/${targetModule.courseId}/modules/${moduleId}/pdf`,
      fileName: dto.fileName,
      contentType: dto.contentType,
    });
  }

  async create(moduleId: string, dto: CreatePdfItemDto, actor: AuthenticatedUser) {
    await this.findModuleOrThrow(moduleId);

    const exists = await this.storage.objectExists(dto.key);
    if (!exists) {
      throw new BadRequestException(
        'Uploaded object not found in storage — upload it before confirming',
      );
    }

    const orderLabel = dto.orderLabel ?? (await this.nextOrderLabel(moduleId));

    const item = await this.prisma.pdfItem.create({
      data: {
        moduleId,
        title: dto.title,
        fileKey: dto.key,
        fileUrl: this.storage.getPublicUrl(dto.key),
        orderLabel,
        orderNum: parseOrderLabel(orderLabel),
      },
    });
    await this.auditService.record({
      eventType: 'RESOURCE_CREATED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'PDF',
      resourceId: item.id,
    });
    return item;
  }

  // Same key-prefix pattern as the original upload — presignUpload always
  // mints a brand-new randomUUID()-prefixed key, so the replacement never
  // reuses the old object key (avoids student browsers/CDN caching the
  // stale file under an unchanged URL).
  async presignReplace(id: string, dto: PresignPdfUploadDto) {
    const item = await this.findOrThrow(id);
    const targetModule = await this.findModuleOrThrow(item.moduleId);
    return this.storage.presignUpload({
      keyPrefix: `courses/${targetModule.courseId}/modules/${item.moduleId}/pdf`,
      fileName: dto.fileName,
      contentType: dto.contentType,
    });
  }

  // Updates the SAME PdfItem row in place — id, orderLabel/orderNum,
  // moduleId are never touched, so every existing reference (Cronograma,
  // StudySession history, direct links) keeps pointing at the right item.
  // File replacement order: confirm the new object exists in storage FIRST,
  // then update the DB, and only delete the old object AFTER the DB update
  // succeeds — a failure at any step leaves the previous, working file in
  // place rather than a broken record.
  async update(id: string, dto: UpdatePdfItemDto, actor: AuthenticatedUser) {
    const item = await this.findOrThrow(id);

    const isReplacingFile = dto.fileKey !== undefined && dto.fileKey !== item.fileKey;
    if (isReplacingFile) {
      const exists = await this.storage.objectExists(dto.fileKey!);
      if (!exists) {
        throw new BadRequestException(
          'Uploaded object not found in storage — upload it before confirming',
        );
      }
    }

    let updated;
    try {
      updated = await this.prisma.pdfItem.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          ...(isReplacingFile && {
            fileKey: dto.fileKey,
            fileUrl: this.storage.getPublicUrl(dto.fileKey!),
          }),
        },
      });
    } catch (err) {
      if (isReplacingFile) {
        // best-effort cleanup of the orphaned new upload — the DB still
        // points at the old (working) file, so the user is never left
        // with a broken record because of this
        await this.storage.delete(dto.fileKey!).catch((cleanupErr) => {
          this.logger.warn(
            `Failed to clean up orphaned PDF upload ${dto.fileKey} after a failed update for ${id}: ${cleanupErr}`,
          );
        });
      }
      throw err;
    }

    if (isReplacingFile) {
      await this.storage.delete(item.fileKey).catch((cleanupErr) => {
        // best-effort — the new file is already live and the DB already
        // points to it, so a stale object left in R2 is a cleanup concern,
        // not a reason to fail a request that already succeeded
        this.logger.warn(
          `Failed to delete replaced PDF object ${item.fileKey} for ${id}: ${cleanupErr}`,
        );
      });
    }

    await this.auditService.record({
      eventType: isReplacingFile ? 'RESOURCE_FILE_REPLACED' : 'RESOURCE_UPDATED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'PDF',
      resourceId: id,
    });

    return { ...updated, fileName: deriveFileNameFromKey(updated.fileKey) };
  }

  async getDownloadUrl(id: string) {
    const item = await this.findOrThrow(id);
    const downloadUrl = await this.storage.presignDownload({
      key: item.fileKey,
      downloadFileName: buildDownloadFileName(item.title, item.fileKey),
    });
    return { downloadUrl };
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const item = await this.findOrThrow(id);
    await this.storage.delete(item.fileKey);
    await this.prisma.pdfItem.delete({ where: { id } });
    await this.auditService.record({
      eventType: 'RESOURCE_DELETED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'PDF',
      resourceId: id,
    });
    return { deleted: true };
  }

  async reorder(id: string, dto: ReorderPdfDto) {
    await this.findOrThrow(id);
    return this.prisma.pdfItem.update({
      where: { id },
      data: {
        orderLabel: dto.orderLabel,
        orderNum: parseOrderLabel(dto.orderLabel),
      },
    });
  }

  private async findOrThrow(id: string) {
    const item = await this.prisma.pdfItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('PDF item not found');
    }
    return item;
  }

  private async findModuleOrThrow(moduleId: string) {
    const targetModule = await this.prisma.module.findUnique({
      where: { id: moduleId },
    });
    if (!targetModule) {
      throw new NotFoundException('Module not found');
    }
    return targetModule;
  }

  private async nextOrderLabel(moduleId: string): Promise<string> {
    const last = await this.prisma.pdfItem.findFirst({
      where: { moduleId },
      orderBy: { orderNum: 'desc' },
      select: { orderNum: true },
    });
    return nextOrderLabel(last?.orderNum ?? null);
  }
}
