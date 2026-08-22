import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// Physical cleanup of expired checks — see spec sections 9-11. Deliberately
// no audit trail here (section 35: checkbox activity, including expiry, is
// never audited) and deliberately no history kept: the row is just gone.
// Hourly is enough — the "is this check still active?" question is always
// re-derived live from expiresAt on every read anyway (see
// StudyTreeService.getTreeForUser), so this job only exists to keep the
// table from accumulating stale rows, not for correctness.
@Injectable()
export class StudyTreeCheckCleanupJob {
  private readonly logger = new Logger(StudyTreeCheckCleanupJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const { count } = await this.prisma.userTreeCheck.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    if (count > 0) {
      this.logger.log(`Study tree check cleanup: removed ${count} expired check(s).`);
    }
  }
}
