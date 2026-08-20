import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BlocklistController } from './blocklist.controller';
import { EmailEligibilityService } from './email-eligibility.service';

@Module({
  imports: [AuditModule],
  controllers: [BlocklistController],
  providers: [EmailEligibilityService],
  exports: [EmailEligibilityService],
})
export class BlocklistModule {}
