import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CourseCoverStorageService } from './course-cover-storage.service';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [AuditModule],
  controllers: [CoursesController],
  providers: [CoursesService, CourseCoverStorageService],
  exports: [CoursesService],
})
export class CoursesModule {}
