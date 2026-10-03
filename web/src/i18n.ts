import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { en, type Dict } from './i18n/en';
import { sr } from './i18n/sr';

export type Lang = 'sr' | 'en';
export const dicts: Record<Lang, Dict> = { sr, en };

export type T = (k: keyof Dict) => string;
export const LangCtx = createContext<{ lang: Lang; t: T }>({ lang: 'en', t: (k) => en[k] });
export const useT = () => useContext(LangCtx);

export const makeT = (lang: Lang): T => (k) => dicts[lang][k] ?? en[k] ?? String(k);

const locale = (lang: Lang) => (lang === 'sr' ? 'sr-Latn-RS' : 'en-GB');

/** Dates are shown as dd.mm.yyyy in both languages (team convention). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtStamp(ms: number, lang: Lang, withYear = true): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(locale(lang), { day: '2-digit', month: '2-digit', ...(withYear ? { year: 'numeric' } : {}) });
  const time = d.toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date.replace(/\s/g, '').replace(/\.$/, '')} ${time}`;
}

/** Hours and points: Serbian uses a decimal comma, English a decimal point. */
export function fmtNum(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString(locale(lang), { maximumFractionDigits: 2 });
}

export function parseNum(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
