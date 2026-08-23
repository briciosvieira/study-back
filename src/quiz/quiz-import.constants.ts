export const QUIZ_IMPORT_QUEUE = 'quiz-import';
export const QUIZ_IMPORT_JOB = 'import-questions';

export interface QuizImportJobData {
  moduleId: string;
  fileName: string;
  fileBase64: string;
}

// Shared Excel contract between the importer (quiz-import.processor.ts) and
// the exporter (quiz-export.service.ts) — the file produced by the exporter
// must always be re-importable through the same header/column layout.
export const QUIZ_HEADER_STATEMENT = 'Pergunta';
export const QUIZ_HEADER_IMAGE = 'Imagem'; // optional column — see quiz-image.util.ts
export const QUIZ_HEADER_CORRECT = 'Correta';
export const QUIZ_LETTER_HEADER_REGEX = /^[A-F]$/i;

// Some spreadsheets carry a literal backslash-n (two characters: `\` and
// `n`) instead of a real line break — Excel/exporting tools sometimes
// produce this when a cell's line breaks are typed/pasted as escape
// sequences rather than actual Alt+Enter breaks. Converts both that and a
// literal `\r\n` into a real `\n`; a cell that already has real line breaks
// passes through untouched. Never touches internal spacing otherwise —
// only whitespace at the very ends is trimmed.
export function normalizeQuizText(value: string): string {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

// Inverse of normalizeQuizText's newline handling: turns real line breaks
// into the literal `\n` escape sequence so the exported cell can be edited
// in Excel and re-imported without ever accumulating extra backslashes.
// Always canonicalizes through normalizeQuizText first, so it produces the
// same output whether the source text already had real or literal breaks —
// that's what keeps export→import→export stable across generations.
export function toExcelEscapedText(value: string): string {
  return normalizeQuizText(value).replace(/\n/g, '\\n');
}
