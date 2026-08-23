import JSZip from 'jszip';

// Reads embedded images directly from the .xlsx ZIP container instead of
// relying on exceljs's own drawing-reconciliation (Workbook.xlsx.load's
// worksheetXform.reconcile ends up doing `options.drawings[name].anchors`
// with NO guard for a missing/unreconciled drawing entry — a real xlsx
// produced by some tools trips this and crashes with "Cannot read
// properties of undefined (reading 'anchors')" deep inside the library,
// before any of our own code ever runs). This reader never touches that
// path: it opens the same buffer as a plain ZIP (via jszip — already a
// direct dependency of exceljs itself, so no new library was introduced)
// and walks the OOXML relationships by hand. Every step is defensive and
// returns an empty result instead of throwing, since a spreadsheet with no
// images at all — the overwhelming majority — has none of this structure
// to find.

export interface RowImageAnchor {
  row: number; // 1-based, matching worksheet.getRow()
  col: number; // 1-based, matching worksheet header column indices
  buffer: Buffer;
}

export async function readImageAnchorsFromXlsx(buffer: Buffer): Promise<RowImageAnchor[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return [];
  }

  const sheetPath = await resolveFirstSheetXmlPath(zip);
  if (!sheetPath) return [];

  const sheetXml = await readZipText(zip, sheetPath);
  if (!sheetXml) return [];

  const drawingRId = extractAttribute(sheetXml, /<drawing\b[^>]*\/?>/, 'r:id');
  if (!drawingRId) return []; // sheet has no <drawing> reference -> no images at all

  const sheetRelsXml = await readZipText(zip, relsPathFor(sheetPath));
  if (!sheetRelsXml) return [];

  const drawingTarget = extractRelationshipTarget(sheetRelsXml, drawingRId);
  if (!drawingTarget) return [];

  const drawingPath = resolveRelativePath(dirnameOf(sheetPath), drawingTarget);
  const drawingXml = await readZipText(zip, drawingPath);
  if (!drawingXml) return [];

  const drawingRelsXml = await readZipText(zip, relsPathFor(drawingPath));
  const imageTargetByRId = drawingRelsXml ? extractAllRelationshipTargets(drawingRelsXml) : new Map<string, string>();

  const anchors = extractAnchors(drawingXml);
  const results: RowImageAnchor[] = [];

  for (const anchor of anchors) {
    if (!anchor.embedRId) continue;
    const mediaTarget = imageTargetByRId.get(anchor.embedRId);
    if (!mediaTarget) continue;
    const mediaPath = resolveRelativePath(dirnameOf(drawingPath), mediaTarget);
    const mediaBuffer = await readZipBinary(zip, mediaPath);
    if (!mediaBuffer) continue;

    results.push({ row: anchor.rowFrom + 1, col: anchor.colFrom + 1, buffer: mediaBuffer });
  }

  return results;
}

// Produces a SEPARATE, in-memory copy of the .xlsx with every drawing
// reference removed — the <drawing r:id="..."/> tag stripped out of the
// first worksheet's XML, the matching relationship entry removed from that
// worksheet's .rels, and every xl/drawings/** part deleted outright. This
// is used ONLY as a fallback so exceljs can still parse cell VALUES when
// its own drawing-reconciliation code is what's crashing on this
// particular file (see isKnownDrawingReconcileBug below) — it closes off
// every code path in exceljs's reconcile() that touches drawings at all,
// which a narrower fix (e.g. XlsxReadOptions.ignoreNodes) does not fully
// guarantee, since more than one unguarded `.anchors` access exists inside
// the library. The user's original buffer is never mutated — this returns
// a new buffer, and image extraction always reads the ORIGINAL buffer via
// readImageAnchorsFromXlsx above, never this sanitized copy.
export async function stripDrawingsForSafeCellParsing(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  for (const path of Object.keys(zip.files)) {
    if (path.startsWith('xl/drawings/')) {
      zip.remove(path);
    }
  }

  const sheetPath = await resolveFirstSheetXmlPath(zip);
  if (sheetPath) {
    const sheetXml = await readZipText(zip, sheetPath);
    if (sheetXml) {
      const strippedSheetXml = sheetXml.replace(/<drawing\b[^>]*\/?>/g, '');
      if (strippedSheetXml !== sheetXml) {
        zip.file(sheetPath, strippedSheetXml);
      }
    }

    const relsPath = relsPathFor(sheetPath);
    const relsXml = await readZipText(zip, relsPath);
    if (relsXml) {
      const strippedRelsXml = removeRelationshipsByType(relsXml, '/relationships/drawing');
      if (strippedRelsXml !== relsXml) {
        zip.file(relsPath, strippedRelsXml);
      }
    }
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

function removeRelationshipsByType(relsXml: string, typeSuffix: string): string {
  return relsXml.replace(/<Relationship\b[^>]*\/?>/g, (tag) => {
    const typeMatch = /\bType="([^"]+)"/.exec(tag);
    return typeMatch && typeMatch[1].endsWith(typeSuffix) ? '' : tag;
  });
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  try {
    return await entry.async('string');
  } catch {
    return null;
  }
}

async function readZipBinary(zip: JSZip, path: string): Promise<Buffer | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  try {
    return await entry.async('nodebuffer');
  } catch {
    return null;
  }
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx + 1);
}

function relsPathFor(path: string): string {
  const idx = path.lastIndexOf('/');
  const dir = idx === -1 ? '' : path.slice(0, idx + 1);
  const base = idx === -1 ? path : path.slice(idx + 1);
  return `${dir}_rels/${base}.rels`;
}

// Resolves an OOXML relative Target (e.g. "../drawings/drawing1.xml")
// against the directory of the file that referenced it.
function resolveRelativePath(baseDir: string, relativeTarget: string): string {
  const baseParts = baseDir.replace(/\/$/, '').split('/').filter(Boolean);
  for (const part of relativeTarget.split('/')) {
    if (part === '..') baseParts.pop();
    else if (part !== '.' && part !== '') baseParts.push(part);
  }
  return baseParts.join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAttribute(xml: string, tagPattern: RegExp, attribute: string): string | null {
  const tagMatch = tagPattern.exec(xml);
  if (!tagMatch) return null;
  const attrMatch = new RegExp(`${escapeRegExp(attribute)}="([^"]+)"`).exec(tagMatch[0]);
  return attrMatch ? attrMatch[1] : null;
}

function extractRelationshipTarget(relsXml: string, rId: string): string | null {
  const re = /<Relationship\b[^>]*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(relsXml))) {
    const tag = match[0];
    const idMatch = /\bId="([^"]+)"/.exec(tag);
    if (idMatch?.[1] !== rId) continue;
    const targetMatch = /\bTarget="([^"]+)"/.exec(tag);
    return targetMatch ? targetMatch[1] : null;
  }
  return null;
}

function extractAllRelationshipTargets(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<Relationship\b[^>]*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(relsXml))) {
    const tag = match[0];
    const idMatch = /\bId="([^"]+)"/.exec(tag);
    const targetMatch = /\bTarget="([^"]+)"/.exec(tag);
    if (idMatch && targetMatch) {
      map.set(idMatch[1], targetMatch[1]);
    }
  }
  return map;
}

// Finds xl/workbook.xml's FIRST <sheet/> entry (document order === the same
// order exceljs's workbook.worksheets[0] resolves to) and follows its r:id
// through xl/_rels/workbook.xml.rels to the real sheet file path — never
// assumes it's literally "sheet1.xml" (that's usually true, but not
// guaranteed once a workbook has been reordered/edited by some tools).
async function resolveFirstSheetXmlPath(zip: JSZip): Promise<string | null> {
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  if (!workbookXml) return null;

  const firstSheetTag = /<sheet\b[^>]*\/?>/.exec(workbookXml);
  if (!firstSheetTag) return null;
  const rIdMatch = /\br:id="([^"]+)"/.exec(firstSheetTag[0]);
  if (!rIdMatch) return null;

  const workbookRelsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels');
  if (!workbookRelsXml) return null;

  const target = extractRelationshipTarget(workbookRelsXml, rIdMatch[1]);
  if (!target) return null;

  return resolveRelativePath('xl/', target);
}

interface RawAnchor {
  colFrom: number;
  rowFrom: number;
  embedRId: string | null;
}

// Matches both <xdr:twoCellAnchor> and <xdr:oneCellAnchor> — only the
// top-left ("from") cell and the embedded image's relationship id are
// needed; nothing here assumes a "to"/size ever exists.
function extractAnchors(drawingXml: string): RawAnchor[] {
  const anchors: RawAnchor[] = [];
  const blockRe = /<xdr:(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:\1>/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(drawingXml))) {
    const block = blockMatch[0];
    const fromBlockMatch = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(block);
    if (!fromBlockMatch) continue;
    const colMatch = /<xdr:col>(\d+)<\/xdr:col>/.exec(fromBlockMatch[1]);
    const rowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(fromBlockMatch[1]);
    if (!colMatch || !rowMatch) continue;

    const embedMatch = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(block);
    anchors.push({
      colFrom: Number(colMatch[1]),
      rowFrom: Number(rowMatch[1]),
      embedRId: embedMatch ? embedMatch[1] : null,
    });
  }
  return anchors;
}
