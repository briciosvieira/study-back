import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { StudyTreeImportService } from './study-tree-import.service';
import { StudyTreeService } from './study-tree.service';

// Reachable by every authenticated role that already has access to the
// course (ADMIN/INSTRUCTOR/STUDENT) — CoursesService.findOne enforces that
// exact same course-visibility rule everywhere in this controller. Only
// import/delete/template are additionally restricted to ADMIN below.
@ApiTags('study-tree')
@Controller()
export class StudyTreeController {
  constructor(
    private readonly studyTreeService: StudyTreeService,
    private readonly studyTreeImportService: StudyTreeImportService,
  ) {}

  @Get('courses/:courseId/study-tree')
  getTree(@Param('courseId', ParseUuidPipe) courseId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.studyTreeService.getTreeForUser(courseId, user);
  }

  @Roles(Role.ADMIN)
  @Get('courses/:courseId/study-tree/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.studyTreeImportService.generateTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="modelo-arvore-de-estudos.xlsx"',
    );
    res.send(buffer);
  }

  @Roles(Role.ADMIN)
  @Post('courses/:courseId/study-tree/import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  importTree(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studyTreeImportService.importTree(courseId, file, user);
  }

  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Delete('courses/:courseId/study-tree')
  async deleteTree(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.studyTreeService.deleteTree(courseId, user);
    return { deleted: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('courses/:courseId/study-tree/nodes/:nodeId/check')
  checkNode(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @Param('nodeId', ParseUuidPipe) nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studyTreeService.checkNode(courseId, nodeId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('courses/:courseId/study-tree/nodes/:nodeId/check')
  uncheckNode(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @Param('nodeId', ParseUuidPipe) nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studyTreeService.uncheckNode(courseId, nodeId, user);
  }
}
