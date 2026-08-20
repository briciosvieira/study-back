import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { StartStudySessionDto } from './dto/start-study-session.dto';
import { StudyScheduleService } from './study-schedule.service';

// Open to every authenticated role (ADMIN/INSTRUCTOR/STUDENT) — everyone sees
// and manages only their OWN schedule, scoped by userId from the JWT, never
// a param or body field. There is no "view another user's schedule" route.
@ApiTags('study-schedule')
@Controller()
export class StudyScheduleController {
  constructor(private readonly studyScheduleService: StudyScheduleService) {}

  @Get('courses/:courseId/study-schedule')
  getSchedule(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studyScheduleService.getSchedule(courseId, user);
  }

  @Post('courses/:courseId/study-sessions')
  startSession(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @Body() dto: StartStudySessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studyScheduleService.startSession(courseId, dto.moduleId, user);
  }

  @Post('study-sessions/:sessionId/finish')
  finishSession(
    @Param('sessionId', ParseUuidPipe) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studyScheduleService.finishSession(sessionId, user);
  }
}
