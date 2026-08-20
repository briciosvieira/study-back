import { Injectable } from '@nestjs/common';
import type { AuditEvent } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { sanitizeMetadata } from './sanitize-metadata.util';

export interface ExportContext {
  generatedByName: string;
  filtersDescription: string;
  periodDescription: string;
}

interface Column {
  key: string;
  label: string;
  width: number;
}

const COLUMNS: Column[] = [
  { key: 'date', label: 'Data', width: 78 },
  { key: 'severity', label: 'Severidade', width: 52 },
  { key: 'category', label: 'Categoria', width: 60 },
  { key: 'eventType', label: 'Evento', width: 100 },
  { key: 'actor', label: 'Actor', width: 70 },
  { key: 'target', label: 'Target', width: 70 },
  { key: 'method', label: 'Método', width: 40 },
  { key: 'route', label: 'Rota', width: 95 },
  { key: 'result', label: 'Resultado', width: 45 },
  { key: 'ip', label: 'IP', width: 65 },
  { key: 'details', label: 'Detalhes', width: 100 },
];

const ROW_HEIGHT = 12;

// Generated on demand and streamed straight to the response — nothing is
// ever written to R2 or kept around after the request finishes (a temp file
// under /tmp would be fine too, but pdfkit's own stream makes that
// unnecessary here).
@Injectable()
export class AuditExportService {
  generatePdf(events: AuditEvent[], context: ExportContext): PassThrough {
    const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' });
    const stream = new PassThrough();
    doc.pipe(stream);

    this.drawTitlePage(doc, context, events.length);
    doc.moveDown(1);

    let y = doc.y;
    const startX = doc.page.margins.left;
    const tableRight = startX + COLUMNS.reduce((sum, c) => sum + c.width, 0);

    const drawHeaderRow = () => {
      doc.font('Helvetica-Bold').fontSize(7.5);
      let x = startX;
      for (const col of COLUMNS) {
        doc.text(col.label, x, y, { width: col.width, ellipsis: true });
        x += col.width;
      }
      doc.font('Helvetica');
      y += ROW_HEIGHT;
      doc.moveTo(startX, y).lineTo(tableRight, y).strokeColor('#cccccc').stroke();
      y += 3;
    };

    drawHeaderRow();

    for (const event of events) {
      if (y > doc.page.height - doc.page.margins.bottom - ROW_HEIGHT) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow();
      }

      const row = this.toRow(event);
      let x = startX;
      doc.fontSize(7);
      for (const col of COLUMNS) {
        doc.text(row[col.key], x, y, { width: col.width, ellipsis: true });
        x += col.width;
      }
      y += ROW_HEIGHT;
    }

    doc.end();
    return stream;
  }

  private drawTitlePage(
    doc: PDFKit.PDFDocument,
    context: ExportContext,
    rowCount: number,
  ) {
    doc.fontSize(16).font('Helvetica-Bold').text('StudyJA');
    doc.fontSize(13).text('Relatório de Auditoria e Segurança');
    doc.font('Helvetica').fontSize(9).fillColor('#555555');
    doc.moveDown(0.5);
    doc.text(`Período: ${context.periodDescription}`);
    doc.text(`Filtros: ${context.filtersDescription}`);
    doc.text(`Gerado por: ${context.generatedByName}`);
    doc.text(`Gerado em: ${new Date().toISOString()}`);
    doc.text(`Registros: ${rowCount}`);
    doc.fillColor('#000000');
  }

  private toRow(event: AuditEvent): Record<string, string> {
    // Second sanitization pass on the way out, independent of the one
    // already applied when the event was recorded — defense in depth so a
    // secret can never reach the PDF even if one somehow slipped through.
    const safeMetadata = event.metadata ? sanitizeMetadata(event.metadata) : null;
    const details = safeMetadata ? JSON.stringify(safeMetadata).slice(0, 160) : '';

    return {
      date: event.createdAt.toISOString().replace('T', ' ').slice(0, 19),
      severity: event.severity,
      category: event.category,
      eventType: event.eventType,
      actor: event.actorName ?? '—',
      target: event.targetName ?? event.targetEmailMasked ?? '—',
      method: event.method ?? '—',
      route: event.route ?? '—',
      result: event.httpStatus !== null ? String(event.httpStatus) : '—',
      ip: event.ipAddress ?? '—',
      details,
    };
  }
}
