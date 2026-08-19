import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { AttemptsService } from './attempts.service';
import { AnswerQuestionDto } from './dto/answer-question.dto';

@ApiTags('quiz-attempts')
@Controller()
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Post('modules/:moduleId/quiz/start')
  start(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.start(moduleId, user);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('attempts/:attemptId/answer')
  answer(
    @Param('attemptId', ParseUuidPipe) attemptId: string,
    @Body() dto: AnswerQuestionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.answer(attemptId, dto, user);
  }

  @Post('attempts/:attemptId/finish')
  finish(
    @Param('attemptId', ParseUuidPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.finish(attemptId, user);
  }

  @Post('modules/:moduleId/quiz/retry')
  retry(
    @Param('moduleId', ParseUuidPipe) moduleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attemptsService.retry(moduleId, user);
  }
}
