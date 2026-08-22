import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CoursesModule } from '../courses/courses.module';
import { StudyTreeCheckCleanupJob } from './study-tree-cleanup.job';
import { StudyTreeExcelService } from './study-tree-excel.service';
import { StudyTreeImportService } from './study-tree-import.service';
import { StudyTreeController } from './study-tree.controller';
import { StudyTreeService } from './study-tree.service';

@Module({
  imports: [CoursesModule, AuditModule],
  controllers: [StudyTreeController],
  providers: [
    StudyTreeService,
    StudyTreeImportService,
    StudyTreeExcelService,
    StudyTreeCheckCleanupJob,
  ],
})
export class StudyTreeModule {}
