import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TemplateLibraryController } from './template-library.controller';
import { TemplateLibraryService } from './template-library.service';

@Module({
  imports: [StorageModule],
  controllers: [TemplateLibraryController],
  providers: [TemplateLibraryService],
})
export class TemplateLibraryModule {}
