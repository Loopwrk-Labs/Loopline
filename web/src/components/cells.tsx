import { useEffect, useState } from 'preact/hooks';
import { fmtDate, fmtNum, parseNum, useT } from '../i18n';

/** Text input that commits on blur or Enter, and reverts on Escape. */
export function TextCell({ value, onCommit, cls = 'cell', id, placeholder }: { value: string; onCommit: (v: string) => void; cls?: string; id?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const s = v.trim();
    if (!s) return setV(value);
    if (s !== value) onCommit(s);
  };
  return (
    <input
      id={id}
      class={cls}
      value={v}
      placeholder={placeholder}
      onInput={(e) => setV(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/** Number input (accepts 13,5 or 13.5) committing on blur/Enter. Empty means "no value". */
export function NumCell({ value, onCommit, cls = 'cell num', id, disabled, title }: { value: number | null; onCommit: (v: number | null) => void; cls?: string; id?: string; disabled?: boolean; title?: string }) {
  const { lang } = useT();
  const show = (n: number | null) => (n === null ? '' : fmtNum(n, lang));
  const [v, setV] = useState(show(value));
  useEffect(() => setV(show(value)), [value, lang]);
  const commit = () => {
    const n = parseNum(v);
    if (Number.isNaN(n)) return setV(show(value));
    if (n !== value) onCommit(n);
    else setV(show(value));
  };
  return (
    <input
      id={id}
      class={cls}
      inputMode="decimal"
      value={v}
      disabled={disabled}
      title={title}
      onInput={(e) => setV(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(show(value));
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/** Shows dd.mm.yyyy as text; switches to the native date picker while editing. */
export function DateCell({ value, onCommit, cls = 'cell date', id, late }: { value: string | null; onCommit: (v: string | null) => void; cls?: string; id?: string; late?: boolean }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" id={id} class={'cell datebtn' + (late ? ' late' : '')} onClick={() => setEditing(true)}>
        {fmtDate(value)}
      </button>
    );
  }
  return (
    <input
      id={id}
      type="date"
      class={cls + (late ? ' late' : '')}
      value={value ?? ''}
      autoFocus
      onChange={(e) => onCommit(e.currentTarget.value || null)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && setEditing(false)}
    />
  );
}
