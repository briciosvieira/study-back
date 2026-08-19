import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { AttemptsService } from './attempts.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';

@ApiTags('quiz-attempts')
@Controller()
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Get('modules/:moduleId/quiz/info')
  info(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.getQuizInfo(moduleId, user);
  }

  @Post('modules/:moduleId/quiz/start')
  start(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.start(moduleId, user);
  }

  @Post('modules/:moduleId/quiz/retry')
  retry(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.retry(moduleId, user);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Put('attempts/:attemptId/questions/:questionId/answer')
  submitAnswer(
    @Param('attemptId', ParseUuidPipe) attemptId: string,
    @Param('questionId', ParseUuidPipe) questionId: string,
    @Body() dto: SubmitAnswerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.submitAnswer(attemptId, questionId, dto, user);
  }

  @Post('attempts/:attemptId/finish')
  finish(
    @Param('attemptId', ParseUuidPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.finish(attemptId, user);
  }

  @Get('attempts/:attemptId/result')
  result(
    @Param('attemptId', ParseUuidPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.getResult(attemptId, user);
  }
}
