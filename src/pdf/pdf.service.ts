import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { parseOrderLabel } from '../common/utils/ordering.util';
import { ContentAccessService } from '../modules/content-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreatePdfItemDto } from './dto/create-pdf-item.dto';
import { PresignPdfUploadDto } from './dto/presign-pdf-upload.dto';
import { ReorderPdfDto } from './dto/reorder-pdf.dto';

@Injectable()
export class PdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly contentAccess: ContentAccessService,
  ) {}

  async findAllForModule(moduleId: string, user: AuthenticatedUser) {
    await this.contentAccess.getAccessibleModule(moduleId, user);
    return this.prisma.pdfItem.findMany({
      where: { moduleId },
      orderBy: { orderNum: 'asc' },
    });
  }

  async presignUpload(moduleId: string, dto: PresignPdfUploadDto) {
    const targetModule = await this.findModuleOrThrow(moduleId);
    return this.storage.presignUpload({
      keyPrefix: `courses/${targetModule.courseId}/modules/${moduleId}/pdf`,
      fileName: dto.fileName,
      contentType: dto.contentType,
    });
  }

  async create(moduleId: string, dto: CreatePdfItemDto) {
    await this.findModuleOrThrow(moduleId);

    const exists = await this.storage.objectExists(dto.key);
    if (!exists) {
      throw new BadRequestException(
        'Uploaded object not found in storage — upload it before confirming',
      );
    }

    return this.prisma.pdfItem.create({
      data: {
        moduleId,
        title: dto.title,
        fileKey: dto.key,
        fileUrl: this.storage.getPublicUrl(dto.key),
        orderLabel: dto.orderLabel,
        orderNum: parseOrderLabel(dto.orderLabel),
      },
    });
  }

  async remove(id: string) {
    const item = await this.findOrThrow(id);
    await this.storage.delete(item.fileKey);
    await this.prisma.pdfItem.delete({ where: { id } });
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
}
