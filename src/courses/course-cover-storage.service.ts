import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

export const MAX_COVER_SIZE_BYTES = 5 * 1024 * 1024;
const COVER_SUBDIR = 'course-covers';

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// A course-cover key is always "course-covers/<uuid><ext>" — generated
// server-side, never derived from the client's filename. This regex is the
// only thing trusted before a key is ever turned into a filesystem path.
const COVER_KEY_PATTERN =
  /^course-covers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

// Sniffs the real file format from its bytes instead of trusting the
// client-supplied Content-Type header, which can be spoofed freely.
function detectImageType(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
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
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class CourseCoverStorageService {
  private readonly rootDir: string;
  private readonly coverDir: string;

  constructor(private readonly configService: ConfigService) {
    this.rootDir = resolve(this.configService.get<string>('uploads.dir')!);
    this.coverDir = join(this.rootDir, COVER_SUBDIR);
  }

  /** Validates the buffer against the declared MIME type and writes it under a fresh UUID name. Returns the relative key to store on the Course row. */
  async save(buffer: Buffer, declaredMimeType: string): Promise<string> {
    if (buffer.length > MAX_COVER_SIZE_BYTES) {
      throw new BadRequestException('Cover image must be 5MB or smaller');
    }

    const detectedType = detectImageType(buffer);
    const extension = detectedType
      ? EXTENSION_BY_TYPE[detectedType]
      : undefined;
    if (!detectedType || !extension || detectedType !== declaredMimeType) {
      throw new BadRequestException(
        'Invalid image file — only JPEG, PNG, or WEBP are allowed',
      );
    }

    await mkdir(this.coverDir, { recursive: true });
    const key = `${COVER_SUBDIR}/${randomUUID()}${extension}`;
    await writeFile(this.resolveKeyPath(key), buffer);
    return key;
  }

  /** Best-effort delete — a missing file is not an error (already gone, or key was never set). */
  async delete(key: string): Promise<void> {
    if (!COVER_KEY_PATTERN.test(key)) {
      return;
    }
    try {
      await unlink(this.resolveKeyPath(key));
    } catch {
      // already gone — nothing to clean up
    }
  }

  private resolveKeyPath(key: string): string {
    if (!COVER_KEY_PATTERN.test(key)) {
      throw new BadRequestException('Invalid cover key');
    }
    const filePath = resolve(this.rootDir, key);
    if (!filePath.startsWith(this.rootDir)) {
      // defense in depth — COVER_KEY_PATTERN already rules this out, but a
      // path escaping the uploads root must never reach the filesystem
      throw new BadRequestException('Invalid cover key');
    }
    return filePath;
  }
}
