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
import { CreateVideoItemDto } from './dto/create-video-item.dto';
import { PresignVideoUploadDto } from './dto/presign-video-upload.dto';
import { ReorderVideoDto } from './dto/reorder-video.dto';
import { VideoService } from './video.service';

@ApiTags('video')
@Controller()
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Get('modules/:moduleId/video')
  findAll(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.videoService.findAllForModule(moduleId, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post('modules/:moduleId/video/presign-upload')
  presignUpload(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @Body() dto: PresignVideoUploadDto,
  ) {
    return this.videoService.presignUpload(moduleId, dto);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post('modules/:moduleId/video')
  create(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @Body() dto: CreateVideoItemDto,
  ) {
    return this.videoService.create(moduleId, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('video/:id')
  remove(@Param('id', ParseUuidPipe) id: string) {
    return this.videoService.remove(id);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Patch('video/:id/reorder')
  reorder(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ReorderVideoDto,
  ) {
    return this.videoService.reorder(id, dto);
  }
}
