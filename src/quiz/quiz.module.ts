import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module';
import { StorageModule } from '../storage/storage.module';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { QuizImportController } from './quiz-import.controller';
import { QuizImportProcessor } from './quiz-import.processor';
import { QuizImportService } from './quiz-import.service';
import { QUIZ_IMPORT_QUEUE } from './quiz-import.constants';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { QuizExportService } from './quiz-export.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUIZ_IMPORT_QUEUE }),
    ModulesModule,
    StorageModule,
  ],
  controllers: [QuestionsController, QuizImportController, AttemptsController],
  providers: [
    QuestionsService,
    QuizImportService,
    QuizImportProcessor,
    AttemptsService,
    QuizExportService,
  ],
})
export class QuizModule {}
