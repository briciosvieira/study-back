import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ModuleType,
  Question,
  QuestionOption,
  QuizAttempt,
  QuizAttemptStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ContentAccessService } from '../modules/content-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';

type QuestionWithOptions = Question & { options: QuestionOption[] };

interface AnswerState {
  selectedOptionId: string | null;
  questionStartedAt: Date | null;
}

function sanitizeOption(option: QuestionOption) {
  return { id: option.id, letter: option.letter, text: option.text };
}

// Deterministic PRNG (mulberry32) seeded from the attempt id, so the
// question order looks random but is stable across reloads/navigation for
// the same attempt — reshuffled only when a new attempt is created
// (start of a fresh quiz, or retry).
function seedFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleForAttempt<T>(items: T[], attemptId: string): T[] {
  const rand = mulberry32(seedFromString(attemptId));
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Never includes `correct` on any option, or a correct-option reference —
// this is the only shape allowed to leave the service while an attempt is
// still IN_PROGRESS.
function questionView(
  question: QuestionWithOptions,
  answer: AnswerState | undefined,
) {
  return {
    id: question.id,
    statement: question.statement,
    timeLimitSec: question.timeLimitSec,
    position: question.order,
    options: question.options.map(sanitizeOption),
    selectedOptionId: answer?.selectedOptionId ?? null,
    questionStartedAt: answer?.questionStartedAt ?? null,
  };
}

@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contentAccess: ContentAccessService,
  ) {}

  async getQuizInfo(moduleId: string, user: AuthenticatedUser) {
    const targetModule = await this.getQuizModule(moduleId, user);

    const questions = await this.prisma.question.findMany({
      where: { moduleId },
      select: { timeLimitSec: true },
    });
    const totalQuestions = questions.length;
    const avgTimeLimitSec = totalQuestions
      ? Math.round(
          questions.reduce((sum, q) => sum + q.timeLimitSec, 0) /
            totalQuestions,
        )
      : 0;

    const latest = await this.prisma.quizAttempt.findFirst({
      where: { moduleId, userId: user.id, archived: false },
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true },
    });

    return {
      moduleId: targetModule.id,
      totalQuestions,
      avgTimeLimitSec,
      latestAttemptId: latest?.id ?? null,
      latestStatus: latest?.status ?? null,
    };
  }

  async start(moduleId: string, user: AuthenticatedUser) {
    await this.getQuizModule(moduleId, user);

    const existing = await this.prisma.quizAttempt.findFirst({
      where: { moduleId, userId: user.id, archived: false },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      return this.buildAttemptView(existing);
    }

    const totalQuestions = await this.prisma.question.count({
      where: { moduleId },
    });
    if (totalQuestions === 0) {
      throw new BadRequestException('This quiz module has no questions yet');
    }

    const attempt = await this.prisma.quizAttempt.create({
      data: { moduleId, userId: user.id },
    });
    return this.buildAttemptView(attempt);
  }

  async retry(moduleId: string, user: AuthenticatedUser) {
    await this.getQuizModule(moduleId, user);

    const totalQuestions = await this.prisma.question.count({
      where: { moduleId },
    });
    if (totalQuestions === 0) {
      throw new BadRequestException('This quiz module has no questions yet');
    }

    // never deletes Question/QuestionOption content — only supersedes this
    // user's own attempt history for this quiz, preserving it for reference
    await this.prisma.quizAttempt.updateMany({
      where: { moduleId, userId: user.id, archived: false },
      data: { archived: true },
    });

    const attempt = await this.prisma.quizAttempt.create({
      data: { moduleId, userId: user.id },
    });
    return this.buildAttemptView(attempt);
  }

  async submitAnswer(
    attemptId: string,
    questionId: string,
    dto: SubmitAnswerDto,
    user: AuthenticatedUser,
  ) {
    const attempt = await this.getOwnedInProgressAttempt(attemptId, user);

    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { options: true },
    });
    if (!question || question.moduleId !== attempt.moduleId) {
      throw new BadRequestException(
        'This question does not belong to this attempt',
      );
    }

    let selectedOptionId: string | null = null;
    if (dto.selectedOptionId) {
      const option = question.options.find(
        (o) => o.id === dto.selectedOptionId,
      );
      if (!option) {
        throw new BadRequestException(
          'selectedOptionId does not belong to this question',
        );
      }
      selectedOptionId = option.id;
    }

    const now = new Date();
    const answer = await this.prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: {
        attemptId,
        questionId,
        selectedOptionId,
        questionStartedAt: now,
        answeredAt: selectedOptionId ? now : null,
      },
      update: {
        selectedOptionId,
        answeredAt: selectedOptionId ? now : null,
        // questionStartedAt is intentionally never touched on update — it's
        // set once, on first view, and must survive reload/navigation
      },
    });

    return questionView(question, answer);
  }

  async finish(attemptId: string, user: AuthenticatedUser) {
    const attempt = await this.getOwnedAttempt(attemptId, user);

    if (attempt.status === QuizAttemptStatus.COMPLETED) {
      // idempotent: a duplicate/racing click just gets the same result back
      return this.buildResultView(attempt.id);
    }

    await this.prisma.$transaction(async (tx) => {
      const questions = await tx.question.findMany({
        where: { moduleId: attempt.moduleId },
        include: { options: true },
        orderBy: { order: 'asc' },
      });
      const answers = await tx.attemptAnswer.findMany({
        where: { attemptId: attempt.id },
      });
      const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));

      const now = new Date();
      let correctCount = 0;

      for (const question of questions) {
        const answer = answerByQuestionId.get(question.id);
        const selectedOption = answer?.selectedOptionId
          ? question.options.find((o) => o.id === answer.selectedOptionId)
          : undefined;
        const isCorrect = !!selectedOption?.correct;
        if (isCorrect) correctCount++;

        const startedAt = answer?.questionStartedAt ?? null;
        const finishedAt = answer?.answeredAt ?? (startedAt ? now : null);
        const elapsedSeconds = startedAt
          ? Math.max(
              0,
              Math.floor(
                ((finishedAt ?? now).getTime() - startedAt.getTime()) / 1000,
              ),
            )
          : 0;
        const overtimeSeconds = Math.max(
          0,
          elapsedSeconds - question.timeLimitSec,
        );

        await tx.attemptAnswer.upsert({
          where: {
            attemptId_questionId: {
              attemptId: attempt.id,
              questionId: question.id,
            },
          },
          create: {
            attemptId: attempt.id,
            questionId: question.id,
            selectedOptionId: selectedOption?.id ?? null,
            correct: isCorrect,
            questionStartedAt: startedAt,
            answeredAt: answer?.answeredAt ?? null,
            elapsedSeconds,
            overtimeSeconds,
          },
          update: {
            correct: isCorrect,
            elapsedSeconds,
            overtimeSeconds,
          },
        });
      }

      const totalQuestions = questions.length;
      const wrongCount = totalQuestions - correctCount;
      const totalTimeSec = Math.max(
        0,
        Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000),
      );

      await tx.quizAttempt.update({
        where: { id: attempt.id },
        data: {
          status: QuizAttemptStatus.COMPLETED,
          completedAt: now,
          totalCorrect: correctCount,
          totalWrong: wrongCount,
          totalTimeSec,
        },
      });
    });

    return this.buildResultView(attempt.id);
  }

  async getResult(attemptId: string, user: AuthenticatedUser) {
    const attempt = await this.getOwnedAttempt(attemptId, user);
    if (attempt.status !== QuizAttemptStatus.COMPLETED) {
      throw new BadRequestException('This attempt has not finished yet');
    }
    return this.buildResultView(attempt.id);
  }

  private async buildAttemptView(attempt: QuizAttempt) {
    const questions = await this.prisma.question.findMany({
      where: { moduleId: attempt.moduleId },
      include: { options: true },
      orderBy: { order: 'asc' },
    });
    // Presentation order only — shuffled per attempt so the quiz feels
    // randomized while staying stable for the duration of this attempt.
    // Scoring, results and the canonical `order` field are unaffected.
    const shuffledQuestions = shuffleForAttempt(questions, attempt.id);
    const answers = await this.prisma.attemptAnswer.findMany({
      where: { attemptId: attempt.id },
    });
    const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));

    return {
      attemptId: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      totalQuestions: shuffledQuestions.length,
      questions: shuffledQuestions.map((q) =>
        questionView(q, answerByQuestionId.get(q.id)),
      ),
    };
  }

  private async buildResultView(attemptId: string) {
    const attempt = await this.prisma.quizAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    const questions = await this.prisma.question.findMany({
      where: { moduleId: attempt.moduleId },
      include: { options: true },
      orderBy: { order: 'asc' },
    });
    const answers = await this.prisma.attemptAnswer.findMany({
      where: { attemptId },
    });
    const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));

    const totalQuestions = questions.length;
    const correctAnswers = attempt.totalCorrect ?? 0;
    const wrongAnswers = attempt.totalWrong ?? totalQuestions - correctAnswers;
    const percentage = totalQuestions
      ? Math.round((correctAnswers / totalQuestions) * 10000) / 100
      : 0;

    return {
      attemptId: attempt.id,
      status: attempt.status,
      totalQuestions,
      correctAnswers,
      wrongAnswers,
      percentage,
      totalTimeSec: attempt.totalTimeSec ?? 0,
      questions: questions.map((question) => {
        const answer = answerByQuestionId.get(question.id);
        const selectedOption = answer?.selectedOptionId
          ? question.options.find((o) => o.id === answer.selectedOptionId)
          : undefined;
        const correctOption = question.options.find((o) => o.correct);

        return {
          questionId: question.id,
          text: question.statement,
          position: question.order,
          selectedOption: selectedOption
            ? sanitizeOption(selectedOption)
            : null,
          correctOption: correctOption ? sanitizeOption(correctOption) : null,
          isCorrect: !!answer?.correct,
          elapsedSeconds: answer?.elapsedSeconds ?? 0,
          overtimeSeconds: answer?.overtimeSeconds ?? 0,
        };
      }),
    };
  }

  private async getQuizModule(moduleId: string, user: AuthenticatedUser) {
    const targetModule = await this.contentAccess.getAccessibleModule(
      moduleId,
      user,
    );
    if (targetModule.type !== ModuleType.QUIZ) {
      throw new BadRequestException('This module is not a quiz');
    }
    return targetModule;
  }

  private async getOwnedAttempt(attemptId: string, user: AuthenticatedUser) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }
    if (attempt.userId !== user.id) {
      throw new ForbiddenException('This attempt does not belong to you');
    }
    return attempt;
  }

  private async getOwnedInProgressAttempt(
    attemptId: string,
    user: AuthenticatedUser,
  ) {
    const attempt = await this.getOwnedAttempt(attemptId, user);
    if (attempt.status !== QuizAttemptStatus.IN_PROGRESS || attempt.archived) {
      throw new BadRequestException('This attempt is no longer active');
    }
    return attempt;
  }
}
