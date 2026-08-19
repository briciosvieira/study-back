import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ImportResult, ImportStatus } from './dto/import-status.dto';
import {
  QUIZ_IMPORT_JOB,
  QUIZ_IMPORT_QUEUE,
  QuizImportJobData,
} from './quiz-import.constants';

const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

@Injectable()
export class QuizImportService {
  constructor(
    @InjectQueue(QUIZ_IMPORT_QUEUE)
    private readonly queue: Queue<QuizImportJobData, ImportResult>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueImport(moduleId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected field "file")');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('File must be a .xlsx spreadsheet');
    }

    const targetModule = await this.prisma.module.findUnique({
      where: { id: moduleId },
    });
    if (!targetModule) {
      throw new NotFoundException('Module not found');
    }

    const job = await this.queue.add(QUIZ_IMPORT_JOB, {
      moduleId,
      fileBase64: file.buffer.toString('base64'),
    });

    return { jobId: job.id };
  }

  async getStatus(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    const state = await job.getState();

    if (state === 'completed') {
      return { status: 'completed' as ImportStatus, ...job.returnvalue };
    }
    if (state === 'failed') {
      return {
        status: 'error' as ImportStatus,
        reason: job.failedReason ?? 'Unknown error',
      };
    }
    return { status: 'processing' as ImportStatus };
  }
}
