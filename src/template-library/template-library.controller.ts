import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import { PresignTemplateUploadDto } from './dto/presign-template-upload.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplateLibraryService } from './template-library.service';

// STUDENT never reaches any route here: the class-level @Roles below is the
// backend-enforced gate (403 regardless of what the frontend hides), delete
// is further restricted to ADMIN only at the method level.
@ApiTags('template-library')
@Roles(Role.ADMIN, Role.INSTRUCTOR)
@Controller('template-library')
export class TemplateLibraryController {
  constructor(private readonly templateLibraryService: TemplateLibraryService) {}

  @Get()
  findAll(@Query() query: ListTemplatesQueryDto) {
    return this.templateLibraryService.findAll(query);
  }

  @Post('presign-upload')
  presignUpload(@Body() dto: PresignTemplateUploadDto) {
    return this.templateLibraryService.presignUpload(dto);
  }

  @Post()
  create(@Body() dto: CreateTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templateLibraryService.create(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templateLibraryService.update(id, dto, user);
  }

  @Get(':id/download')
  getDownloadUrl(@Param('id', ParseUuidPipe) id: string) {
    return this.templateLibraryService.getDownloadUrl(id);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id', ParseUuidPipe) id: string) {
    return this.templateLibraryService.remove(id);
  }
}
