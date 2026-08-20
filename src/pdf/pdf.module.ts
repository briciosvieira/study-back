import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ModulesModule } from '../modules/modules.module';
import { StorageModule } from '../storage/storage.module';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';

@Module({
  imports: [StorageModule, ModulesModule, AuditModule],
  controllers: [PdfController],
  providers: [PdfService],
})
export class PdfModule {}
