import { randomUUID } from 'crypto';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Workbook, Worksheet } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImportResult, ImportRowError } from './dto/import-status.dto';
import {
  QUIZ_HEADER_IMAGE,
  QUIZ_IMPORT_QUEUE,
  QUIZ_LETTER_HEADER_REGEX,
  QuizImportJobData,
  normalizeQuizText,
} from './quiz-import.constants';
import {
  QUIZ_IMAGE_MAX_FILE_SIZE_BYTES,
  contentTypeForFormat,
  fileExtensionForFormat,
  sniffImageFormat,
} from './quiz-image.util';

interface ParsedColumns {
  statementCol: number;
  correctCol: number;
  letterCols: Map<string, number>; // letter -> column index
  imageCol: number | null; // "Imagem" column — absent entirely on old spreadsheets
}

function cellText(worksheet: Worksheet, row: number, col: number): string {
  const value = worksheet.getRow(row).getCell(col).text;
  return normalizeQuizText((value ?? '').toString());
}

function parseColumns(worksheet: Worksheet): ParsedColumns {
  const headerRow = worksheet.getRow(1);
  const letterCols = new Map<string, number>();
  let statementCol = -1;
  let correctCol = -1;
  let imageCol: number | null = null;

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = (cell.text ?? '').toString().trim();
    if (
      header.toLowerCase() === 'pergunta' ||
      header.toLowerCase() === 'question'
    ) {
      statementCol = colNumber;
    } else if (
      header.toLowerCase() === 'correta' ||
      header.toLowerCase() === 'correct'
    ) {
      correctCol = colNumber;
    } else if (
      header.toLowerCase() === QUIZ_HEADER_IMAGE.toLowerCase() ||
      header.toLowerCase() === 'image'
    ) {
      imageCol = colNumber;
    } else if (QUIZ_LETTER_HEADER_REGEX.test(header)) {
      letterCols.set(header.toUpperCase(), colNumber);
    }
  });

  if (statementCol === -1 || correctCol === -1 || letterCols.size === 0) {
    throw new Error(
      'Invalid spreadsheet header — expected columns: Pergunta, A..F, Correta',
    );
  }

  return { statementCol, correctCol, letterCols, imageCol };
}

interface ImageCandidate {
  buffer: Buffer;
}

// Maps each data row (1-based, matching worksheet.getRow) to the image(s)
// anchored specifically in the "Imagem" column on that row. Never throws —
// a spreadsheet with no drawings at all (the overwhelming majority) must
// come back with an empty map, not an error, and every property access on
// exceljs's drawing/anchor objects is guarded rather than assumed to exist
// (this codebase has previously broken on unguarded `.anchors`/`.comments`
// access for sheets that simply don't have that structure).
function collectImageCandidatesByRow(
  worksheet: Worksheet,
  workbook: Workbook,
  imageCol: number | null,
): Map<number, ImageCandidate[]> {
  const byRow = new Map<number, ImageCandidate[]>();
  if (imageCol === null) return byRow;

  let images: ReturnType<Worksheet['getImages']>;
  try {
    images = worksheet.getImages();
  } catch {
    return byRow;
  }
  if (!Array.isArray(images)) return byRow;

  for (const entry of images) {
    const tl = entry?.range?.tl;
    if (!tl || typeof tl.nativeRow !== 'number' || typeof tl.nativeCol !== 'number') {
      continue;
    }
    const colNumber = tl.nativeCol + 1;
    if (colNumber !== imageCol) continue;
    const rowNumber = tl.nativeRow + 1;

    let media: { buffer?: Buffer } | undefined;
    try {
      // same ambient-Buffer-typing mismatch noted in the workbook.xlsx.load
      // call below — same runtime value, unreconcilable typings clash from
      // a nested dependency's older @types/node
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      media = workbook.getImage(Number(entry.imageId)) as any;
    } catch {
      media = undefined;
    }
    if (!media?.buffer) continue;

    const list = byRow.get(rowNumber) ?? [];
    list.push({ buffer: media.buffer as Buffer });
    byRow.set(rowNumber, list);
  }

  return byRow;
}

@Processor(QUIZ_IMPORT_QUEUE)
export class QuizImportProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(
    job: Job<QuizImportJobData, ImportResult>,
  ): Promise<ImportResult> {
    const { moduleId, fileBase64 } = job.data;

    const workbook = new Workbook();
    // exceljs resolves a stale, differently-shaped ambient `Buffer` type
    // (via a nested dependency's older @types/node) than the rest of this
    // project — same runtime value, just an unreconcilable typings clash.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await workbook.xlsx.load(Buffer.from(fileBase64, 'base64') as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('Spreadsheet has no sheets');
    }

    const columns = parseColumns(worksheet);
    const imagesByRow = collectImageCandidatesByRow(worksheet, workbook, columns.imageCol);

    const targetModule = await this.prisma.module.findUnique({
      where: { id: moduleId },
    });
    if (!targetModule) {
      throw new Error('Module not found');
    }

    const existingCount = await this.prisma.question.count({
      where: { moduleId },
    });

    let totalLines = 0;
    let imported = 0;
    const errors: ImportRowError[] = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const statement = cellText(worksheet, rowNumber, columns.statementCol);
      const options = [...columns.letterCols.entries()]
        .map(([letter, col]) => ({
          letter,
          text: cellText(worksheet, rowNumber, col),
        }))
        .filter((option) => option.text.length > 0);
      const correctLetter = cellText(
        worksheet,
        rowNumber,
        columns.correctCol,
      ).toUpperCase();

      const rowIsBlank = !statement && options.length === 0 && !correctLetter;
      if (rowIsBlank) {
        continue;
      }
      totalLines++;

      if (!statement) {
        errors.push({ line: rowNumber, reason: 'Missing question statement' });
        continue;
      }
      if (options.length < 2) {
        errors.push({
          line: rowNumber,
          reason: 'At least 2 filled options are required',
        });
        continue;
      }
      if (!correctLetter) {
        errors.push({ line: rowNumber, reason: 'Correta column is empty' });
        continue;
      }
      if (!options.some((option) => option.letter === correctLetter)) {
        errors.push({
          line: rowNumber,
          reason: `Correta column ("${correctLetter}") does not match any filled option`,
        });
        continue;
      }

      // Image is validated per-row, alongside every other field — a bad
      // image only skips THIS row (reported in `errors`, exactly like a
      // missing statement or an unmatched Correta), it can never abort the
      // loop and strand the remaining rows unprocessed.
      const imageCandidates = imagesByRow.get(rowNumber) ?? [];
      let imageBuffer: Buffer | null = null;
      let imageExtension: ReturnType<typeof sniffImageFormat> = null;

      if (imageCandidates.length > 1) {
        errors.push({
          line: rowNumber,
          reason:
            'Foi encontrada mais de uma imagem para esta questão. O formato atual aceita apenas uma imagem por questão.',
        });
        continue;
      }
      if (imageCandidates.length === 1) {
        const candidate = imageCandidates[0];
        if (candidate.buffer.length > QUIZ_IMAGE_MAX_FILE_SIZE_BYTES) {
          errors.push({
            line: rowNumber,
            reason: `Imagem da linha ${rowNumber} excede o tamanho máximo permitido (${
              QUIZ_IMAGE_MAX_FILE_SIZE_BYTES / (1024 * 1024)
            }MB).`,
          });
          continue;
        }
        const detected = sniffImageFormat(candidate.buffer);
        if (!detected) {
          errors.push({
            line: rowNumber,
            reason: `Imagem da linha ${rowNumber}: formato não suportado. Utilize PNG, JPEG ou WEBP.`,
          });
          continue;
        }
        imageBuffer = candidate.buffer;
        imageExtension = detected;
      }

      let imageKey: string | null = null;
      if (imageBuffer && imageExtension) {
        imageKey = `courses/${targetModule.courseId}/modules/${moduleId}/quiz-images/${randomUUID()}.${fileExtensionForFormat(imageExtension)}`;
        try {
          await this.storage.putObject({
            key: imageKey,
            body: imageBuffer,
            contentType: contentTypeForFormat(imageExtension),
          });
        } catch {
          errors.push({
            line: rowNumber,
            reason: `Falha ao enviar a imagem da linha ${rowNumber} para o storage.`,
          });
          continue;
        }
      }

      try {
        await this.prisma.question.create({
          data: {
            moduleId,
            statement,
            imageKey,
            order: existingCount + imported,
            options: {
              create: options.map((option) => ({
                letter: option.letter,
                text: option.text,
                correct: option.letter === correctLetter,
              })),
            },
          },
        });
        imported++;
      } catch {
        // best-effort — never leave an orphaned upload behind just because
        // this one row's DB write failed; the loop still moves on
        if (imageKey) {
          await this.storage.delete(imageKey).catch(() => {});
        }
        errors.push({
          line: rowNumber,
          reason: 'Failed to save this question',
        });
      }
    }

    return { totalLines, imported, withError: errors.length, errors };
  }
}
