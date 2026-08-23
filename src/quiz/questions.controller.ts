import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionsService } from './questions.service';
import { QuizExportService } from './quiz-export.service';

@ApiTags('questions')
@Roles(Role.ADMIN, Role.INSTRUCTOR)
@Controller()
export class QuestionsController {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly quizExportService: QuizExportService,
  ) {}

  @Get('modules/:moduleId/questions')
  findAll(@Param('moduleId', ParseUuidPipe) moduleId: string) {
    return this.questionsService.findAllForModule(moduleId);
  }

  @Get('modules/:moduleId/questions/export')
  async export(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } =
      await this.quizExportService.exportModule(moduleId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(buffer);
  }

  @Post('modules/:moduleId/questions')
  create(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.questionsService.create(moduleId, dto);
  }

  @Patch('questions/:id')
  update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questionsService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('questions/:id')
  remove(@Param('id', ParseUuidPipe) id: string) {
    return this.questionsService.remove(id);
  }
}
