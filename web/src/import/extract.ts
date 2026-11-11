/**
 * File → text (or parsed e-mails), entirely in the browser.
 * Word (.docx), OpenDocument (.odt), PDF, Apple Pages (via its embedded PDF preview), RTF, HTML,
 * plain text / CSV, e-mail (.eml, .mbox) and ZIP exports (WhatsApp/Viber).
 * Heavy libraries (PDF.js, JSZip, postal-mime) load only when a file needs them.
 */
import { newKey, stripQuoted, type Draft } from './parse';

export type Extracted = { kind: 'text'; text: string; name: string } | { kind: 'emails'; mails: Draft[]; name: string };

export class ImportError extends Error {}

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');

/** UTF-8 first; fall back to Windows-1250 (older Serbian Windows files) when UTF-8 clearly fails. */
function decodeText(buf: ArrayBuffer): string {
  const utf = new TextDecoder('utf-8').decode(buf);
  const bad = (utf.match(/�/g) ?? []).length;
  if (bad > 3 && bad > utf.length / 500) {
    try {
      return new TextDecoder('windows-1250').decode(buf);
    } catch {
      /* not supported: keep UTF-8 */
    }
  }
  return utf;
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,head').forEach((n) => n.remove());
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote').forEach((n) => n.append('\n'));
  return (doc.body?.textContent ?? '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n))
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function zipOf(buf: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  return JSZip.loadAsync(buf);
}

async function docxToText(buf: ArrayBuffer): Promise<string> {
  const zip = await zipOf(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new ImportError('Word fajl nema čitljiv tekst.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let line = '';
    p.querySelectorAll('*').forEach((n) => {
      if (n.namespaceURI !== W) return;
      if (n.localName === 't') line += n.textContent ?? '';
      else if (n.localName === 'tab') line += '\t';
      else if (n.localName === 'br' || n.localName === 'cr') line += '\n';
    });
    out.push(line);
  }
  return out.join('\n');
}

async function odtToText(buf: ArrayBuffer): Promise<string> {
  const zip = await zipOf(buf);
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new ImportError('OpenDocument fajl nema čitljiv tekst.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: string[] = [];
  doc.querySelectorAll('*').forEach((n) => {
    if (n.localName === 'p' || n.localName === 'h') out.push(n.textContent ?? '');
  });
  return out.join('\n');
}

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from positioned text runs (same y ≈ same line).
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x: it.transform[4], s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    let prevY: number | null = null;
    const lines: string[] = [];
    for (const r of rows) {
      if (prevY !== null && prevY - r.y > 22) lines.push(''); // paragraph gap
      lines.push(
        r.parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.s)
          .join('')
          .replace(/\s+$/, ''),
      );
      prevY = r.y;
    }
    pages.push(lines.join('\n'));
  }
  const text = pages.join('\n\n').trim();
  if (!text) throw new ImportError('PDF nema tekst (verovatno je skeniran kao slika). Izvezi ga ponovo kao tekst ili Word.');
  return text;
}

async function pagesToText(buf: ArrayBuffer): Promise<string> {
  // .pages is a ZIP with Apple's binary format; the readable part is the embedded PDF preview (when saved with one).
  const zip = await zipOf(buf);
  const pdf = Object.values(zip.files).find((f) => /\.pdf$/i.test(f.name));
  if (pdf) return pdfToText(await pdf.async('arraybuffer'));
  throw new ImportError('Ovaj Pages fajl nema PDF pregled. U Pages-u izaberi File → Export To → PDF ili Word, pa uvezi taj fajl.');
}

async function emlToDraft(raw: ArrayBuffer | string): Promise<Draft> {
  const { default: PostalMime } = await import('postal-mime');
  const m = await PostalMime.parse(raw);
  const addr = (a?: { name?: string; address?: string } | null) => (a ? (a.name ? `${a.name} <${a.address ?? ''}>` : a.address ?? '') : '');
  const text = m.text ?? (m.html ? htmlToText(m.html) : '');
  const body = stripQuoted(text);
  const date = m.date ? Date.parse(m.date) : NaN;
  return {
    key: newKey(),
    replyKey: null,
    from: addr(m.from as never),
    to: (m.to ?? []).map((x) => addr(x as never)).join(', '),
    subject: m.subject ?? '',
    body: body || text.trim(),
    // Keep the HTML only when nothing was cut (the server sanitises it to the rich-text whitelist).
    html: m.html && body === text.trim() ? m.html : null,
    sentAt: Number.isNaN(date) ? null : date,
    messageId: m.messageId ?? null,
    inReplyTo: m.inReplyTo ?? null,
  };
}

function splitMbox(text: string): string[] {
  return text
    .split(/\r?\n(?=From [^\r\n]*\r?\n)/)
    .map((c) => c.replace(/^From [^\r\n]*\r?\n/, ''))
    .filter((c) => /^[\w-]+:/m.test(c));
}

export async function extractFile(file: File): Promise<Extracted> {
  const name = file.name;
  const e = ext(name);
  const buf = await file.arrayBuffer();
  switch (e) {
    case 'eml':
      return { kind: 'emails', mails: [await emlToDraft(buf)], name };
    case 'mbox':
    case 'mbx': {
      const parts = splitMbox(decodeText(buf));
      if (!parts.length) throw new ImportError('U mbox fajlu nema mejlova.');
      return { kind: 'emails', mails: await Promise.all(parts.map((p) => emlToDraft(p))), name };
    }
    case 'docx':
      return { kind: 'text', text: await docxToText(buf), name };
    case 'odt':
      return { kind: 'text', text: await odtToText(buf), name };
    case 'pdf':
      return { kind: 'text', text: await pdfToText(buf), name };
    case 'pages':
      return { kind: 'text', text: await pagesToText(buf), name };
    case 'rtf':
      return { kind: 'text', text: rtfToText(decodeText(buf)), name };
    case 'html':
    case 'htm':
      return { kind: 'text', text: htmlToText(decodeText(buf)), name };
    case 'doc':
      throw new ImportError('Stari Word format (.doc) nije podržan. Otvori ga i sačuvaj kao .docx ili PDF.');
    case 'msg':
      throw new ImportError('Outlook .msg nije podržan. U Outlook-u sačuvaj poruku kao .eml ili je odštampaj u PDF.');
    case 'zip': {
      // WhatsApp/Viber exports come zipped together with media: use the chat text or e-mail files inside.
      const zip = await zipOf(buf);
      const files = Object.values(zip.files).filter((f) => !f.dir && !/^__MACOSX\//.test(f.name));
      const emls = files.filter((f) => /\.eml$/i.test(f.name));
      if (emls.length) return { kind: 'emails', mails: await Promise.all(emls.map(async (f) => emlToDraft(await f.async('arraybuffer')))), name };
      const txt = files.find((f) => /(_chat|chat).*\.txt$/i.test(f.name)) ?? files.find((f) => /\.(txt|csv)$/i.test(f.name));
      if (txt) return { kind: 'text', text: decodeText(await txt.async('arraybuffer')), name };
      throw new ImportError('U ZIP-u nema teksta četa ni mejlova.');
    }
    default:
      if (file.type.startsWith('image/') || /^(jpe?g|png|heic|gif|mp4|mov|opus|ogg|m4a)$/.test(e)) {
        throw new ImportError('Slike i snimci nemaju tekst za uvoz. Uvezi izvoz četa ili mejl.');
      }
      return { kind: 'text', text: decodeText(buf), name };
  }
}
