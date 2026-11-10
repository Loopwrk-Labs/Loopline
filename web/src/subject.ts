/**
 * Automatic thread title from the message text, used when no subject is typed.
 * Short and to the point: greeting line skipped, first sentence only, filler openings removed
 * ("šaljemo", "samo da", "I wanted to"…), at most 5 words / ~40 characters, no trailing small words.
 */
const FILLER = new RegExp(
  '^(?:' +
    [
      'evo', 'šaljem(?:o)?', 'saljem(?:o)?', 'javljam(?: se)?', 'javljamo(?: se)?', 'hteo(?: bih)?(?: da)?', 'htela(?: bih)?(?: da)?',
      'želim(?: da)?', 'želeo(?: bih)?(?: da)?', 'molim(?: vas)?(?: da)?', 'mislim(?: da)?', 'kao što smo (?:pričali|dogovorili)',
      'u vezi(?: sa)?', 'vezano za', 'u prilogu(?: je| su| vam šaljem)?', 'i (?:just )?wanted to', 'we(?: are|\'re)? sending', 'sending', 'please', 'could you',
      'can you', 'following up on', 'regarding', 'just', 'here is', 'here are', 'attached(?: is| are)?',
    ].join('|') +
    ')\\b[\\s,:]*',
  'iu',
);
const SMALL = new Set(
  'i a u na za sa s od do o po da je su se li ili pa te par imamo ima bi bih the an of to and or for with in on at is are be by we our your'.split(' '),
);

export function autoSubject(text: string | null | undefined, maxWords = 5, maxChars = 48): string | null {
  const lines = (text ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].length <= 40 && /[,!:]$/.test(lines[0])) lines.shift();
  const flat = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  let s = (flat.match(/^.*?[.!?:;](?=\s|$)/)?.[0] ?? flat).trim();
  const question = s.endsWith('?');
  s = s.replace(/[.!?:;,\s]+$/, '');
  for (let i = 0; i < 3; i++) s = s.replace(FILLER, '').trim(); // "Samo da javim, šaljemo…" → strip repeatedly
  if (question) maxWords += 2; // a question reads badly when cut, give it a little more room
  let words = s.split(' ').filter(Boolean);
  const cut = words.length > maxWords || s.length > maxChars;
  words = words.slice(0, maxWords);
  while (words.join(' ').length > maxChars && words.length > 2) words.pop();
  while (cut && words.length > 2 && SMALL.has(words[words.length - 1].toLowerCase())) words.pop();
  const out = words.join(' ').replace(/[,;:]+$/, '');
  if (!out) return null;
  return out.charAt(0).toLocaleUpperCase() + out.slice(1) + (question && !cut ? '?' : '');
}
