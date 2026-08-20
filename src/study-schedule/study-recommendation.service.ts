import { Injectable } from '@nestjs/common';
import { ModuleType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_RECOMMENDATIONS,
  QUIZ_SCORE_THRESHOLDS,
  RECOMMENDATION_WEIGHTS,
  REASON_THRESHOLDS,
  StudyRecommendationReason,
} from './study-recommendation.constants';

export interface StudyRecommendation {
  moduleId: string;
  title: string;
  type: ModuleType;
  reason: StudyRecommendationReason;
  daysSinceLastStudy: number | null;
  quizPercentage: number | null;
  studyPriority: number;
}

interface ModuleStudyStats {
  neverStudied: boolean;
  daysSinceLastStudy: number | null;
  sessionsInWindow: number;
  totalSecondsInWindow: number;
  lastQuizPercentage: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Deterministic, non-generative recommendation engine: every suggestion is
// the output of an explicit numeric formula over data already in the
// database (module priority, this user's own StudySession/QuizAttempt
// history) — nothing here calls an LLM or any external model, and the same
// inputs always produce the same output, which is what makes it auditable.
@Injectable()
export class StudyRecommendationService {
  constructor(private readonly prisma: PrismaService) {}

  async getRecommendations(
    courseId: string,
    userId: string,
    limit = MAX_RECOMMENDATIONS,
  ): Promise<StudyRecommendation[]> {
    const modules = await this.prisma.module.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
    });
    if (modules.length === 0) return [];

    // Bounded to the retained window by construction: StudySessionRetentionService
    // purges COMPLETED rows older than STUDY_SESSION_RETENTION_DAYS, so "every
    // session this user has for this module" and "sessions in the last 14 days"
    // are, in practice, the same query.
    const sessions = await this.prisma.studySession.findMany({
      where: { userId, courseId, status: 'COMPLETED' },
      select: { moduleId: true, endedAt: true, durationSeconds: true },
    });

    const sessionsByModule = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const bucket = sessionsByModule.get(session.moduleId) ?? [];
      bucket.push(session);
      sessionsByModule.set(session.moduleId, bucket);
    }

    const quizModuleIds = modules
      .filter((m) => m.type === ModuleType.QUIZ)
      .map((m) => m.id);

    const latestPercentageByModule = new Map<string, number>();
    if (quizModuleIds.length > 0) {
      const attempts = await this.prisma.quizAttempt.findMany({
        where: {
          userId,
          moduleId: { in: quizModuleIds },
          status: 'COMPLETED',
          archived: false,
        },
        orderBy: { completedAt: 'desc' },
        select: { moduleId: true, totalCorrect: true, totalWrong: true },
      });
      for (const attempt of attempts) {
        if (latestPercentageByModule.has(attempt.moduleId)) continue; // already have the most recent
        const total = (attempt.totalCorrect ?? 0) + (attempt.totalWrong ?? 0);
        if (total > 0) {
          latestPercentageByModule.set(
            attempt.moduleId,
            Math.round(((attempt.totalCorrect ?? 0) / total) * 100),
          );
        }
      }
    }

    const now = Date.now();
    const avgSessionsPerModule = sessions.length / modules.length;

    const scored = modules.map((mod) => {
      const moduleSessions = sessionsByModule.get(mod.id) ?? [];
      const neverStudied = moduleSessions.length === 0;
      const lastEndedAt = moduleSessions.reduce<Date | null>((latest, s) => {
        if (!s.endedAt) return latest;
        return !latest || s.endedAt > latest ? s.endedAt : latest;
      }, null);

      const stats: ModuleStudyStats = {
        neverStudied,
        daysSinceLastStudy: lastEndedAt
          ? Math.floor((now - lastEndedAt.getTime()) / MS_PER_DAY)
          : null,
        sessionsInWindow: moduleSessions.length,
        totalSecondsInWindow: moduleSessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0),
        lastQuizPercentage: latestPercentageByModule.get(mod.id) ?? null,
      };

      return {
        module: mod,
        stats,
        score: this.scoreModule(mod.studyPriority, stats),
        reason: this.pickReasonCode(stats, mod.studyPriority, avgSessionsPerModule),
      };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ module: mod, stats, reason }) => ({
      moduleId: mod.id,
      title: mod.title,
      type: mod.type,
      reason,
      daysSinceLastStudy: stats.daysSinceLastStudy,
      quizPercentage: stats.lastQuizPercentage,
      studyPriority: mod.studyPriority,
    }));
  }

  private scoreModule(studyPriority: number, stats: ModuleStudyStats): number {
    const w = RECOMMENDATION_WEIGHTS;
    let score = studyPriority * w.PRIORITY_MULTIPLIER;

    if (stats.neverStudied) {
      score += w.NEVER_STUDIED_BONUS;
    } else if (stats.daysSinceLastStudy !== null) {
      score += Math.min(stats.daysSinceLastStudy, w.RECENCY_CAP_DAYS) * w.RECENCY_WEIGHT_PER_DAY;
    }

    if (stats.lastQuizPercentage !== null) {
      const p = stats.lastQuizPercentage;
      if (p < QUIZ_SCORE_THRESHOLDS.LOW) score += w.QUIZ_LOW_SCORE_BONUS;
      else if (p < QUIZ_SCORE_THRESHOLDS.MID) score += w.QUIZ_MID_SCORE_BONUS;
      else if (p < QUIZ_SCORE_THRESHOLDS.MILD) score += w.QUIZ_MILD_SCORE_BONUS;
      else score += w.QUIZ_HIGH_SCORE_BONUS;
    }

    score -= Math.min(
      stats.sessionsInWindow * w.RECENT_STUDY_PENALTY_PER_SESSION,
      w.RECENT_STUDY_PENALTY_CAP,
    );

    if (stats.totalSecondsInWindow > w.EXCESSIVE_TIME_THRESHOLD_SECONDS) {
      score -= w.EXCESSIVE_TIME_PENALTY;
    }

    return score;
  }

  // Fixed precedence chain, independent from the score above — this is what
  // the frontend shows the user via i18n, so it needs one unambiguous "main
  // reason", not a blend of everything that nudged the score.
  private pickReasonCode(
    stats: ModuleStudyStats,
    studyPriority: number,
    avgSessionsPerModule: number,
  ): StudyRecommendationReason {
    if (stats.neverStudied) return 'NEVER_STUDIED';
    if (stats.lastQuizPercentage !== null && stats.lastQuizPercentage < QUIZ_SCORE_THRESHOLDS.LOW) {
      return 'LOW_QUIZ_SCORE';
    }
    if (
      stats.daysSinceLastStudy !== null &&
      stats.daysSinceLastStudy >= REASON_THRESHOLDS.LONG_TIME_NO_STUDY_DAYS
    ) {
      return 'LONG_TIME_NO_STUDY';
    }
    if (stats.sessionsInWindow < avgSessionsPerModule) return 'LOW_COVERAGE';
    if (studyPriority >= REASON_THRESHOLDS.HIGH_PRIORITY_MIN) return 'HIGH_PRIORITY';
    return 'HIGH_PRIORITY';
  }
}
