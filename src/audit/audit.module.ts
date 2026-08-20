import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AuditArchiveJob } from './audit-archive.job';
import { AuditExportService } from './audit-export.service';
import { AuditNotificationService } from './audit-notification.service';
import { AuditQueryService } from './audit-query.service';
import { AuditRetentionJob } from './audit-retention.job';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [StorageModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditQueryService,
    AuditExportService,
    AuditNotificationService,
    AuditArchiveJob,
    AuditRetentionJob,
  ],
  exports: [AuditService],
})
export class AuditModule {}
