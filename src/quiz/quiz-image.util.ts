// Question-image support for the Excel importer — kept isolated from
// quiz-import.processor.ts's row/column parsing so the "is this really a
// safe image" concern stays in one small, easily-audited place.

export type QuizImageFormat = 'png' | 'jpeg' | 'webp';

export const QUIZ_IMAGE_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Content-sniffed, not extension-trusted — reads the real magic bytes so a
// mislabeled or malicious file never reaches storage as an "image".
export function sniffImageFormat(buffer: Buffer): QuizImageFormat | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function fileExtensionForFormat(format: QuizImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export function contentTypeForFormat(format: QuizImageFormat): string {
  return `image/${format}`;
}
