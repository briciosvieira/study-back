import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
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
import { readImageAnchorsFromXlsx } from './quiz-image-xlsx-reader.util';

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

@Processor(QUIZ_IMPORT_QUEUE)
export class QuizImportProcessor extends WorkerHost {
  private readonly logger = new Logger(QuizImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  // Maps each data row (1-based, matching worksheet.getRow) to the image(s)
  // anchored specifically in the "Imagem" column on that row.
  //
  // Deliberately does NOT use exceljs's own Worksheet.getImages() /
  // Workbook.getImage() — those depend on exceljs's internal drawing
  // *reconciliation*, which happens unconditionally inside
  // workbook.xlsx.load() itself (worksheet-xform.js's reconcile()) and has
  // an unguarded `options.drawings[drawingName].anchors` access: if that
  // lookup misses (a real file whose drawing relationships exceljs doesn't
  // fully reconcile), `workbook.xlsx.load()` throws "Cannot read properties
  // of undefined (reading 'anchors')" from deep inside the library, before
  // ANY of our own code — including a try/catch around getImages() — ever
  // gets a chance to run. See quiz-import.constants... no: see
  // quiz-image-xlsx-reader.util.ts for the actual fix: read the same
  // .xlsx ZIP ourselves, bypassing that code path entirely. This method
  // itself never throws — a spreadsheet with no images (the overwhelming
  // majority) simply yields an empty map.
  private async collectImageCandidatesByRow(
    fileBuffer: Buffer,
    imageCol: number | null,
  ): Promise<Map<number, ImageCandidate[]>> {
    const byRow = new Map<number, ImageCandidate[]>();
    if (imageCol === null) {
      this.logger.log('[QUIZ XLSX IMPORT] image column ' + JSON.stringify({ exists: false }));
      return byRow;
    }
    this.logger.log(
      '[QUIZ XLSX IMPORT] image column ' + JSON.stringify({ exists: true, columnIndex: imageCol }),
    );

    let anchors: Awaited<ReturnType<typeof readImageAnchorsFromXlsx>>;
    try {
      anchors = await readImageAnchorsFromXlsx(fileBuffer);
    } catch (err) {
      // Belt-and-suspenders: readImageAnchorsFromXlsx is written to never
      // throw, but a spreadsheet is untrusted input — if some future edge
      // case does throw here, treat it as "no images found" rather than
      // failing the whole import over a cosmetic feature.
      this.logger.warn(
        `[QUIZ XLSX IMPORT] image parser falhou ao ler o ZIP — seguindo sem imagens: ${err instanceof Error ? err.message : String(err)}`,
      );
      return byRow;
    }

    this.logger.log(
      '[QUIZ XLSX IMPORT] image parser ' +
        JSON.stringify({ hasDrawing: anchors.length > 0, anchorCount: anchors.length }),
    );

    let imageIndex = 0;
    for (const anchor of anchors) {
      this.logger.log(
        '[QUIZ XLSX IMPORT] imagem encontrada ' +
          JSON.stringify({
            imageIndex: imageIndex++,
            row: anchor.row,
            column: anchor.col,
            size: anchor.buffer.length,
          }),
      );
      if (anchor.col !== imageCol) continue;

      this.logger.log(
        '[QUIZ XLSX IMPORT] imagem mapeada ' +
          JSON.stringify({ worksheetRow: anchor.row, imageColumn: anchor.col, questionRow: anchor.row }),
      );

      const list = byRow.get(anchor.row) ?? [];
      list.push({ buffer: anchor.buffer });
      byRow.set(anchor.row, list);
    }

    return byRow;
  }

  async process(
    job: Job<QuizImportJobData, ImportResult>,
  ): Promise<ImportResult> {
    const { moduleId, fileName, fileBase64 } = job.data;
    const fileBuffer = Buffer.from(fileBase64, 'base64');

    this.logger.log(
      '[QUIZ XLSX IMPORT] início ' + JSON.stringify({ fileName, size: fileBuffer.length }),
    );

    let stage = 'load-workbook';
    try {
      const workbook = new Workbook();
      // 1) `ignoreNodes: ['drawing']` tells exceljs to skip the <drawing>
      //    reference inside the worksheet XML entirely while parsing cell
      //    text — this is what keeps the buggy reconcile() path (see
      //    collectImageCandidatesByRow's comment above) from ever running,
      //    for EVERY file, not just ones that happen to trip it. Cell
      //    values are completely unaffected: this only skips the drawing
      //    reference, never rows/cells.
      // 2) exceljs resolves a stale, differently-shaped ambient `Buffer`
      //    type (via a nested dependency's older @types/node) than the
      //    rest of this project — same runtime value, unreconcilable
      //    typings clash.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await workbook.xlsx.load(fileBuffer as any, { ignoreNodes: ['drawing'] });
      this.logger.log(
        '[QUIZ XLSX IMPORT] workbook ' + JSON.stringify({ worksheets: workbook.worksheets.length }),
      );

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new Error('Spreadsheet has no sheets');
      }
      this.logger.log(
        '[QUIZ XLSX IMPORT] worksheet ' +
          JSON.stringify({ name: worksheet.name, rowCount: worksheet.rowCount, columnCount: worksheet.columnCount }),
      );

      stage = 'parse-headers';
      const columns = parseColumns(worksheet);
      const headerValues = (worksheet.getRow(1).values as unknown[])
        .slice(1)
        .map((v) => (v ?? '').toString());
      this.logger.log('[QUIZ XLSX IMPORT] headers ' + JSON.stringify(headerValues));

      stage = 'read-images';
      const imagesByRow = await this.collectImageCandidatesByRow(fileBuffer, columns.imageCol);

      stage = 'load-module';
      const targetModule = await this.prisma.module.findUnique({
        where: { id: moduleId },
      });
      if (!targetModule) {
        throw new Error('Module not found');
      }

      stage = 'import-rows';
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
        // missing statement or an unmatched Correta), it can never abort
        // the loop and strand the remaining rows unprocessed.
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
          } catch (uploadErr) {
            this.logger.error(
              `[QUIZ XLSX IMPORT] falha ao enviar imagem da linha ${rowNumber} para o storage: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`,
            );
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
        } catch (dbErr) {
          // best-effort — never leave an orphaned upload behind just
          // because this one row's DB write failed; the loop still moves on
          if (imageKey) {
            await this.storage.delete(imageKey).catch(() => {});
          }
          this.logger.error(
            `[QUIZ XLSX IMPORT] falha ao salvar questão da linha ${rowNumber}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          );
          errors.push({
            line: rowNumber,
            reason: 'Failed to save this question',
          });
        }
      }

      return { totalLines, imported, withError: errors.length, errors };
    } catch (error) {
      // Full detail server-side only — never sent to the client. BullMQ
      // catches this rejection itself (this is the job's own async
      // process() promise, not a bare uncaught exception), marks the job
      // failed, and the NestJS process keeps running normally; the
      // frontend learns about it only through the polled job status.
      this.logger.error(
        `[QUIZ XLSX IMPORT] ERRO ${JSON.stringify({
          stage,
          message: error instanceof Error ? error.message : String(error),
        })}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Não foi possível importar o Quiz (etapa: ${stage}). Verifique o arquivo e tente novamente.`,
      );
    }
  }
}
