import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Workbook, Worksheet } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ImportResult, ImportRowError } from './dto/import-status.dto';
import {
  QUIZ_IMPORT_QUEUE,
  QUIZ_LETTER_HEADER_REGEX,
  QuizImportJobData,
  normalizeQuizText,
} from './quiz-import.constants';

interface ParsedColumns {
  statementCol: number;
  correctCol: number;
  letterCols: Map<string, number>; // letter -> column index
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
    } else if (QUIZ_LETTER_HEADER_REGEX.test(header)) {
      letterCols.set(header.toUpperCase(), colNumber);
    }
  });

  if (statementCol === -1 || correctCol === -1 || letterCols.size === 0) {
    throw new Error(
      'Invalid spreadsheet header — expected columns: Pergunta, A..F, Correta',
    );
  }

  return { statementCol, correctCol, letterCols };
}

@Processor(QUIZ_IMPORT_QUEUE)
export class QuizImportProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
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

      await this.prisma.question.create({
        data: {
          moduleId,
          statement,
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
    }

    return { totalLines, imported, withError: errors.length, errors };
  }
}
