// Shared between PdfService and VideoService (both PDF and video files live
// in R2 through the same StorageService.presignUpload key shape:
// "{keyPrefix}/{randomUUID()}-{sanitizedFileName}").

const UPLOAD_KEY_UUID_PREFIX_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

// Derives a friendly, human-readable filename from an R2 object key —
// computed on read, never persisted, so the raw storage key/path is never
// sent to the frontend (only this derived name is).
export function deriveFileNameFromKey(key: string): string {
  const lastSegment = key.split('/').pop() ?? key;
  return lastSegment.replace(UPLOAD_KEY_UUID_PREFIX_REGEX, '');
}

function sanitizeDownloadBaseName(value: string): string {
  const trimmed = value.trim().replace(/[\\/:*?"<>|]+/g, '_');
  return trimmed || 'arquivo';
}

// Builds the filename offered on download from the item's CURRENT title
// (not the original upload filename) plus the original file's extension —
// so renaming a PDF/video in the admin UI is reflected in every future
// download without ever renaming the object in storage.
export function buildDownloadFileName(title: string, fileKey: string): string {
  const keyName = deriveFileNameFromKey(fileKey);
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(keyName);
  const extension = extMatch ? extMatch[0] : '';
  return `${sanitizeDownloadBaseName(title)}${extension}`;
}
