import { Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module';
import { StorageModule } from '../storage/storage.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [StorageModule, ModulesModule],
  controllers: [VideoController],
  providers: [VideoService],
})
export class VideoModule {}
