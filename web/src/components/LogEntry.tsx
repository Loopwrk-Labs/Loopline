import type { LogEntry } from '../api';
import { fmtDate, fmtNum, fmtStamp, useT, type Lang, type T } from '../i18n';
import { Avatar } from './ui';

function val(field: string, v: string | null, t: T, lang: Lang) {
  if (v === null || v === '') return t('empty_value');
  if (field === 'status') return t(`st_${v}` as never);
  if (field === 'type' || field === 'created') return t(`ty_${v}` as never);
  if (field === 'due_date') return fmtDate(v);
  if (field === 'billable') return v === '1' ? t('yes') : t('no');
  if (['points', 'scope_hours', 'actual_hours'].includes(field)) {
    const n = Number(v);
    return Number.isFinite(n) ? fmtNum(n, lang) + (field === 'points' ? '' : 'h') : v;
  }
  return v;
}

function delta(e: LogEntry, lang: Lang) {
  if (!['scope_hours', 'actual_hours'].includes(e.field ?? '')) return null;
  const d = Number(e.new_value ?? 0) - Number(e.old_value ?? 0);
  if (!Number.isFinite(d) || d === 0) return null;
  return ` (${d > 0 ? '+' : ''}${fmtNum(d, lang)}h)`;
}

/** Highlight @mentions in a note. */
function noteBody(text: string) {
  const parts = text.split(/(@[\p{L}\p{N}_.-]+)/u);
  return parts.map((p) => (p.startsWith('@') ? <span class="at">{p}</span> : p));
}

export function Entry({ e, showItem, onPin }: { e: LogEntry; showItem?: (key: string) => string; onPin?: (e: LogEntry) => void }) {
  const { t, lang } = useT();
  const itemLink = showItem && e.item_key ? (
    <a href={showItem(e.item_key)} class="key" style={{ textDecoration: 'none' }}>
      {e.item_key}
    </a>
  ) : null;

  if (e.kind === 'note') {
    return (
      <div class={'entry' + (e.pinned ? ' pin' : '')}>
        <Avatar user={e.user_name ? { name: e.user_name, initials: e.user_initials ?? '?' } : null} />
        <div>
          <div class="h">
            <b>{e.user_name ?? '—'}</b>
            {itemLink}
            {e.pinned ? <span class="pinlbl">{t('pinned')}</span> : null}
            {onPin && (
              <button class="pinbtn" onClick={() => onPin(e)}>
                {e.pinned ? t('unpin') : t('pin')}
              </button>
            )}
            <time>{fmtStamp(e.created_at, lang)}</time>
          </div>
          <p>{noteBody(e.body ?? '')}</p>
        </div>
      </div>
    );
  }

  const f = e.field ?? '';
  let text;
  if (f === 'created') text = <>{t('created_item')} · {val('type', e.new_value, t, lang)}</>;
  else if (f === 'archived') text = <>{t('archived_item')}</>;
  else if (f === 'deleted') text = <>{t('deleted_items')} {e.old_value} ({e.new_value})</>;
  else if (f === 'sprint_started') text = <>{t('sprint_started')} {e.new_value}</>;
  else if (f === 'sprint_closed') text = <>{t('sprint_closed')} {e.new_value}</>;
  else
    text = (
      <>
        {t(`ch_${f}` as never)}: {val(f, e.old_value, t, lang)} → {val(f, e.new_value, t, lang)}
        {delta(e, lang)}
      </>
    );
  return (
    <div class="entry sys">
      <span class="ic">
        <i />
      </span>
      <p>
        <span>{fmtStamp(e.created_at, lang, false)}</span>
        <b>{e.user_name ?? '—'}</b>
        {itemLink}
        <span>{text}</span>
      </p>
    </div>
  );
}
