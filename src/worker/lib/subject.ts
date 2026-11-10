/**
 * Automatic thread title from the message text, used when no subject is typed.
 * Skips a short greeting line ("Zdravo,", "Ćao Marko,", "Hi Ana!"), takes the first sentence and
 * shortens it to ~60 characters on a word boundary.
 */
export function autoSubject(text: string | null | undefined, max = 60): string | null {
  const lines = (text ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].length <= 40 && /[,!:]$/.test(lines[0])) lines.shift();
  const flat = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const first = (flat.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? flat).replace(/[.:,;\s]+$/, ''); // a question keeps its "?"
  const sentence = first.charAt(0).toLocaleUpperCase() + first.slice(1);
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : cut.slice(0, max)).replace(/[,;:\s]+$/, '') + '…';
}
