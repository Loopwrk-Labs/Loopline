// Excel (.xlsx) import/export in the browser. ExcelJS is loaded only when needed.
import type { Item, Sprint, User } from './api';
import { fmtDate, type Lang } from './i18n';
import { dicts } from './i18n';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XL = any;
let lib: Promise<XL> | null = null;
export function loadExcel(): Promise<XL> {
  if (!lib) lib = import('exceljs/dist/exceljs.min.js').then((m: XL) => m.default ?? m);
  return lib;
}

export const FIELDS = ['key', 'type', 'title', 'parent', 'sprint', 'status', 'assignee', 'points', 'scope_hours', 'actual_hours', 'due_date', 'labels', 'description', 'note'] as const;
export type Field = (typeof FIELDS)[number];

/** Header text per field and language (export) — also used to auto-map on import. */
export const HEADERS: Record<Lang, Record<Field, string>> = {
  en: { key: 'Key', type: 'Type', title: 'Title', parent: 'Parent', sprint: 'Sprint', status: 'Status', assignee: 'Assignee', points: 'Points', scope_hours: 'Scope h', actual_hours: 'Actual h', due_date: 'Due', labels: 'Labels', description: 'Description', note: 'Note' },
  sr: { key: 'Ključ', type: 'Tip', title: 'Naslov', parent: 'Roditelj', sprint: 'Sprint', status: 'Status', assignee: 'Vlasnik', points: 'Poeni', scope_hours: 'Plan h', actual_hours: 'Stvarno h', due_date: 'Rok', labels: 'Oznake', description: 'Opis', note: 'Napomena' },
};
const SYNONYMS: Record<Field, string[]> = {
  key: ['key', 'kljuc', 'ključ', 'id', 'issue key'],
  type: ['type', 'tip', 'issue type', 'vrsta'],
  title: ['title', 'naslov', 'naziv', 'summary', 'name', 'ime'],
  parent: ['parent', 'roditelj', 'epic', 'epic link', 'parent key'],
  sprint: ['sprint'],
  status: ['status', 'stanje'],
  assignee: ['assignee', 'vlasnik', 'owner', 'dodeljeno', 'zaduzen', 'zadužen'],
  points: ['points', 'poeni', 'sp', 'story points', 'bodovi'],
  scope_hours: ['scope h', 'scope hours', 'scope', 'plan h', 'planirani sati', 'procena h', 'procena', 'estimate', 'original estimate', 'scopehours'],
  actual_hours: ['actual h', 'actual hours', 'actual', 'stvarno h', 'stvarni sati', 'utroseno', 'utrošeno', 'time spent', 'actualhours'],
  due_date: ['due', 'due date', 'rok', 'deadline', 'datum'],
  labels: ['labels', 'oznake', 'tags', 'label'],
  description: ['description', 'opis', 'details'],
  note: ['note', 'napomena', 'komentar', 'comment', 'notes'],
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export function autoMap(header: string): Field | '' {
  const h = norm(header);
  for (const f of FIELDS) if (SYNONYMS[f].some((x) => norm(x) === h)) return f;
  return '';
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return String(o.text);
    return '';
  }
  return String(v);
}

export type Sheet = { name: string; headers: string[]; rows: { row: number; cells: string[] }[] };

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

/** Read every sheet of an .xlsx (or a .csv) into header + rows. */
export async function readFile(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name)) {
    const grid = parseCsv((await file.text()).replace(/^﻿/, ''));
    const [head = [], ...rest] = grid;
    return [{ name: 'CSV', headers: head.map((h) => h.trim()), rows: rest.map((cells, i) => ({ row: i + 2, cells })).filter((r) => r.cells.some((c) => c.trim())) }];
  }
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheets: Sheet[] = [];
  wb.eachSheet((ws: XL) => {
    const headers: string[] = [];
    const headRow = ws.getRow(1);
    headRow.eachCell({ includeEmpty: true }, (cell: XL, col: number) => (headers[col - 1] = cellText(cell.value).trim()));
    const rows: Sheet['rows'] = [];
    ws.eachRow({ includeEmpty: false }, (r: XL, n: number) => {
      if (n === 1) return;
      const cells: string[] = [];
      for (let c = 1; c <= headers.length; c++) cells.push(cellText(r.getCell(c).value).trim());
      if (cells.some(Boolean)) rows.push({ row: n, cells });
    });
    sheets.push({ name: ws.name, headers, rows });
  });
  return sheets;
}

function download(buf: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type Ctx = { lang: Lang; projectKey: string; users: User[]; sprints: Sprint[]; items: Item[] };

const typeLabel = (lang: Lang, t: string) => dicts[lang][`ty_${t}` as keyof (typeof dicts)['en']];
const statusLabel = (lang: Lang, s: string) => dicts[lang][`st_${s}` as keyof (typeof dicts)['en']];

/** Builds a workbook with the Backlog sheet, a hidden Lists sheet for dropdowns, and instructions. */
async function workbook(ctx: Ctx, rows: Item[]) {
  const ExcelJS = await loadExcel();
  const { lang } = ctx;
  const H = HEADERS[lang];
  const cols: Field[] = ['key', 'type', 'title', 'parent', 'sprint', 'status', 'assignee', 'points', 'scope_hours', 'actual_hours', 'due_date', 'labels'];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Loopline';
  const ws = wb.addWorksheet('Backlog', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((f) => ({
    header: H[f],
    key: f,
    width: { key: 12, type: 10, title: 48, parent: 12, sprint: 14, status: 15, assignee: 20, points: 8, scope_hours: 10, actual_hours: 10, due_date: 12, labels: 18 }[f as string] ?? 12,
  }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFF4F3F1' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141417' } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  for (const it of rows) {
    ws.addRow({
      key: it.key,
      type: typeLabel(lang, it.type),
      title: it.title,
      parent: it.parent_id ? byId.get(it.parent_id)?.key ?? '' : '',
      sprint: it.sprint_id ? ctx.sprints.find((s) => s.id === it.sprint_id)?.name ?? '' : '',
      status: statusLabel(lang, it.status),
      assignee: it.assignee_id ? ctx.users.find((u) => u.id === it.assignee_id)?.name ?? '' : '',
      points: it.points ?? null,
      scope_hours: it.scope_hours ?? null,
      actual_hours: it.actual_hours ?? null,
      due_date: it.due_date ? new Date(it.due_date + 'T00:00:00Z') : null,
      labels: it.labels.replace(/;/g, '; '),
    });
  }
  ws.getColumn('due_date').numFmt = 'dd.mm.yyyy';
  for (const f of ['points', 'scope_hours', 'actual_hours']) ws.getColumn(f).numFmt = '0.##';

  // Lists for dropdowns.
  const lists = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const listData: Record<string, string[]> = {
    A: ['epic', 'story', 'bug', 'task'].map((t) => typeLabel(lang, t)),
    B: ['todo', 'in_progress', 'in_review', 'blocked', 'done'].map((s) => statusLabel(lang, s)),
    C: ['Backlog', ...ctx.sprints.filter((s) => s.status !== 'closed').map((s) => s.name)],
    D: ctx.users.filter((u) => u.active).map((u) => u.name),
  };
  for (const [col, vals] of Object.entries(listData)) vals.forEach((v, i) => (lists.getCell(`${col}${i + 1}`).value = v));
  const maxRow = Math.max(rows.length + 200, 500);
  const dv = (colLetter: string, listCol: string, n: number) => {
    for (let r = 2; r <= maxRow; r++) {
      ws.getCell(`${colLetter}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Lists!$${listCol}$1:$${listCol}$${Math.max(n, 1)}`], showErrorMessage: true };
    }
  };
  dv('B', 'A', listData.A.length);
  dv('E', 'C', listData.C.length);
  dv('F', 'B', listData.B.length);
  dv('G', 'D', listData.D.length);

  const help = wb.addWorksheet(lang === 'sr' ? 'Uputstvo' : 'Instructions');
  help.getColumn(1).width = 110;
  const lines =
    lang === 'sr'
      ? [
          'Loopline · Excel šablon',
          '',
          'Prazan Ključ = nova stavka. Postojeći ključ (npr. ' + ctx.projectKey + '-12) = izmena te stavke.',
          'Roditelj: ključ postojeće stavke (npr. ' + ctx.projectKey + '-E2) ili red iz ovog fajla, npr. "red 3".',
          'Epic nema roditelja. Story i Bug idu pod Epic. Task ide pod Story ili Bug.',
          'Tip, Sprint, Status i Vlasnik biraju se iz padajuće liste.',
          'Rok je datum (dd.mm.yyyy). Poeni i sati su brojevi (13,5 ili 13.5).',
          'Kolona Napomena (ako je dodate) postaje prvi unos u Logbook.',
          'Pre upisa Loopline prikazuje proveru, a ceo import može da se poništi jednim klikom.',
        ]
      : [
          'Loopline · Excel template',
          '',
          'Empty Key = new item. An existing key (e.g. ' + ctx.projectKey + '-12) = update that item.',
          'Parent: key of an existing item (e.g. ' + ctx.projectKey + '-E2) or a row in this file, e.g. "row 3".',
          'Epics have no parent. Stories and bugs go under an epic. Tasks go under a story or bug.',
          'Pick Type, Sprint, Status and Assignee from the dropdown lists.',
          'Due is a date (dd.mm.yyyy). Points and hours are numbers.',
          'A Note column (if you add one) becomes the first Logbook entry.',
          'Loopline shows a preview before writing, and a whole import can be undone in one click.',
        ];
  lines.forEach((l, i) => {
    const c = help.getCell(`A${i + 1}`);
    c.value = l;
    if (i === 0) c.font = { bold: true, size: 14 };
  });
  return wb;
}

export async function exportItems(ctx: Ctx, rows: Item[], fileName: string) {
  const wb = await workbook(ctx, rows);
  download(await wb.xlsx.writeBuffer(), fileName);
}

export async function downloadTemplate(ctx: Ctx) {
  const wb = await workbook(ctx, []);
  download(await wb.xlsx.writeBuffer(), `loopline-${ctx.projectKey}-template.xlsx`);
}

/** Full backup: one sheet per table. */
export async function exportBackup(data: { exported_at: string; tables: Record<string, Record<string, unknown>[]> }) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(data.tables)) {
    const ws = wb.addWorksheet(name.slice(0, 31));
    const cols = rows.length ? Object.keys(rows[0]) : ['(empty)'];
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(10, c.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(r);
  }
  download(await wb.xlsx.writeBuffer(), `loopline-backup-${data.exported_at.slice(0, 10)}.xlsx`);
}

export { fmtDate };
