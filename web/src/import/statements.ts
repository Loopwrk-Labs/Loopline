/**
 * Document (brief, contract, minutes) → statements for "Zapis".
 * Headings ("# " from Word, or numbered lines like "16. LOYALTY STRATEGIJA") become topics,
 * every paragraph becomes one statement, and a list (with the line introducing it, "Funkcionalnosti:") stays together as one
 * statement, so the card reads like the document. Word formatting (bold, italic, underline, colours, bullets) is kept as HTML.
 */
import { parseDateLoose } from './parse';
import type { Block } from './extract';

export type DocItem = { key: string; topic: string; section: string; quote: string; html: string | null; kind: Kind; include: boolean };
export type Kind = 'requirement' | 'promise' | 'claim' | 'decision' | 'question';

const HEAD_NUM = /^(\d{1,2})\.\s+([A-ZŠĐČĆŽ0-9&][A-ZŠĐČĆŽ0-9 &/,–—-]{2,})$/; // "16. LOYALTY STRATEGIJA"
// "AI I INOVACIJE" → "AI i inovacije": sentence case, but short all-caps words (AI, KPI, CRM) stay acronyms.
const SMALL = new Set(['I', 'U', 'ZA', 'NA', 'OD', 'DO', 'SA', 'SE', 'JE', 'ILI', 'KAO', 'PO', 'O', 'A', 'THE', 'AND', 'OF', 'TO', 'ŠTA', 'ŠTO', 'STA', 'STO', 'KAKO', 'GDE', 'KO']);
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text (PDF, Pages, RTF…) → blocks: "# " headings and "• " / "- " / "1." list lines become structure. */
function textBlocks(lines: string[]): Block[] {
  return lines.map((raw) => {
    const l = raw.trim();
    const h = l.match(/^#\s+(.*)$/);
    if (h) return { kind: 'h', level: 0, ordered: false, text: h[1], html: esc(h[1]) };
    const li = raw.match(/^(\s*)(?:[•▪◦·*–-]|(\d{1,2})[.)])\s+(.*)$/);
    if (li && !HEAD_NUM.test(l)) return { kind: 'li', level: Math.min(3, Math.floor(li[1].length / 2)), ordered: !!li[2], text: li[3], html: esc(li[3]) };
    return { kind: 'p', level: 0, ordered: false, text: l, html: esc(l) };
  });
}

/** List items → nested <ul>/<ol> by level. */
function listHtml(items: Block[]): string {
  let html = '';
  const stack: string[] = [];
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    while (stack.length > it.level + 1) html += `</li></${stack.pop()}>`;
    if (stack.length === it.level + 1) html += '</li>';
    while (stack.length < it.level + 1) {
      html += `<${tag}>`;
      stack.push(tag);
    }
    html += `<li>${it.html}`;
  }
  while (stack.length) html += `</li></${stack.pop()}>`;
  return html;
}

const ESTIMATE = /^(procena|procenjen\w*|okvirn\w* (cena|rok)|estimate\w*|ukupno|total)\b/i;

export function parseDocItems(text: string, docBlocks?: Block[]): { items: DocItem[]; title: string; date: number | null } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  let blocks: Block[] = (docBlocks ?? textBlocks(lines))
    .map((b) => ({ ...b, text: b.text.trim() }))
    .filter((b) => b.text && !/^[#•▪◦·*-]+$/.test(b.text)) // empty paragraph, heading or bullet
    .filter((b) => (b.text.match(/\s\|\s/g) ?? []).length < 2); // "Brief | Jun 2026 | Poverljivo" → document metadata
  // An all-caps first line is the document's title ("FUN&FIT DIGITAL ECOSYSTEM BRIEF").
  let capsTitle = '';
  if (blocks[0] && blocks[0].kind === 'p' && blocks[0].text === blocks[0].text.toUpperCase() && /\p{L}/u.test(blocks[0].text) && blocks[0].text.length < 80) {
    capsTitle = cap(blocks[0].text);
    blocks = blocks.slice(1);
  }
  blocks = blocks
    // A short paragraph that is bold from start to end is a sub-heading ("Website & CMS").
    .map((b) => (b.kind === 'p' && b.bold && b.text.length < 80 && !/[.:]$/.test(b.text) && !ESTIMATE.test(b.text) ? { ...b, kind: 'h' as const, level: 8 } : b));
  const isHead = (b: Block) => b.kind === 'h' || (b.kind !== 'li' && HEAD_NUM.test(b.text));
  // "Faza II", "Phase 3", "Etapa 1" outrank any other heading, whatever style the author gave them.
  const PHASE = /^(faza|phase|etapa|stage|sprint)\s+([ivx]+|\d+)\b/i;
  const levelOf = (b: Block) => (PHASE.test(b.text) ? 0.5 : b.kind === 'h' ? b.level : 1);

  // Topic level: the top heading level. A lone top heading followed by deeper ones is the document's title.
  let title = capsTitle;
  const heads = blocks.filter(isHead).filter((b) => levelOf(b) > 0);
  const titleBlock = blocks.find((b) => b.kind === 'h' && b.level === 0);
  if (titleBlock) title = cap(titleBlock.text);
  const levels = [...new Set(heads.map(levelOf))].sort((x, y) => x - y);
  let topLevel = levels[0] ?? 1;
  let skip: Block | null = null;
  if (levels.length > 1 && heads.filter((h) => levelOf(h) === topLevel).length === 1 && heads[0] && levelOf(heads[0]) === topLevel) {
    skip = heads[0];
    if (!title) title = cap(heads[0].text);
    topLevel = levels[1];
  }

  let topic = 'Uvod';
  let section = '';
  let n = 0;
  const items: DocItem[] = [];
  const push = (quote: string, html: string | null) => items.push({ key: `s${++n}`, topic, section, quote, html, kind: guessKind(quote), include: true });
  // Open card: a sub-heading with everything under it, or a list with the line introducing it, or price/time estimates.
  let card: { head: Block | null; body: Block[]; mode: 'sub' | 'list' | 'est' } | null = null;
  const close = () => {
    // A long sentence ending in ":" with nothing listed after it is still a statement ("Agencija je u obavezi da dostavi…:").
    if (card?.mode === 'list' && !card.body.length && card.head && card.head.text.length >= 80) push(card.head.text, `<p>${card.head.html}</p>`);
    if (card && (card.body.length || card.mode === 'sub')) {
      const { head, body } = card;
      const bullets = (bs: Block[]) => bs.map((it, i) => `${'  '.repeat(it.level)}${it.ordered ? `${i + 1}.` : '•'} ${it.text}`);
      const quote = [head?.text, ...body.map((b, i) => (b.kind === 'li' ? bullets([b])[0].replace(/^(\s*)1\./, `$1${i + 1}.`) : b.text))].filter(Boolean).join('\n');
      // Consecutive list items become one list; paragraphs stay paragraphs.
      let html = head ? (card.mode === 'sub' ? `<p><b>${head.html}</b></p>` : `<p>${head.html}</p>`) : '';
      let run: Block[] = [];
      for (const b of body) {
        if (b.kind === 'li') run.push(b);
        else {
          if (run.length) html += listHtml(run);
          run = [];
          html += `<p>${b.html}</p>`;
        }
      }
      if (run.length) html += listHtml(run);
      if (quote) push(quote, html);
    }
    card = null;
  };
  for (const blk of blocks) {
    const l = blk.text;
    if (blk === skip || blk === titleBlock) continue;
    if (isHead(blk)) {
      close();
      if (levelOf(blk) <= topLevel) {
        const nm = blk.kind === 'h' ? null : l.match(HEAD_NUM);
        const h = (nm ? `${nm[1]}. ${nm[2]}` : l).trim();
        const numbered = h.match(/^(\d{1,2})\.\s*(.*)$/);
        topic = cap(numbered ? numbered[2] : h);
        section = numbered ? `§${numbered[1]}` : '';
      } else card = { head: blk, body: [], mode: 'sub' };
      continue;
    }
    if (ESTIMATE.test(l)) {
      if (card?.mode !== 'est') {
        close();
        card = { head: null, body: [], mode: 'est' };
      }
      card!.body.push({ ...blk, kind: 'p' });
      continue;
    }
    if (card?.mode === 'est') close();
    if (card?.mode === 'sub') {
      card.body.push(blk);
      continue;
    }
    if (blk.kind === 'li') {
      if (!card) card = { head: null, body: [], mode: 'list' };
      card.body.push(blk);
      continue;
    }
    close();
    if (/:\s*$/.test(l) && l.length < 200) {
      card = { head: blk, body: [], mode: 'list' }; // waits for the list it introduces; alone it is context only
      continue;
    }
    push(l, blk.html !== esc(l) ? `<p>${blk.html}</p>` : null);
  }
  close();
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
