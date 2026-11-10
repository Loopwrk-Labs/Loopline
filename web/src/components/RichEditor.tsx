import { useEffect, useRef } from 'preact/hooks';
import { useT } from '../i18n';

/** Same whitelist as the server sanitizer (src/worker/lib/richtext.ts). The server is the real gate; this keeps pastes tidy. */
const ALLOW = new Set(['P', 'BR', 'DIV', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE']);
const DROP = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'SVG', 'MATH', 'TEMPLATE',
  'HEAD', 'TITLE', 'META', 'LINK', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'NOSCRIPT', 'CANVAS',
]);
const SAFE_HREF = /^(https?:|mailto:)/i;

export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createElement('div');
  const walk = (from: Node, to: Node) => {
    for (const n of [...from.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(n.textContent ?? ''));
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        const tag = el.tagName.toUpperCase();
        if (DROP.has(tag)) continue;
        // Office / Gmail wrappers and inline styles are unwrapped; only the whitelisted structure survives.
        if (!ALLOW.has(tag)) {
          walk(el, to);
          continue;
        }
        const href = tag === 'A' ? (el.getAttribute('href') ?? '').trim() : '';
        if (tag === 'A' && !SAFE_HREF.test(href)) {
          walk(el, to);
          continue;
        }
        const c = document.createElement(tag === 'DIV' ? 'p' : tag.toLowerCase());
        if (tag === 'A') {
          c.setAttribute('href', href);
          c.setAttribute('rel', 'noopener noreferrer nofollow');
          c.setAttribute('target', '_blank');
        }
        walk(el, c);
        to.appendChild(c);
      }
    }
  };
  walk(doc.body, out);
  // Drop empty paragraphs left at the start/end by the editor (Enter pressed at the end, etc.).
  const isEmpty = (n: ChildNode | null) =>
    !!n && ((n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()) || (n.nodeName === 'P' && !n.textContent?.replace(/\u00a0/g, '').trim() && !(n as Element).querySelector('a')) || n.nodeName === 'BR');
  while (isEmpty(out.lastChild)) out.lastChild!.remove();
  while (isEmpty(out.firstChild)) out.firstChild!.remove();
  return out.innerHTML;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Plain text (older messages) → simple paragraphs, so it can be edited in the rich editor. */
export const textToHtml = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

/** innerText-like plain version for search, filters and reply quotes. */
export function htmlToText(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

type Props = { html: string; onChange: (html: string, text: string) => void; minHeight?: string };

export function RichEditor({ html, onChange, minHeight = '200px' }: Props) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html; // set once; the editor owns its DOM afterwards
  }, []);
  const emit = () => ref.current && onChange(ref.current.innerHTML, htmlToText(ref.current));
  const cmd = (name: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, value);
    emit();
  };
  const link = () => {
    const url = window.prompt(t('rt_link_prompt'), 'https://');
    if (!url) return;
    const u = url.trim();
    if (!SAFE_HREF.test(u)) return;
    const sel = getSelection();
    if (sel && sel.isCollapsed) cmd('insertHTML', `<a href="${esc(u)}">${esc(u)}</a>`);
    else cmd('createLink', u);
  };
  const quote = () => {
    const inQuote = (() => {
      let n: Node | null | undefined = getSelection()?.anchorNode;
      while (n && n !== ref.current) {
        if (n.nodeName === 'BLOCKQUOTE') return true;
        n = n.parentNode;
      }
      return false;
    })();
    cmd('formatBlock', inQuote ? 'p' : 'blockquote');
  };
  const B = (label: string, title: string, onClick: () => void, cls = '') => (
    <button type="button" class={'rt-b ' + cls} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <div class="rt">
      <div class="rt-bar" role="toolbar" aria-label={t('rt_toolbar')}>
        {B('B', t('rt_bold') + ' (⌘B)', () => cmd('bold'), 'b')}
        {B('I', t('rt_italic') + ' (⌘I)', () => cmd('italic'), 'i')}
        {B('U', t('rt_underline') + ' (⌘U)', () => cmd('underline'), 'u')}
        <span class="rt-sep" />
        {B('•', t('rt_bullets'), () => cmd('insertUnorderedList'))}
        {B('1.', t('rt_numbers'), () => cmd('insertOrderedList'))}
        <span class="rt-sep" />
        {B('↗', t('rt_link'), link)}
        {B('❝', t('rt_quote'), quote)}
      </div>
      <div
        ref={ref}
        class="rt-area tl-rich"
        contentEditable
        role="textbox"
        aria-multiline="true"
        style={{ minHeight }}
        onInput={emit}
        onPaste={(e) => {
          const cd = e.clipboardData;
          if (!cd) return;
          e.preventDefault();
          const h = cd.getData('text/html');
          if (h) document.execCommand('insertHTML', false, cleanHtml(h));
          else document.execCommand('insertHTML', false, textToHtml(cd.getData('text/plain')));
          emit();
        }}
      />
    </div>
  );
}

/** Wraps case-insensitive hits of `q` in <mark class="hit"> inside already-sanitised HTML (text nodes only). */
export function highlightHtml(html: string, q: string): string {
  if (!q) return html;
  const box = document.createElement('div');
  box.innerHTML = html;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    const low = text.toLowerCase();
    if (!low.includes(q)) continue;
    const frag = document.createDocumentFragment();
    let i = 0;
    for (let j = low.indexOf(q); j !== -1; j = low.indexOf(q, i)) {
      frag.append(text.slice(i, j));
      const mk = document.createElement('mark');
      mk.className = 'hit';
      mk.textContent = text.slice(j, j + q.length);
      frag.append(mk);
      i = j + q.length;
    }
    frag.append(text.slice(i));
    node.replaceWith(frag);
  }
  return box.innerHTML;
}
