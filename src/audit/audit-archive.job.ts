import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { gzipSync } from 'zlib';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { sanitizeMetadata } from './sanitize-metadata.util';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Daily, well before AuditRetentionJob's own run — writes yesterday's
// AuditEvent rows as a single gzipped JSONL file to R2 (audit-archive/
// YYYY/MM/DD/events-YYYY-MM-DD.jsonl.gz) and records an AuditArchiveLog row
// on success. The retention job checks that log before deleting anything,
// so a failed upload here can never take the only copy of a day's events
// with it.
@Injectable()
export class AuditArchiveJob {
  private readonly logger = new Logger(AuditArchiveJob.name);
  private readonly auditBucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    configService: ConfigService,
  ) {
    const configuredAuditBucket = configService.get<string>('storage.auditBucket');
    this.auditBucket = configuredAuditBucket || configService.get<string>('storage.bucket')!;
    if (!configuredAuditBucket) {
      this.logger.warn(
        'STORAGE_AUDIT_BUCKET is not configured — audit archives will be written to the main storage bucket, which has public r2.dev access enabled for course content. Configure a separate private bucket for genuine audit privacy.',
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async run(): Promise<void> {
    const yesterday = new Date(Date.now() - MS_PER_DAY);
    await this.archiveDay(yesterday);
  }

  async archiveDay(date: Date): Promise<void> {
    const dayStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

    const alreadyArchived = await this.prisma.auditArchiveLog.findUnique({
      where: { archiveDate: dayStart },
    });
    if (alreadyArchived) {
      return; // idempotent — running twice for the same day is a no-op
    }

    const events = await this.prisma.auditEvent.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { createdAt: 'asc' },
    });

    const dateStr = dayStart.toISOString().slice(0, 10);
    if (events.length === 0) {
      // Still record the log so the retention job knows this day was
      // considered and there was legitimately nothing to archive.
      await this.prisma.auditArchiveLog.create({
        data: { archiveDate: dayStart, eventCount: 0, storageKey: '' },
      });
      return;
    }

    const jsonl = events
      .map((event) =>
        JSON.stringify({
          ...event,
          metadata: event.metadata ? sanitizeMetadata(event.metadata) : null,
        }),
      )
      .join('\n');
    const gzipped = gzipSync(Buffer.from(jsonl, 'utf-8'));

    const [year, month, day] = dateStr.split('-');
    const key = `audit-archive/${year}/${month}/${day}/events-${dateStr}.jsonl.gz`;

    try {
      await this.storage.putObject({
        key,
        body: gzipped,
        contentType: 'application/gzip',
        bucket: this.auditBucket,
      });
    } catch (error) {
      // Do NOT record the archive log on failure — the retention job must
      // see this day as unarchived and refuse to delete it.
      this.logger.error(
        `Audit archive upload failed for ${dateStr}: ${(error as Error).message}. Postgres rows for this day are kept until this succeeds.`,
      );
      return;
    }

    await this.prisma.auditArchiveLog.create({
      data: { archiveDate: dayStart, eventCount: events.length, storageKey: key },
    });

    this.logger.log(`Audit archive completed: ${events.length} event(s) for ${dateStr} written to ${key}.`);
  }
}
