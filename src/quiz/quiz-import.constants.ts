export const QUIZ_IMPORT_QUEUE = 'quiz-import';
export const QUIZ_IMPORT_JOB = 'import-questions';

export interface QuizImportJobData {
  moduleId: string;
  fileBase64: string;
}
