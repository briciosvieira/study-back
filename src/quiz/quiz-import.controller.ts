import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { QuizImportService } from './quiz-import.service';

@ApiTags('quiz-import')
@Roles(Role.ADMIN, Role.INSTRUCTOR)
@Controller()
export class QuizImportController {
  constructor(private readonly quizImportService: QuizImportService) {}

  @Post('modules/:moduleId/questions/import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  importQuestions(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.quizImportService.enqueueImport(moduleId, file);
  }

  @Get('questions/import/:jobId/status')
  getStatus(@Param('jobId') jobId: string) {
    return this.quizImportService.getStatus(jobId);
  }
}
