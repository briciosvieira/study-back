import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QuestionOptionDto } from './dto/question-option.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

function validateOptions(options: QuestionOptionDto[]) {
  const letters = options.map((option) => option.letter.toUpperCase());
  const uniqueLetters = new Set(letters);
  if (uniqueLetters.size !== letters.length) {
    throw new BadRequestException('Option letters must be unique');
  }

  const correctCount = options.filter((option) => option.correct).length;
  if (correctCount !== 1) {
    throw new BadRequestException(
      'Exactly one option must be marked as correct',
    );
  }
}

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForModule(moduleId: string) {
    await this.findModuleOrThrow(moduleId);
    return this.prisma.question.findMany({
      where: { moduleId },
      include: { options: true },
      orderBy: { order: 'asc' },
    });
  }

  async create(moduleId: string, dto: CreateQuestionDto) {
    await this.findModuleOrThrow(moduleId);
    validateOptions(dto.options);

    return this.prisma.question.create({
      data: {
        moduleId,
        statement: dto.statement,
        timeLimitSec: dto.timeLimitSec,
        order: dto.order,
        options: {
          create: dto.options.map((option) => ({
            letter: option.letter.toUpperCase(),
            text: option.text,
            correct: option.correct,
          })),
        },
      },
      include: { options: true },
    });
  }

  async update(id: string, dto: UpdateQuestionDto) {
    await this.findOrThrow(id);
    if (dto.options) {
      validateOptions(dto.options);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.options) {
        await tx.questionOption.deleteMany({ where: { questionId: id } });
      }

      return tx.question.update({
        where: { id },
        data: {
          statement: dto.statement,
          timeLimitSec: dto.timeLimitSec,
          order: dto.order,
          ...(dto.options && {
            options: {
              create: dto.options.map((option) => ({
                letter: option.letter.toUpperCase(),
                text: option.text,
                correct: option.correct,
              })),
            },
          }),
        },
        include: { options: true },
      });
    });
  }

  async remove(id: string) {
    await this.findOrThrow(id);
    await this.prisma.question.delete({ where: { id } });
    return { deleted: true };
  }

  private async findOrThrow(id: string) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    return question;
  }

  private async findModuleOrThrow(moduleId: string) {
    const targetModule = await this.prisma.module.findUnique({
      where: { id: moduleId },
    });
    if (!targetModule) {
      throw new NotFoundException('Module not found');
    }
    return targetModule;
  }
}
