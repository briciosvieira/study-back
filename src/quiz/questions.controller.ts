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
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionsService } from './questions.service';

@ApiTags('questions')
@Roles(Role.ADMIN, Role.INSTRUCTOR)
@Controller()
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get('modules/:moduleId/questions')
  findAll(@Param('moduleId', ParseUuidPipe) moduleId: string) {
    return this.questionsService.findAllForModule(moduleId);
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
