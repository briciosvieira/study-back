import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BlocklistModule } from '../blocklist/blocklist.module';
import { SecurityModule } from '../security/security.module';
import { StorageModule } from '../storage/storage.module';
import { AccountAccessService } from './account-access.service';
import { AccountDeletionService } from './account-deletion.service';
import { PolicyAccountDeletionJob } from './policy-account-deletion.job';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

@Module({
  imports: [AuditModule, BlocklistModule, StorageModule, SecurityModule],
  controllers: [PolicyController],
  providers: [
    PolicyService,
    AccountAccessService,
    AccountDeletionService,
    PolicyAccountDeletionJob,
  ],
  exports: [PolicyService, AccountAccessService, AccountDeletionService],
})
export class PolicyModule {}
