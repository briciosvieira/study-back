import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleType, Question, QuestionOption } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ContentAccessService } from '../modules/content-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnswerQuestionDto } from './dto/answer-question.dto';

type QuestionWithOptions = Question & { options: QuestionOption[] };

function sanitizeQuestion(question: QuestionWithOptions) {
  return {
    id: question.id,
    statement: question.statement,
    timeLimitSec: question.timeLimitSec,
    options: question.options.map((option) => ({
      id: option.id,
      letter: option.letter,
      text: option.text,
    })),
  };
}

@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contentAccess: ContentAccessService,
  ) {}

  async start(moduleId: string, user: AuthenticatedUser) {
    const targetModule = await this.contentAccess.getAccessibleModule(
      moduleId,
      user,
    );
    if (targetModule.type !== ModuleType.QUIZ) {
      throw new BadRequestException('This module is not a quiz');
    }

    let attempt = await this.prisma.quizAttempt.findFirst({
      where: { moduleId, userId: user.id, archived: false },
      orderBy: { startedAt: 'desc' },
    });

    // an attempt the student already finished (without explicitly retrying)
    // is superseded automatically — quiz retries have no limit, so /start
    // behaves like /retry in this case instead of erroring out
    if (attempt?.finishedAt) {
      await this.prisma.quizAttempt.update({
        where: { id: attempt.id },
        data: { archived: true },
      });
      attempt = null;
    }

    if (!attempt) {
      attempt = await this.prisma.quizAttempt.create({
        data: { moduleId, userId: user.id },
      });
    }

    // resuming an in-progress attempt must NOT reset the question timer —
    // otherwise reloading the page would let a student game the countdown
    if (attempt.currentQuestionId) {
      return this.resumeCurrentQuestion(attempt);
    }
    return this.serveCurrentQuestion(attempt.id, moduleId);
  }

  async retry(moduleId: string, user: AuthenticatedUser) {
    const targetModule = await this.contentAccess.getAccessibleModule(
      moduleId,
      user,
    );
    if (targetModule.type !== ModuleType.QUIZ) {
      throw new BadRequestException('This module is not a quiz');
    }

    await this.prisma.quizAttempt.updateMany({
      where: { moduleId, userId: user.id, archived: false },
      data: { archived: true },
    });

    const attempt = await this.prisma.quizAttempt.create({
      data: { moduleId, userId: user.id },
    });

    return this.serveCurrentQuestion(attempt.id, moduleId);
  }

  async answer(
    attemptId: string,
    dto: AnswerQuestionDto,
    user: AuthenticatedUser,
  ) {
    const attempt = await this.getOwnedActiveAttempt(attemptId, user);

    if (attempt.currentQuestionId !== dto.questionId) {
      throw new BadRequestException(
        'questionId does not match the question currently being served',
      );
    }

    const question = await this.prisma.question.findUniqueOrThrow({
      where: { id: dto.questionId },
      include: { options: true },
    });

    const alreadyAnswered = await this.prisma.attemptAnswer.findUnique({
      where: {
        attemptId_questionId: { attemptId, questionId: dto.questionId },
      },
    });

    if (!alreadyAnswered) {
      const shownAt = attempt.currentQuestionShownAt ?? attempt.startedAt;
      const elapsedSec = Math.floor((Date.now() - shownAt.getTime()) / 1000);
      const timedOut = elapsedSec > question.timeLimitSec;

      // the server is always the source of truth for time: a client-side
      // manipulated countdown cannot force an answer through past the limit
      const effectiveChoice = timedOut ? null : (dto.chosenOption ?? null);
      const chosenOption = question.options.find(
        (option) => option.letter === effectiveChoice,
      );

      await this.prisma.attemptAnswer.create({
        data: {
          attemptId,
          questionId: question.id,
          chosenOption: effectiveChoice,
          correct: !!chosenOption?.correct,
          timeSpentSec: Math.min(elapsedSec, question.timeLimitSec),
        },
      });
    }

    return this.serveCurrentQuestion(
      attemptId,
      attempt.moduleId,
      question.order,
    );
  }

  async finish(attemptId: string, user: AuthenticatedUser) {
    const attempt = await this.getOwnedActiveAttempt(attemptId, user);

    const questions = await this.prisma.question.findMany({
      where: { moduleId: attempt.moduleId },
      include: { options: true },
      orderBy: { order: 'asc' },
    });
    const answers = await this.prisma.attemptAnswer.findMany({
      where: { attemptId },
    });
    const answerByQuestionId = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );

    // any question the client never got to answer (e.g. it disconnected)
    // is recorded as a timed-out miss, so the results below stay complete
    for (const question of questions) {
      if (!answerByQuestionId.has(question.id)) {
        const fallback = await this.prisma.attemptAnswer.create({
          data: {
            attemptId,
            questionId: question.id,
            chosenOption: null,
            correct: false,
            timeSpentSec: question.timeLimitSec,
          },
        });
        answerByQuestionId.set(question.id, fallback);
      }
    }

    const totalCorrect = [...answerByQuestionId.values()].filter(
      (answer) => answer.correct,
    ).length;
    const totalWrong = questions.length - totalCorrect;
    const totalTimeSec = Math.max(
      0,
      Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000),
    );

    await this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        finishedAt: new Date(),
        totalCorrect,
        totalWrong,
        totalTimeSec,
        currentQuestionId: null,
        currentQuestionShownAt: null,
      },
    });

    const details = questions.map((question) => {
      const answer = answerByQuestionId.get(question.id)!;
      const correctOption = question.options.find((option) => option.correct);
      return {
        question: question.statement,
        chosenOption: answer.chosenOption,
        correctOption: correctOption?.letter ?? null,
        correct: answer.correct,
      };
    });

    return {
      totalQuestions: questions.length,
      totalCorrect,
      totalWrong,
      totalTimeSec,
      details,
    };
  }

  private async resumeCurrentQuestion(attempt: {
    id: string;
    currentQuestionId: string | null;
    currentQuestionShownAt: Date | null;
    startedAt: Date;
  }) {
    const question = await this.prisma.question.findUniqueOrThrow({
      where: { id: attempt.currentQuestionId! },
      include: { options: true },
    });

    const shownAt = attempt.currentQuestionShownAt ?? attempt.startedAt;
    const elapsedSec = Math.floor((Date.now() - shownAt.getTime()) / 1000);
    const remainingSec = Math.max(0, question.timeLimitSec - elapsedSec);

    return {
      attemptId: attempt.id,
      finished: false,
      question: { ...sanitizeQuestion(question), timeLimitSec: remainingSec },
    };
  }

  private async serveCurrentQuestion(
    attemptId: string,
    moduleId: string,
    afterOrder?: number,
  ) {
    const nextQuestion = await this.prisma.question.findFirst({
      where: {
        moduleId,
        ...(afterOrder !== undefined ? { order: { gt: afterOrder } } : {}),
      },
      include: { options: true },
      orderBy: { order: 'asc' },
    });

    if (!nextQuestion) {
      if (afterOrder === undefined) {
        throw new BadRequestException('This quiz module has no questions yet');
      }
      await this.prisma.quizAttempt.update({
        where: { id: attemptId },
        data: { currentQuestionId: null, currentQuestionShownAt: null },
      });
      return { attemptId, finished: true };
    }

    await this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        currentQuestionId: nextQuestion.id,
        currentQuestionShownAt: new Date(),
      },
    });

    return {
      attemptId,
      finished: false,
      question: sanitizeQuestion(nextQuestion),
    };
  }

  private async getOwnedActiveAttempt(
    attemptId: string,
    user: AuthenticatedUser,
  ) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }
    if (attempt.userId !== user.id) {
      throw new ForbiddenException('This attempt does not belong to you');
    }
    if (attempt.archived || attempt.finishedAt) {
      throw new BadRequestException('This attempt is no longer active');
    }
    return attempt;
  }
}
