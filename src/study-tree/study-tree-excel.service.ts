import { Injectable } from '@nestjs/common';
import { Workbook, Worksheet } from 'exceljs';
import type { StudyTreeImportRow } from './study-tree.types';

const REQUIRED_HEADERS = ['node_code', 'parent_code', 'title', 'order'];

interface ParsedColumns {
  nodeCodeCol: number;
  parentCodeCol: number;
  titleCol: number;
  orderCol: number;
}

function cellText(worksheet: Worksheet, row: number, col: number): string {
  const value = worksheet.getRow(row).getCell(col).text;
  return (value ?? '').toString().trim();
}

function parseColumns(worksheet: Worksheet): ParsedColumns {
  const headerRow = worksheet.getRow(1);
  const cols: Partial<Record<string, number>> = {};

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = (cell.text ?? '').toString().trim().toLowerCase();
    if (REQUIRED_HEADERS.includes(header)) {
      cols[header] = colNumber;
    }
  });

  const missing = REQUIRED_HEADERS.filter((h) => !cols[h]);
  if (missing.length > 0) {
    throw new Error(
      `Cabeçalho da planilha inválido — colunas esperadas: node_code, parent_code, title, order (faltando: ${missing.join(', ')})`,
    );
  }

  return {
    nodeCodeCol: cols.node_code!,
    parentCodeCol: cols.parent_code!,
    titleCol: cols.title!,
    orderCol: cols.order!,
  };
}

// Everything Excel-shaped for the Study Tree feature lives here: parsing an
// uploaded workbook into plain rows, validating those rows as a whole tree
// (before anything ever touches the database), and generating the
// downloadable template. StudyTreeImportService owns turning validated rows
// into database rows; this file never talks to Prisma.
@Injectable()
export class StudyTreeExcelService {
  async parseWorkbook(buffer: Buffer): Promise<StudyTreeImportRow[]> {
    const workbook = new Workbook();
    // Same ambient-Buffer-typing mismatch noted in quiz-import.processor.ts —
    // same runtime value, unreconcilable typings clash from a nested dependency.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('A planilha não possui nenhuma aba');
    }

    const columns = parseColumns(worksheet);
    const rows: StudyTreeImportRow[] = [];

    for (let line = 2; line <= worksheet.rowCount; line++) {
      const nodeCode = cellText(worksheet, line, columns.nodeCodeCol);
      const parentCodeRaw = cellText(worksheet, line, columns.parentCodeCol);
      const title = cellText(worksheet, line, columns.titleCol);
      const orderRaw = cellText(worksheet, line, columns.orderCol);

      if (!nodeCode && !parentCodeRaw && !title && !orderRaw) {
        continue; // fully blank row — silently skipped, not an error
      }

      const parsedOrder = Number.parseInt(orderRaw, 10);

      rows.push({
        line,
        nodeCode,
        parentCode: parentCodeRaw || null,
        title,
        // normalized safely rather than hard-rejected — see spec section 22;
        // a missing/invalid order just falls back to the row's position
        // among the rows collected so far
        order: Number.isFinite(parsedOrder) ? parsedOrder : rows.length + 1,
      });
    }

    return rows;
  }

  // Validates the WHOLE tree at once and returns every problem found (not
  // just the first) — nothing is written to the database unless this
  // returns an empty array. Never mutates `rows`.
  validateRows(rows: StudyTreeImportRow[]): string[] {
    const errors: string[] = [];

    if (rows.length === 0) {
      return ['A planilha está vazia ou não contém linhas válidas.'];
    }

    const seenCodes = new Map<string, number>(); // code -> first line seen
    const byCode = new Map<string, StudyTreeImportRow>();

    for (const row of rows) {
      if (!row.nodeCode) {
        errors.push(`Linha ${row.line}: node_code é obrigatório.`);
        continue;
      }
      if (!row.title) {
        errors.push(`Linha ${row.line}: title é obrigatório.`);
      }
      if (seenCodes.has(row.nodeCode)) {
        errors.push(`Linha ${row.line}: node_code "${row.nodeCode}" está duplicado.`);
        continue;
      }
      seenCodes.set(row.nodeCode, row.line);
      byCode.set(row.nodeCode, row);
    }

    // Self-reference — reported specifically (and excluded from the generic
    // cycle graph below, so the same problem isn't reported twice).
    const selfReferencing = new Set<string>();
    for (const row of byCode.values()) {
      if (row.parentCode && row.parentCode === row.nodeCode) {
        errors.push(`Linha ${row.line}: "${row.nodeCode}" aponta para si mesmo como parent_code.`);
        selfReferencing.add(row.nodeCode);
      }
    }

    // Missing parent_code reference.
    for (const row of byCode.values()) {
      if (row.parentCode && row.parentCode !== row.nodeCode && !byCode.has(row.parentCode)) {
        errors.push(
          `Linha ${row.line}: parent_code "${row.parentCode}" não existe na planilha.`,
        );
      }
    }

    // Generic cycle detection (3-color DFS) over whatever parent edges are
    // otherwise valid — self-references and dangling parent_code references
    // are already reported above, so they're treated as rootless here to
    // avoid a second, more confusing error about the same row.
    const state = new Map<string, 'visiting' | 'done'>();
    const reportedCycles = new Set<string>();

    const visit = (code: string, path: string[]) => {
      if (state.get(code) === 'done') return;
      if (state.get(code) === 'visiting') {
        const cycleKey = [...path].sort().join('>');
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          errors.push(`Ciclo detectado entre os nodes: ${path.join(' → ')} → ${code}.`);
        }
        return;
      }
      state.set(code, 'visiting');
      const row = byCode.get(code);
      const parentCode = row?.parentCode;
      if (parentCode && parentCode !== code && !selfReferencing.has(code) && byCode.has(parentCode)) {
        visit(parentCode, [...path, code]);
      }
      state.set(code, 'done');
    };

    for (const code of byCode.keys()) {
      visit(code, [code]);
    }

    return errors;
  }

  async generateTemplateBuffer(): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Árvore de Estudos');
    sheet.columns = [
      { header: 'node_code', key: 'node_code', width: 14 },
      { header: 'parent_code', key: 'parent_code', width: 14 },
      { header: 'title', key: 'title', width: 30 },
      { header: 'order', key: 'order', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };

    const exampleRows = [
      { node_code: 'PT', parent_code: '', title: 'Português', order: 1 },
      { node_code: 'PT01', parent_code: 'PT', title: 'Locução', order: 1 },
      { node_code: 'PT0101', parent_code: 'PT01', title: 'Locução verbal', order: 1 },
      { node_code: 'PT0102', parent_code: 'PT01', title: 'Locução adjetiva', order: 2 },
      { node_code: 'PT02', parent_code: 'PT', title: 'Verbos', order: 2 },
      { node_code: 'PT0201', parent_code: 'PT02', title: 'Tempos verbais', order: 1 },
      { node_code: 'EN', parent_code: '', title: 'Inglês', order: 2 },
      { node_code: 'EN01', parent_code: 'EN', title: 'Reading', order: 1 },
      { node_code: 'EN0101', parent_code: 'EN01', title: 'Main idea', order: 1 },
    ];
    sheet.addRows(exampleRows);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
