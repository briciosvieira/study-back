import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module';
import { ContentAccessService } from './content-access.service';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';

@Module({
  imports: [CoursesModule],
  controllers: [ModulesController],
  providers: [ModulesService, ContentAccessService],
  exports: [ModulesService, ContentAccessService],
})
export class ModulesModule {}
