// Centralized allowlist/limits for the Template Library — administrative
// reference files (quiz-import spreadsheets, docs, etc.), never executables.
// Kept separate from any Course-PDF constants: this is a different bucket
// prefix, different model, different permissions.

export const TEMPLATE_LIBRARY_ALLOWED_EXTENSIONS = [
  '.xlsx',
  '.xls',
  '.csv',
  '.json',
  '.txt',
  '.pdf',
  '.docx',
] as const;

export const TEMPLATE_LIBRARY_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export const TEMPLATE_LIBRARY_KEY_PREFIX = 'templates';

export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? '' : fileName.slice(lastDot).toLowerCase();
}

export function isAllowedTemplateExtension(fileName: string): boolean {
  return (TEMPLATE_LIBRARY_ALLOWED_EXTENSIONS as readonly string[]).includes(
    getFileExtension(fileName),
  );
}
