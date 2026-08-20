// Centralized, named scoring constants for StudyRecommendationService — every
// number that influences the ranking lives here, so the algorithm stays
// auditable (no magic numbers scattered through the scoring logic) and easy
// to retune without touching the scoring code itself.

export const RECOMMENDATION_WEIGHTS = {
  // module.studyPriority is 1-5 — multiplied to give it a comparable range to
  // the other bonuses below (20..100)
  PRIORITY_MULTIPLIER: 20,

  // strongest single signal: a module with zero recorded study history ranks
  // above everything else, which is what drives coverage across the course
  NEVER_STUDIED_BONUS: 100,

  // for modules studied before: the longer since the last session, the more
  // it should resurface, capped so a module studied 90 days ago doesn't
  // permanently outrank one studied 3 days ago by an unbounded margin
  RECENCY_CAP_DAYS: 14,
  RECENCY_WEIGHT_PER_DAY: 5, // up to 14 * 5 = 70

  // quiz performance on the module's own quiz acts as a difficulty signal
  // only — it never alters the stored QuizAttempt/QuizResult
  QUIZ_LOW_SCORE_BONUS: 60, // last completed attempt < 50%
  QUIZ_MID_SCORE_BONUS: 30, // 50% - 69%
  QUIZ_MILD_SCORE_BONUS: 10, // 70% - 84%
  QUIZ_HIGH_SCORE_BONUS: 0, // >= 85%, no bonus needed

  // suppresses modules the user has been hammering recently, so the
  // suggestions don't just repeat whatever was studied last
  RECENT_STUDY_PENALTY_PER_SESSION: 25,
  RECENT_STUDY_PENALTY_CAP: 75,

  // heavy recent time investment on one module lowers it further, favoring
  // spreading study time across the course
  EXCESSIVE_TIME_THRESHOLD_SECONDS: 3600, // 1h within the retained window
  EXCESSIVE_TIME_PENALTY: 20,
} as const;

export const QUIZ_SCORE_THRESHOLDS = {
  LOW: 50,
  MID: 70,
  MILD: 85,
} as const;

// Reason-code selection is independent from scoring: it explains the TOP N
// picks to the end user (via frontend i18n) using a fixed, deterministic
// precedence chain rather than "whatever contributed most to the score".
export const REASON_THRESHOLDS = {
  LONG_TIME_NO_STUDY_DAYS: 5,
  HIGH_PRIORITY_MIN: 4,
} as const;

export const MAX_RECOMMENDATIONS = 3;

export const STUDY_SESSION_RETENTION_DAYS = 14;

export type StudyRecommendationReason =
  | 'NEVER_STUDIED'
  | 'LOW_QUIZ_SCORE'
  | 'LONG_TIME_NO_STUDY'
  | 'HIGH_PRIORITY'
  | 'LOW_COVERAGE';
