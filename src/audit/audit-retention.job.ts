import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Daily, after AuditArchiveJob has had a chance to run — deletes AuditEvent/
// SecurityIncident rows (and, via cascade, their AuditNotification rows)
// older than AUDIT_RETENTION_DAYS, but ONLY for days that have a confirmed
// AuditArchiveLog entry. A day whose archive upload failed is left alone
// entirely (including its R2 file, if any) until the archive job succeeds
// for it — see the spec's "não apagar silenciosamente" requirement.
@Injectable()
export class AuditRetentionJob {
  private readonly logger = new Logger(AuditRetentionJob.name);
  private readonly retentionDays: number;
  private readonly auditBucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    configService: ConfigService,
  ) {
    this.retentionDays = configService.get<number>('audit.retentionDays')!;
    const configuredAuditBucket = configService.get<string>('storage.auditBucket');
    this.auditBucket = configuredAuditBucket || configService.get<string>('storage.bucket')!;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays * MS_PER_DAY);

    const confirmedArchives = await this.prisma.auditArchiveLog.findMany({
      where: { archiveDate: { lt: cutoff } },
    });
    if (confirmedArchives.length === 0) {
      return;
    }

    let deletedEvents = 0;
    let deletedR2Files = 0;

    for (const archive of confirmedArchives) {
      const dayStart = archive.archiveDate;
      const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

      const result = await this.prisma.auditEvent.deleteMany({
        where: { createdAt: { gte: dayStart, lt: dayEnd } },
      });
      deletedEvents += result.count;

      if (archive.storageKey) {
        try {
          await this.storage.delete(archive.storageKey, this.auditBucket);
          deletedR2Files++;
        } catch (error) {
          this.logger.warn(
            `Failed to delete expired R2 archive ${archive.storageKey}: ${(error as Error).message}`,
          );
        }
      }

      await this.prisma.auditArchiveLog.delete({ where: { id: archive.id } });
    }

    const deletedIncidents = await this.prisma.securityIncident.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (deletedEvents > 0 || deletedIncidents.count > 0 || deletedR2Files > 0) {
      this.logger.log(
        `Audit retention completed: ${deletedEvents} event(s), ${deletedIncidents.count} incident(s), ${deletedR2Files} R2 archive(s) removed (older than ${this.retentionDays} days).`,
      );
    }
  }
}
