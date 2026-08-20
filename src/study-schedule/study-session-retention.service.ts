import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { STUDY_SESSION_RETENTION_DAYS } from './study-recommendation.constants';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Daily cleanup of the rolling study-activity log. Only ever targets
// COMPLETED sessions past the retention window (by endedAt) — the WHERE
// clause structurally excludes IN_PROGRESS rows, so an open session can never
// be swept up here no matter how old startedAt is. Never touches
// User/Course/Module/Quiz*/PDF/Video/Enrollment — those are permanent.
@Injectable()
export class StudySessionRetentionService {
  private readonly logger = new Logger(StudySessionRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - STUDY_SESSION_RETENTION_DAYS * MS_PER_DAY);
    const result = await this.prisma.studySession.deleteMany({
      where: { status: 'COMPLETED', endedAt: { lt: cutoff } },
    });
    this.logger.log(`Study session cleanup completed: ${result.count} records removed.`);
  }
}
