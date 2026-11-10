/**
 * Server-side sanitizer for rich-text message bodies. Uses the Workers HTMLRewriter (a spec-compliant
 * streaming HTML parser) to keep only a small whitelist of formatting tags and safe links.
 */
const ALLOW = new Set(['p', 'br', 'div', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'blockquote']);
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'img', 'picture', 'video', 'audio', 'source',
  'svg', 'math', 'template', 'head', 'title', 'meta', 'link', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option',
  'noscript', 'canvas', 'xml',
]);
const SAFE_HREF = /^(https?:|mailto:)/i;
// Text colours: the editor produces <font color="…">; only these three are kept, stored as <span class="tc-…">.
const FONT_COLORS: Record<string, string> = { '#dc2626': 'red', '#ca8a04': 'yellow', '#16a34a': 'green' };
const SPAN_CLASS = /^tc-(red|yellow|green)$/;

export async function sanitizeRichText(input: unknown, maxLen = 200_000): Promise<string | null> {
  if (typeof input !== 'string' || !input.trim()) return null;
  const res = new HTMLRewriter()
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'font' || tag === 'span') {
          const c = tag === 'font' ? FONT_COLORS[(el.getAttribute('color') ?? '').trim().toLowerCase()] : SPAN_CLASS.exec((el.getAttribute('class') ?? '').trim())?.[1];
          if (!c) {
            el.removeAndKeepContent();
            return;
          }
          for (const [name] of [...(el.attributes as unknown as Iterable<[string, string]>)]) el.removeAttribute(name);
          (el as unknown as { tagName: string }).tagName = 'span'; // HTMLRewriter allows renaming; the types mark it readonly
          el.setAttribute('class', 'tc-' + c);
          return;
        }
        if (DROP.has(tag)) {
          el.remove();
          return;
        }
        if (!ALLOW.has(tag)) {
          el.removeAndKeepContent();
          return;
        }
        for (const [name, value] of [...(el.attributes as unknown as Iterable<[string, string]>)]) {
          if (!(tag === 'a' && name === 'href' && SAFE_HREF.test(value.trim()))) el.removeAttribute(name);
        }
        if (tag === 'a') {
          if (!el.getAttribute('href')) {
            el.removeAndKeepContent();
            return;
          }
          el.setAttribute('rel', 'noopener noreferrer nofollow');
          el.setAttribute('target', '_blank');
        }
      },
      comments(c) {
        c.remove();
      },
    })
    .onDocument({
      doctype() {},
      comments(c) {
        c.remove();
      },
    })
    .transform(new Response(input.slice(0, maxLen)));
  const out = (await res.text()).trim();
  return out && out.replace(/<[^>]*>|&nbsp;|\s/g, '') ? out : null;
}
