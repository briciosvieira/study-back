import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { CreatePdfItemDto } from './dto/create-pdf-item.dto';
import { PresignPdfUploadDto } from './dto/presign-pdf-upload.dto';
import { ReorderPdfDto } from './dto/reorder-pdf.dto';
import { PdfService } from './pdf.service';

@ApiTags('pdf')
@Controller()
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get('modules/:moduleId/pdf')
  findAll(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pdfService.findAllForModule(moduleId, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post('modules/:moduleId/pdf/presign-upload')
  presignUpload(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @Body() dto: PresignPdfUploadDto,
  ) {
    return this.pdfService.presignUpload(moduleId, dto);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post('modules/:moduleId/pdf')
  create(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @Body() dto: CreatePdfItemDto,
  ) {
    return this.pdfService.create(moduleId, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('pdf/:id')
  remove(@Param('id', ParseUuidPipe) id: string) {
    return this.pdfService.remove(id);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Patch('pdf/:id/reorder')
  reorder(@Param('id', ParseUuidPipe) id: string, @Body() dto: ReorderPdfDto) {
    return this.pdfService.reorder(id, dto);
  }
}
