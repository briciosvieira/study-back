import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module';
import { ModulesModule } from '../modules/modules.module';
import { StudyScheduleController } from './study-schedule.controller';
import { StudyScheduleService } from './study-schedule.service';
import { StudyRecommendationService } from './study-recommendation.service';
import { StudySessionRetentionService } from './study-session-retention.service';

@Module({
  imports: [CoursesModule, ModulesModule],
  controllers: [StudyScheduleController],
  providers: [StudyScheduleService, StudyRecommendationService, StudySessionRetentionService],
})
export class StudyScheduleModule {}
