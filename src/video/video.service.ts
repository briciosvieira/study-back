import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { nextOrderLabel, parseOrderLabel } from '../common/utils/ordering.util';
import { ContentAccessService } from '../modules/content-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateVideoItemDto } from './dto/create-video-item.dto';
import { PresignVideoUploadDto } from './dto/presign-video-upload.dto';
import { ReorderVideoDto } from './dto/reorder-video.dto';

@Injectable()
export class VideoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly contentAccess: ContentAccessService,
    private readonly auditService: AuditService,
  ) {}

  async findAllForModule(moduleId: string, user: AuthenticatedUser) {
    await this.contentAccess.getAccessibleModule(moduleId, user);
    return this.prisma.videoItem.findMany({
      where: { moduleId },
      orderBy: { orderNum: 'asc' },
    });
  }

  async presignUpload(moduleId: string, dto: PresignVideoUploadDto) {
    const targetModule = await this.findModuleOrThrow(moduleId);
    return this.storage.presignUpload({
      keyPrefix: `courses/${targetModule.courseId}/modules/${moduleId}/video`,
      fileName: dto.fileName,
      contentType: dto.contentType,
    });
  }

  async create(moduleId: string, dto: CreateVideoItemDto, actor: AuthenticatedUser) {
    await this.findModuleOrThrow(moduleId);

    const exists = await this.storage.objectExists(dto.key);
    if (!exists) {
      throw new BadRequestException(
        'Uploaded object not found in storage — upload it before confirming',
      );
    }

    const orderLabel = dto.orderLabel ?? (await this.nextOrderLabel(moduleId));

    const item = await this.prisma.videoItem.create({
      data: {
        moduleId,
        title: dto.title,
        fileKey: dto.key,
        fileUrl: this.storage.getPublicUrl(dto.key),
        durationSec: dto.durationSec,
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
      resourceType: 'VIDEO',
      resourceId: item.id,
    });
    return item;
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const item = await this.findOrThrow(id);
    if (item.fileKey) {
      await this.storage.delete(item.fileKey);
    }
    await this.prisma.videoItem.delete({ where: { id } });
    await this.auditService.record({
      eventType: 'RESOURCE_DELETED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'VIDEO',
      resourceId: id,
    });
    return { deleted: true };
  }

  async reorder(id: string, dto: ReorderVideoDto) {
    await this.findOrThrow(id);
    return this.prisma.videoItem.update({
      where: { id },
      data: {
        orderLabel: dto.orderLabel,
        orderNum: parseOrderLabel(dto.orderLabel),
      },
    });
  }

  private async findOrThrow(id: string) {
    const item = await this.prisma.videoItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('Video item not found');
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
    const last = await this.prisma.videoItem.findFirst({
      where: { moduleId },
      orderBy: { orderNum: 'desc' },
      select: { orderNum: true },
    });
    return nextOrderLabel(last?.orderNum ?? null);
  }
}
