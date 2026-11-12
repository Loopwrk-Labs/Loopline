/**
 * Document (brief, contract, minutes) → statements for "Zapis".
 * Headings ("# " from Word, or numbered lines like "16. LOYALTY STRATEGIJA") become topics,
 * every paragraph or list item becomes one statement. Intro lines ending with ":" are context, not statements.
 */
import { parseDateLoose } from './parse';

export type DocItem = { key: string; topic: string; section: string; quote: string; kind: Kind; include: boolean };
export type Kind = 'requirement' | 'promise' | 'claim' | 'decision' | 'question';

const HEAD_NUM = /^(\d{1,2})\.\s+([A-ZŠĐČĆŽ0-9&][A-ZŠĐČĆŽ0-9 &/,–—-]{2,})$/; // "16. LOYALTY STRATEGIJA"
// "AI I INOVACIJE" → "AI i inovacije": sentence case, but short all-caps words (AI, KPI, CRM) stay acronyms.
const SMALL = new Set(['I', 'U', 'ZA', 'NA', 'OD', 'DO', 'SA', 'SE', 'JE', 'ILI', 'KAO', 'PO', 'O', 'A', 'THE', 'AND', 'OF', 'TO']);
const cap = (s: string) => {
  if (s !== s.toUpperCase()) return s;
  return s
    .split(' ')
    .map((w, i) => {
      const keep = w.length <= 4 && /^[A-ZŠĐČĆŽ&]+$/.test(w) && !SMALL.has(w);
      const low = keep ? w : w.toLowerCase();
      return i === 0 && !keep ? low.charAt(0).toUpperCase() + low.slice(1) : low;
    })
    .join(' ');
};

function guessKind(s: string): Kind {
  const t = s.toLowerCase();
  if (/\?\s*$/.test(s)) return 'question';
  if (/\b(u roku|rok |roku od|deadline|do kraja|najkasnije|dostavi|isporuč|obavez)/.test(t)) return 'promise';
  if (/\b(odluč|dogovoren|usvojen|odobren|agreed|decided)/.test(t)) return 'decision';
  return 'requirement';
}

export function parseDocItems(text: string): { items: DocItem[]; title: string; date: number | null } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  let topic = 'Uvod';
  let section = '';
  let title = '';
  let n = 0;
  const items: DocItem[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[#•▪◦·*-]+$/.test(l)) continue; // empty heading / bullet
    const md = l.match(/^#\s+(.*)$/);
    const nm = md ? null : l.match(HEAD_NUM);
    if (md || nm) {
      const h = (md ? md[1] : `${nm![1]}. ${nm![2]}`).trim();
      const numbered = h.match(/^(\d{1,2})\.\s*(.*)$/);
      topic = cap(numbered ? numbered[2] : h);
      section = numbered ? `§${numbered[1]}` : '';
      if (!title && !items.length && !numbered) title = cap(h);
      continue;
    }
    const body = l.replace(/^[•▪◦·*-]\s+/, '');
    if (!title && !items.length && l === l.toUpperCase() && l.length < 80) {
      title = cap(l);
      continue;
    }
    if (/:\s*$/.test(body) && body.length < 80) continue; // "Funkcionalnosti:" → context only
    if ((body.match(/\s\|\s/g) ?? []).length >= 2) continue; // "Brief | Jun 2026 | Poverljivo" → document metadata
    items.push({ key: `s${++n}`, topic, section, quote: body, kind: guessKind(body), include: true });
  }
  // Document date: a full date, or "Jun 2026" (first of the month), from the first lines.
  let date: number | null = null;
  for (const l of lines.slice(0, 8)) {
    date = parseDateLoose(l);
    if (date) break;
    const my = l.toLowerCase().match(/\b(jan\w*|feb\w*|mar\w*|apr\w*|maj\w*|may|jun\w*|jul\w*|avg\w*|aug\w*|sep\w*|okt\w*|oct\w*|nov\w*|dec\w*)\s+(\d{4})\b/);
    if (my) {
      date = parseDateLoose(`1 ${my[1]} ${my[2]}`);
      if (date) break;
    }
  }
  return { items, title, date };
}
