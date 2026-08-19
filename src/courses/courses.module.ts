import { Module } from '@nestjs/common';
import { CourseCoverStorageService } from './course-cover-storage.service';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  controllers: [CoursesController],
  providers: [CoursesService, CourseCoverStorageService],
  exports: [CoursesService],
})
export class CoursesModule {}
