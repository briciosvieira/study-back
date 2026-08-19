import { Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module';
import { StorageModule } from '../storage/storage.module';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';

@Module({
  imports: [StorageModule, ModulesModule],
  controllers: [PdfController],
  providers: [PdfService],
})
export class PdfModule {}
