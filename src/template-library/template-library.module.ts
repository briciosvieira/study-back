import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { TemplateLibraryController } from './template-library.controller';
import { TemplateLibraryService } from './template-library.service';

@Module({
  imports: [StorageModule, AuditModule],
  controllers: [TemplateLibraryController],
  providers: [TemplateLibraryService],
})
export class TemplateLibraryModule {}
