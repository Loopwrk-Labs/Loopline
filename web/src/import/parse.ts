/**
 * Text → correspondence drafts. Pure functions (no DOM), so they run in the browser and in tests.
 *
 * Recognised shapes:
 *  - chat exports: WhatsApp (iOS/Android), Viber, Telegram-like "date, time - Name: text"
 *  - Viber CSV ("date,time,sender,phone,message")
 *  - e-mail threads pasted or saved as text/Word/PDF: "From:/Sent:/To:/Subject:" blocks (EN, SR, DE, FR)
 *    and "On … wrote:" / "… je napisao/la:" quote headers; ">" quoting removed
 *  - anything else: "Name: text" speaker lines, or the whole text as one message
 */

export type Draft = {
  key: string;
  /** key of the draft this one answers (inside the same import) */
  replyKey: string | null;
  from: string;
  to: string;
  subject: string;
  body: string;
  html?: string | null;
  /** epoch ms, or null when the source had no usable date */
  sentAt: number | null;
  messageId?: string | null;
  inReplyTo?: string | null;
};
export type ParseResult = { format: Format; drafts: Draft[]; title: string; chain: boolean };
export type Format = 'whatsapp' | 'viber' | 'chat' | 'email-text' | 'email' | 'speakers' | 'plain';

let seq = 0;
const nk = () => `d${++seq}`;

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, januara: 1, feb: 2, februar: 2, february: 2, februara: 2, mar: 3, mart: 3, march: 3, marta: 3,
  apr: 4, april: 4, aprila: 4, maj: 5, may: 5, maja: 5, jun: 6, juni: 6, june: 6, juna: 6, jul: 7, juli: 7, july: 7, jula: 7,
  avg: 8, aug: 8, avgust: 8, august: 8, avgusta: 8, sep: 9, sept: 9, septembar: 9, september: 9, septembra: 9,
  okt: 10, oct: 10, oktobar: 10, october: 10, oktobra: 10, nov: 11, novembar: 11, november: 11, novembra: 11,
  dec: 12, decembar: 12, december: 12, decembra: 12, dez: 12, mär: 3, mai: 5, okt_: 10,
};

/** Lenient date parser for what people paste: "11.11.2026. 10:05", "Tue, Nov 10, 2026 at 9:14 AM",
 *  "uto, 10. nov 2026. u 09:14", "2026-11-10 09:14", "10 November 2026 09:14". Local time. */
export function parseDateLoose(input: string, dayFirst = true): number | null {
  if (!input) return null;
  let s = input.toLowerCase().replace(/[‎‏  ]/g, ' ').replace(/\s+/g, ' ').trim();
  // ISO with time zone → exact
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(s)) {
    const v = Date.parse(input.trim());
    if (!Number.isNaN(v)) return v;
  }
  // RFC 2822 with numeric zone ("Tue, 10 Nov 2026 09:14:00 +0100") → exact
  const rfc = s.match(/(\d{1,2}) ([a-z]{3})[a-z]* (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? ([+-]\d{4})/);
  if (rfc && MONTHS[rfc[2]]) {
    const z = rfc[7];
    const off = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3)));
    return Date.UTC(+rfc[3], MONTHS[rfc[2]] - 1, +rfc[1], +rfc[4], +rfc[5], +(rfc[6] ?? 0)) - off * 60_000;
  }
  let h = 12, mi = 0;
  const tm = s.match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])\.?\s?m\.?/) ?? s.match(/(?:^|[\s,u@at])(\d{1,2}):(\d{2})(?::\d{2})?(?!\d)/);
  if (tm) {
    h = +tm[1];
    mi = +tm[2];
    if (tm[3]) {
      if (tm[3] === 'p' && h < 12) h += 12;
      if (tm[3] === 'a' && h === 12) h = 0;
    }
    s = s.replace(tm[0], ' ');
  }
  let y: number | null = null, m: number | null = null, d: number | null = null;
  const num = s.match(/(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})/);
  if (num) {
    if (num[1].length === 4) [y, m, d] = [+num[1], +num[2], +num[3]];
    else {
      const a = +num[1], b = +num[2];
      y = +num[3];
      if (a > 12) [d, m] = [a, b];
      else if (b > 12) [m, d] = [a, b];
      else [d, m] = dayFirst ? [a, b] : [b, a];
    }
  } else {
    const words = s.split(/[^a-zščćžđäöüé]+/).filter(Boolean);
    const mw = words.find((w) => MONTHS[w] || MONTHS[w.slice(0, 3)]);
    if (!mw) return null;
    m = MONTHS[mw] ?? MONTHS[mw.slice(0, 3)];
    const yr = s.match(/\b(\d{4})\b/);
    const dy = s.replace(yr?.[0] ?? '', ' ').match(/\b(\d{1,2})\b/);
    if (!yr || !dy) return null;
    y = +yr[1];
    d = +dy[1];
  }
  if (y !== null && y < 100) y += 2000;
  if (!y || !m || !d || m > 12 || d > 31 || h > 23 || mi > 59) return null;
  const v = new Date(y, m - 1, d, h, mi).getTime();
  return Number.isNaN(v) ? null : v;
}

// ---------------------------------------------------------------- helpers

const clean = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[‎‏﻿]/g, '').replace(/ /g, ' ');
const trimBody = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
export const normSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|wg|odg|sv|tr)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();

// ---------------------------------------------------------------- chat exports

// "[11.11.26, 10:05:12] Marko: hi"  |  "11/11/2026, 10:05 - Marko: hi"  |  "11.11.2026. 10:05 Marko: hi"
const CHAT = /^\[?(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})\.?,?\s+(?:u\s+|at\s+)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*[-–—]?\s*([^:\n]{1,80}?):\s?(.*)$/i;
const CHAT_SYS = /^\[?(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})\.?,?\s+(?:u\s+|at\s+)?(\d{1,2})[:.](\d{2})/;

function parseChat(text: string): { drafts: Draft[]; who: string[] } | null {
  const lines = clean(text).split('\n');
  const hits = lines.filter((l) => CHAT.test(l)).length;
  if (hits < 2 || hits < lines.filter((l) => l.trim()).length * 0.3) return null;
  // Day/month order: decide from the values seen (US exports are month-first, AM/PM is a strong hint).
  let dayFirst = true;
  let decided = false;
  for (const l of lines) {
    const m = l.match(CHAT);
    if (!m || m[1].length === 4) continue;
    if (+m[1] > 12) { dayFirst = true; decided = true; break; }
    if (+m[2] > 12) { dayFirst = false; decided = true; break; }
  }
  if (!decided && lines.some((l) => CHAT.exec(l)?.[7])) dayFirst = false;
  const drafts: Draft[] = [];
  for (const l of lines) {
    const m = l.match(CHAT);
    if (m) {
      let [, a, b, c, hh, mm, , ap, who, msg] = m;
      let y: number, mo: number, d: number;
      if (a.length === 4) [y, mo, d] = [+a, +b, +c];
      else [d, mo, y] = dayFirst ? [+a, +b, +c] : [+b, +a, +c];
      if (y < 100) y += 2000;
      let h = +hh;
      if (ap) {
        const p = ap.toLowerCase()[0];
        if (p === 'p' && h < 12) h += 12;
        if (p === 'a' && h === 12) h = 0;
      }
      drafts.push({ key: nk(), replyKey: null, from: who.trim(), to: '', subject: '', body: msg, sentAt: new Date(y, mo - 1, d, h, +mm).getTime() });
    } else if (CHAT_SYS.test(l)) {
      continue; // system line ("Messages are end-to-end encrypted", "X added Y")
    } else if (drafts.length) {
      drafts[drafts.length - 1].body += '\n' + l;
    }
  }
  drafts.forEach((d) => (d.body = trimBody(d.body)));
  const who = [...new Set(drafts.map((d) => d.from))];
  return { drafts: drafts.filter((d) => d.body), who };
}

// ---------------------------------------------------------------- Viber CSV

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseViberCsv(text: string): Draft[] | null {
  const rows = clean(text).split('\n').filter((l) => l.trim()).map(splitCsv);
  const ok = rows.filter((r) => r.length >= 4 && /^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/.test(r[0].trim()) && /^\d{1,2}:\d{2}/.test(r[1].trim()));
  if (ok.length < 2 || ok.length < rows.length * 0.5) return null;
  return ok.map((r) => ({
    key: nk(),
    replyKey: null,
    from: r[2].trim() || r[3].trim(),
    to: '',
    subject: '',
    body: trimBody(r[r.length - 1]),
    sentAt: parseDateLoose(`${r[0]} ${r[1]}`),
  }));
}

// ---------------------------------------------------------------- e-mail threads as text

const H_FROM = /^\s*\*?(from|od|šalje|salje|pošiljalac|posiljalac|pošiljaoc|von|de|van)\s*\*?\s*:\s*(.+)$/i;
const H_DATE = /^\s*\*?(sent|date|datum|poslato|poslano|gesendet|envoyé|envoye|datum slanja)\s*\*?\s*:\s*(.+)$/i;
const H_TO = /^\s*\*?(to|za|prima|an|à|a|primalac)\s*\*?\s*:\s*(.*)$/i;
const H_CC = /^\s*\*?(cc|kopija|cc\/kopija)\s*\*?\s*:\s*(.*)$/i;
const H_SUBJ = /^\s*\*?(subject|naslov|tema|predmet|betreff|objet)\s*\*?\s*:\s*(.*)$/i;
const WROTE = /^(?:on\s+(.+?)\s+wrote:|(.+?)\s+je\s+napisa(?:o\/la|la|o)\s*:|am\s+(.+?)\s+schrieb\s+.*:|le\s+(.+?)\s+a\s+écrit\s*:)$/i;
const SEP = /^\s*(-{2,}\s*(original message|izvorna poruka|originalna poruka|prosleđena poruka|forwarded message|ursprüngliche nachricht)\s*-{2,}|[-_=]{8,})\s*$/i;
const NOISE = /^(sent from my (iphone|ipad|android|mobile)|poslato sa mog (iphone|ipad|telefona)|get outlook for (ios|android))/i;

/** Splits "date, Name <mail>" from an "On … wrote:" header. */
function splitWrote(inner: string): { date: number | null; who: string } {
  const t = inner.match(/^(.*?\d{1,2}[:.]\d{2}(?:\s*[ap]\.?\s?m\.?)?)\s*,?\s*(.+)$/i);
  if (t) return { date: parseDateLoose(t[1]), who: t[2].replace(/^(at|u)\s+/i, '').trim() };
  return { date: parseDateLoose(inner), who: inner };
}

function parseEmailText(text: string): Draft[] | null {
  // unquote ("> > text" → "text") and join wrapped "On … \n wrote:" headers
  const raw = clean(text).split('\n').map((l) => l.replace(/^(\s*>\s?)+/, ''));
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    if (/^(on\s|.*\d{4}.*\d{1,2}:\d{2})/i.test(l.trim()) && !WROTE.test(l.trim()) && i + 1 < raw.length && WROTE.test((l.trim() + ' ' + raw[i + 1].trim()).trim())) {
      lines.push(l.trim() + ' ' + raw[i + 1].trim());
      i++;
    } else lines.push(l);
  }
  const headerCount = lines.filter((l) => H_FROM.test(l)).length + lines.filter((l) => WROTE.test(l.trim())).length;
  const hasDates = lines.some((l) => H_DATE.test(l)) || lines.some((l) => WROTE.test(l.trim()));
  if (!headerCount || !hasDates) return null;

  type Blk = { from: string; to: string; subject: string; date: number | null; body: string[] };
  const blocks: Blk[] = [{ from: '', to: '', subject: '', date: null, body: [] }];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (SEP.test(l) || NOISE.test(l.trim())) continue;
    const w = l.trim().match(WROTE);
    if (w) {
      const { date, who } = splitWrote(w[1] ?? w[2] ?? w[3] ?? w[4] ?? '');
      blocks.push({ from: who, to: '', subject: '', date, body: [] });
      continue;
    }
    const f = l.match(H_FROM);
    if (f) {
      // A header block: From followed (within a few lines) by Sent/To/Subject.
      const b: Blk = { from: f[2].trim(), to: '', subject: '', date: null, body: [] };
      let j = i + 1;
      for (; j < lines.length && j <= i + 8; j++) {
        const x = lines[j];
        let mm: RegExpMatchArray | null;
        if ((mm = x.match(H_DATE))) b.date = parseDateLoose(mm[2]);
        else if ((mm = x.match(H_TO))) b.to = mm[2].trim();
        else if ((mm = x.match(H_CC))) continue;
        else if ((mm = x.match(H_SUBJ))) b.subject = mm[2].trim();
        else if (!x.trim()) { if (b.date || b.subject) { j++; break; } }
        else break;
      }
      if (blocks.length === 1 && !blocks[0].body.join('').trim()) blocks.pop();
      blocks.push(b);
      i = j - 1;
      continue;
    }
    blocks[blocks.length - 1].body.push(l);
  }
  const msgs = blocks.map((b) => ({ ...b, text: trimBody(b.body.join('\n')) })).filter((b) => b.text || b.from);
  if (msgs.length < 1) return null;
  // The newest message is usually on top. Order by date when known, otherwise reverse the file order.
  const known = msgs.filter((b) => b.date !== null).length;
  const ordered = known >= msgs.length - 1 ? [...msgs].sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity)) : [...msgs].reverse();
  const subject = ordered.map((b) => b.subject).find(Boolean) ?? '';
  const drafts: Draft[] = [];
  ordered.forEach((b) => {
    const d: Draft = {
      key: nk(),
      replyKey: drafts.length ? drafts[drafts.length - 1].key : null,
      from: b.from,
      to: b.to,
      subject: b.subject || (drafts.length && subject ? `Re: ${normSubject(subject)}` : subject),
      body: b.text,
      sentAt: b.date,
    };
    drafts.push(d);
  });
  return drafts.filter((d) => d.body);
}

// ---------------------------------------------------------------- "Name: text" and plain text

const SPEAKER = /^([A-ZŠĐČĆŽ][\p{L} .'’-]{1,40}?)\s*:\s+(.*)$/u;
function parseSpeakers(text: string): Draft[] | null {
  const lines = clean(text).split('\n');
  const hits = lines.filter((l) => SPEAKER.test(l));
  const names = new Set(hits.map((l) => l.match(SPEAKER)![1]));
  if (hits.length < 2 || names.size < 2 || names.size > 12) return null;
  const drafts: Draft[] = [];
  for (const l of lines) {
    const m = l.match(SPEAKER);
    if (m && names.has(m[1])) drafts.push({ key: nk(), replyKey: null, from: m[1].trim(), to: '', subject: '', body: m[2], sentAt: null });
    else if (drafts.length) drafts[drafts.length - 1].body += '\n' + l;
  }
  drafts.forEach((d) => (d.body = trimBody(d.body)));
  return drafts.filter((d) => d.body);
}

// ---------------------------------------------------------------- entry point

export function parseText(text: string, fileName = ''): ParseResult {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const chat = parseChat(text);
  if (chat) {
    const wa = /whatsapp/i.test(fileName) || /end-to-end|messages and calls|poruke i pozivi/i.test(text);
    const label = wa ? 'WhatsApp' : /viber/i.test(fileName) ? 'Viber' : 'Čet';
    const chatName = base.replace(/^(whatsapp\s*(chat|čet)?\s*(with|sa|-|–)?|viber\s*(chat)?\s*(-|–)?|_chat|chat)\s*/i, '').trim();
    return { format: wa ? 'whatsapp' : 'chat', drafts: chat.drafts, title: `${label}${chatName ? ' · ' + chatName : ''}`, chain: false };
  }
  const viber = parseViberCsv(text);
  const vb = base.replace(/^viber\s*(chat)?\s*[-–]?\s*/i, '').trim();
  if (viber) return { format: 'viber', drafts: viber, title: `Viber${vb ? ' · ' + vb : ''}`, chain: false };
  const mail = parseEmailText(text);
  if (mail && mail.length) return { format: 'email-text', drafts: mail, title: normSubject(mail[0].subject) || base, chain: true };
  // Notes without timestamps: if the first lines carry a date ("Sastanak FNF, 11.11.2026."), use it as the base.
  const head = clean(text).split('\n').slice(0, 5).map((l) => l.trim()).filter(Boolean);
  const baseDate = head.map((l) => (/\d/.test(l) ? parseDateLoose(l) : null)).find((v) => v !== null) ?? null;
  const stamp = (ds: Draft[]) => (baseDate === null ? ds : ds.map((d, i) => ({ ...d, sentAt: d.sentAt ?? baseDate + i * 60_000 })));
  const sp = parseSpeakers(text);
  if (sp) return { format: 'speakers', drafts: stamp(sp), title: base, chain: false };
  const body = trimBody(clean(text));
  return { format: 'plain', drafts: body ? stamp([{ key: nk(), replyKey: null, from: '', to: '', subject: base, body, sentAt: null }]) : [], title: base, chain: false };
}

/** E-mails (already parsed from .eml/.mbox) → drafts: replies linked by In-Reply-To, else by subject and time. */
export function threadEmails(mails: Draft[]): Draft[] {
  const sorted = [...mails].sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));
  const byMsgId = new Map(sorted.filter((m) => m.messageId).map((m) => [m.messageId!, m]));
  sorted.forEach((m, i) => {
    const p = m.inReplyTo ? byMsgId.get(m.inReplyTo) : undefined;
    if (p) m.replyKey = p.key;
    else {
      const prev = [...sorted.slice(0, i)].reverse().find((x) => normSubject(x.subject).toLowerCase() === normSubject(m.subject).toLowerCase());
      m.replyKey = prev ? prev.key : null;
    }
  });
  return sorted;
}

/** Removes the quoted history under a reply in an e-mail body, so a thread import has no duplicates. */
export function stripQuoted(body: string): string {
  const lines = clean(body).split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const joined = (t + ' ' + (lines[i + 1] ?? '').trim()).trim();
    if (WROTE.test(t) || (/^on\s/i.test(t) && WROTE.test(joined)) || SEP.test(t) || (H_FROM.test(t) && lines.slice(i + 1, i + 5).some((x) => H_DATE.test(x) || H_SUBJ.test(x)))) break;
    if (/^\s*>/.test(lines[i])) continue;
    out.push(lines[i]);
  }
  return trimBody(out.join('\n'));
}

export const newKey = nk;
