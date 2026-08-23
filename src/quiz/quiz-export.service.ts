import { Injectable, NotFoundException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import {
  QUIZ_HEADER_CORRECT,
  QUIZ_HEADER_STATEMENT,
  QUIZ_LETTER_HEADER_REGEX,
  toExcelEscapedText,
} from './quiz-import.constants';

function sanitizeFilenamePart(title: string): string {
  const decomposed = title.normalize('NFD');
  const withoutAccents = Array.from(decomposed)
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      // Strips Unicode combining diacritical marks (accents split off by
      // NFD normalization) without embedding a \u escape sequence here.
      return codePoint < 0x300 || codePoint > 0x36f;
    })
    .join('');
  const safe = withoutAccents.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'quiz';
}

// Inverse of QuizImportProcessor: Question/QuestionOption rows -> the exact
// same Excel layout the importer accepts, so the downloaded file can be
// edited and re-imported without reorganizing columns. Read-only — never
// touches the database.
@Injectable()
export class QuizExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportModule(moduleId: string) {
    const targetModule = await this.prisma.module.findUnique({
      where: { id: moduleId },
    });
    if (!targetModule) {
      throw new NotFoundException('Module not found');
    }

    const questions = await this.prisma.question.findMany({
      where: { moduleId },
      include: { options: true },
      orderBy: { order: 'asc' },
    });

    // Union of every letter actually used across this quiz's questions —
    // covers quizzes where not every question has the same option count —
    // restricted to the letters the importer itself recognizes (A-F).
    const letters = Array.from(
      new Set(
        questions.flatMap((question) =>
          question.options.map((option) => option.letter.toUpperCase()),
        ),
      ),
    )
      .filter((letter) => QUIZ_LETTER_HEADER_REGEX.test(letter))
      .sort();

    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Perguntas');

    worksheet.addRow([QUIZ_HEADER_STATEMENT, ...letters, QUIZ_HEADER_CORRECT]);
    worksheet.getRow(1).font = { bold: true };

    for (const question of questions) {
      const optionByLetter = new Map(
        question.options.map((option) => [option.letter.toUpperCase(), option]),
      );
      const correctOption = question.options.find((option) => option.correct);

      worksheet.addRow([
        toExcelEscapedText(question.statement),
        ...letters.map((letter) => {
          const option = optionByLetter.get(letter);
          return option ? toExcelEscapedText(option.text) : '';
        }),
        correctOption ? correctOption.letter.toUpperCase() : '',
      ]);
    }

    worksheet.columns.forEach((column) => {
      column.width = 40;
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = 'quiz_' + sanitizeFilenamePart(targetModule.title) + '.xlsx';

    return { buffer, filename };
  }
}
