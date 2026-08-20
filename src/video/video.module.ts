import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ModulesModule } from '../modules/modules.module';
import { StorageModule } from '../storage/storage.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [StorageModule, ModulesModule, AuditModule],
  controllers: [VideoController],
  providers: [VideoService],
})
export class VideoModule {}
