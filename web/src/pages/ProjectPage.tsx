import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, type Item } from '../api';
import { fmtDate, fmtNum, fmtStamp, useT } from '../i18n';
import { go, useApp } from '../state';
import { Icon, Modal } from '../components/ui';
import { isLeaf } from '../hours';
import { ApprovalDoc, type Approval } from '../components/ApprovalDoc';

type Mail = {
  id: string; source: 'email' | 'manual'; direction: 'in' | 'out'; from_addr: string | null; to_addr: string | null; cc_addr: string | null;
  subject: string | null; body: string; attachments: string; sent_at: number; item_id: string | null; item_key: string | null; created_by_name: string | null; created_by: string | null; edited_at: number | null; reply_to: string | null;
};
type Decision = {
  id: string; title: string; decision: string; decided_by: string | null; decided_on: string | null; source: string | null; item_id: string | null;
  item_key: string | null; created_by_name: string | null; created_at: number;
};

function useRun() {
  const app = useApp();
  return async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
      return false;
    }
  };
}

function ItemPick({ value, onChange, types }: { value: string | null; onChange: (v: string | null) => void; types?: Item['type'][] }) {
  const { items } = useApp();
  const { t } = useT();
  return (
    <select class="select" value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)}>
      <option value="">{t('none')}</option>
      {items
        .filter((i) => !types || types.includes(i.type))
        .map((i) => (
          <option value={i.id}>
            {i.key} · {i.title.slice(0, 60)}
          </option>
        ))}
    </select>
  );
}

// ---------------- overview ----------------
function Overview() {
  const app = useApp();
  const { t, lang } = useT();
  const p = app.project!;
  const run = useRun();
  const [f, setF] = useState({ ...p });
  const [domain, setDomain] = useState('');
  useEffect(() => setF({ ...p }), [p.id, p.name, p.rag, p.budget_hours, p.description]);
  useEffect(() => {
    api.get<{ inboundDomain: string }>('/config').then((c) => setDomain(c.inboundDomain)).catch(() => {});
  }, []);
  const canEdit = app.me.role !== 'member';
  const leaves = app.items.filter((i) => isLeaf(app.items, i));
  const actual = leaves.reduce((a, i) => a + (i.actual_hours ?? 0), 0);
  const scope = leaves.reduce((a, i) => a + (i.scope_hours ?? 0), 0);
  const billable = leaves.filter((i) => i.billable).reduce((a, i) => a + (i.actual_hours ?? 0), 0);
  const budget = p.budget_hours ?? 0;
  const burn = budget ? Math.round((actual / budget) * 100) : null;
  const open = app.items.filter((i) => i.type !== 'epic' && i.status !== 'done').length;
  const done = app.items.filter((i) => i.type !== 'epic' && i.status === 'done').length;

  const save = async () => {
    if (
      await run(() =>
        api.patch(`/projects/${p.id}`, {
          name: f.name, client: f.client, client_contact: f.client_contact, description: f.description, budget_hours: f.budget_hours,
          start_date: f.start_date || null, end_date: f.end_date || null, rag: f.rag, lang: f.lang,
        }),
      )
    ) {
      await app.reloadProjects();
      app.toast(t('saved'));
    }
  };

  return (
    <div class="dash" style={{ marginTop: 0 }}>
      <div class="panel">
        <h5>{t('pm_details')}</h5>
        <div class="form">
          <div class="two">
            <label class="field">
              <span class="label">{t('project_name')}</span>
              <input class="input" disabled={!canEdit} value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{t('client')}</span>
              <input class="input" disabled={!canEdit} value={f.client ?? ''} onInput={(e) => setF({ ...f, client: e.currentTarget.value })} />
            </label>
          </div>
          <label class="field">
            <span class="label">{t('pm_contact')}</span>
            <input class="input" disabled={!canEdit} placeholder="Ime Prezime <ime@klijent.com>" value={f.client_contact ?? ''} onInput={(e) => setF({ ...f, client_contact: e.currentTarget.value })} />
          </label>
          <label class="field">
            <span class="label">{t('pm_scope_contract')}</span>
            <textarea class="textarea" disabled={!canEdit} value={f.description ?? ''} onInput={(e) => setF({ ...f, description: e.currentTarget.value })} />
          </label>
          <div class="two">
            <label class="field">
              <span class="label">{t('start_date')}</span>
              <input class="input" type="date" disabled={!canEdit} value={f.start_date ?? ''} onInput={(e) => setF({ ...f, start_date: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{t('end_date')}</span>
              <input class="input" type="date" disabled={!canEdit} value={f.end_date ?? ''} onInput={(e) => setF({ ...f, end_date: e.currentTarget.value })} />
            </label>
          </div>
          <div class="two">
            <label class="field">
              <span class="label">{t('pm_budget')}</span>
              <input class="input" inputMode="decimal" disabled={!canEdit} value={f.budget_hours ?? ''} onInput={(e) => setF({ ...f, budget_hours: e.currentTarget.value ? Number(e.currentTarget.value.replace(',', '.')) : null })} />
            </label>
            <div class="field">
              <span class="label">{t('pm_rag')}</span>
              <div class="seg">
                {(['green', 'amber', 'red'] as const).map((r) => (
                  <button type="button" disabled={!canEdit} aria-pressed={f.rag === r} onClick={() => setF({ ...f, rag: r })}>
                    {t(`rag_${r}` as never)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div class="field">
            <span class="label">{t('project_lang')}</span>
            <div class="seg">
              {(['sr', 'en'] as const).map((l) => (
                <button type="button" disabled={!canEdit} aria-pressed={f.lang === l} onClick={() => setF({ ...f, lang: l })}>
                  {t(`lang_${l}` as never)}
                </button>
              ))}
            </div>
            <span class="hint">{t('project_lang_hint')}</span>
          </div>
          {canEdit && (
            <div class="row">
              <button class="btn solid" onClick={save}>{t('save')}</button>
            </div>
          )}
        </div>
      </div>
      <div>
        <div class="kpis">
          <div class={'kpi' + (p.rag === 'red' ? ' alert' : p.rag === 'amber' ? ' warn' : '')}>
            <small>{t('pm_rag')}</small>
            <b style={{ fontSize: '1.1rem', paddingTop: '6px' }}>
              <span class={'rag ' + p.rag}>
                <i />
                {t(`rag_${p.rag}` as never)}
              </span>
            </b>
            <p>
              {fmtDate(p.start_date)} → {fmtDate(p.end_date)}
            </p>
          </div>
          <div class={'kpi' + (burn !== null && burn >= 80 ? ' warn' : '')}>
            <small>{t('pm_budget_burn')}</small>
            <b>
              {burn !== null ? burn : '—'}
              <sub>%</sub>
            </b>
            <p>
              {fmtNum(actual, lang)} / {budget ? fmtNum(budget, lang) : '—'}h
            </p>
            {burn !== null && burn >= 80 && <span class="d dn">{t('pm_burn_warn')}</span>}
          </div>
          <div class="kpi">
            <small>{t('kpi_hours')}</small>
            <b>
              {fmtNum(actual, lang)}
              <sub>/ {fmtNum(scope, lang)} h</sub>
            </b>
            <p>
              {fmtNum(billable, lang)}h {t('billable_short')}
            </p>
          </div>
          <div class="kpi">
            <small>{t('children')}</small>
            <b>
              {done}
              <sub>/ {open + done}</sub>
            </b>
            <p>{t('items_done')}</p>
          </div>
        </div>
        <div class="panel" style={{ marginTop: '12px' }}>
          <h5>{t('pm_inbound')}</h5>
          {domain ? (
            <>
              <div class="copy">
                <input class="input" readOnly value={`${p.key.toLowerCase()}@${domain}`} />
                <button
                  class="btn sm"
                  onClick={() => navigator.clipboard?.writeText(`${p.key.toLowerCase()}@${domain}`).then(() => app.toast(t('copied')), () => {})}
                >
                  {t('copy')}
                </button>
              </div>
              <p class="hint">{t('pm_inbound_hint')}</p>
            </>
          ) : (
            <p class="hint">{t('pm_inbound_off')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- correspondence (Threads-style) ----------------
const SENDER_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink', 'grey'] as const;
type SenderColor = (typeof SENDER_COLORS)[number];

/** "Ana Petrović <ana@klijent.com>" → name + email; a bare address keeps the address as the name. */
function parseAddr(raw: string | null): { name: string; email: string } {
  const s = (raw ?? '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  if (/@/.test(s)) return { name: s.split(',')[0].trim(), email: s.split(',')[0].trim().toLowerCase() };
  return { name: s, email: '' };
}
const senderKey = (raw: string | null) => {
  const a = parseAddr(raw);
  return (a.email || a.name || 'unknown').toLowerCase();
};
function initialsFrom(name: string): string {
  const base = name.includes('@') ? name.split('@')[0].replace(/[._-]+/g, ' ') : name;
  const parts = base.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? '')).toUpperCase();
}
/** Stable default colour per sender (grey is never auto-assigned). */
function autoColor(key: string): SenderColor {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SENDER_COLORS[h % (SENDER_COLORS.length - 1)];
}
const threadKeyOf = (m: Mail) => {
  const subj = (m.subject ?? '').replace(/^\s*((re|fw|fwd|aw|odg|sv)\s*(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase();
  return subj || `#${m.id}`;
};

function ColorPicker({ value, onPick, onClose }: { value: SenderColor; onPick: (c: SenderColor) => void; onClose: () => void }) {
  const { t } = useT();
  useEffect(() => {
    const off = (e: MouseEvent) => !(e.target as HTMLElement).closest('.swatches') && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => addEventListener('mousedown', off), 0);
    addEventListener('keydown', esc);
    return () => {
      removeEventListener('mousedown', off);
      removeEventListener('keydown', esc);
    };
  }, []);
  return (
    <div class="swatches" role="dialog" aria-label={t('pm_sender_color')}>
      {SENDER_COLORS.map((c) => (
        <button type="button" class={'sw sc-' + c + (c === value ? ' on' : '')} aria-label={c} aria-pressed={c === value} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

function Correspondence() {
  const app = useApp();
  const { t, lang } = useT();
  const run = useRun();
  const [rows, setRows] = useState<Mail[]>([]);
  const [colors, setColors] = useState<Record<string, SenderColor>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [add, setAdd] = useState<Record<string, string> | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Mail | null>(null);
  const [q, setQ] = useState('');
  const canChange = (m: Mail) => app.me.role === 'admin' || (!!m.created_by && m.created_by === app.me.id);
  const pad = (n: number) => String(n).padStart(2, '0');
  const replyTo = (m: Mail) =>
    setAdd(
      blank({
        reply_to: m.id,
        direction: m.direction === 'in' ? 'out' : 'in',
        subject: m.subject ? (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`) : '',
        from_addr: m.direction === 'in' ? m.to_addr?.split(',')[0].trim() ?? '' : '',
        to_addr: m.direction === 'in' ? m.from_addr ?? '' : m.to_addr ?? '',
        ...(m.item_id ? { item_id: m.item_id } : {}),
      }),
    );
  const jumpTo = (id: string) => {
    const el = document.getElementById(`mail-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  };
  const editOf = (m: Mail) => {
    const d = new Date(m.sent_at);
    setAdd({
      id: m.id,
      direction: m.direction,
      sent_on: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      sent_time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      tz_offset: String(d.getTimezoneOffset()),
      from_addr: m.from_addr ?? '',
      to_addr: m.to_addr ?? '',
      subject: m.subject ?? '',
      body: m.body ?? '',
    });
  };
  const pid = app.project!.id;
  const load = () => api.get<Mail[]>(`/projects/${pid}/correspondence`).then(setRows).catch(() => {});
  const loadColors = () =>
    api
      .get<{ sender_key: string; color: SenderColor }[]>(`/projects/${pid}/senders`)
      .then((r) => setColors(Object.fromEntries(r.map((x) => [x.sender_key, x.color]))))
      .catch(() => {});
  useEffect(() => {
    load();
    loadColors();
  }, [pid]);

  const colorOf = (key: string): SenderColor => colors[key] ?? autoColor(key);
  const setColor = async (key: string, color: SenderColor) => {
    setColors({ ...colors, [key]: color });
    setPicking(null);
    await run(() => api.put(`/projects/${pid}/senders`, { sender_key: key, color }));
  };

  // Senders (legend) and threads grouped by subject, oldest message first inside a thread.
  const senders = new Map<string, { name: string; email: string; n: number }>();
  for (const m of rows) {
    const k = senderKey(m.from_addr);
    const a = parseAddr(m.from_addr);
    const cur = senders.get(k);
    senders.set(k, { name: cur?.name || a.name || a.email || t('pm_unknown_sender'), email: a.email, n: (cur?.n ?? 0) + 1 });
  }
  // Threads: a message belongs to the thread of its root ancestor (via reply_to); roots group by subject.
  const byId = new Map(rows.map((m) => [m.id, m]));
  const rootOf = (m: Mail) => {
    let cur = m;
    for (let n = 0; n < 50 && cur.reply_to && byId.has(cur.reply_to); n++) cur = byId.get(cur.reply_to)!;
    return cur;
  };
  const kidsOf = new Map<string, Mail[]>();
  for (const m of rows) if (m.reply_to && byId.has(m.reply_to)) kidsOf.set(m.reply_to, [...(kidsOf.get(m.reply_to) ?? []), m]);
  for (const list of kidsOf.values()) list.sort((a, b) => a.sent_at - b.sent_at);
  const countDesc = (id: string): number => (kidsOf.get(id) ?? []).reduce((n, k) => n + 1 + countDesc(k.id), 0);
  const descOf = (id: string): Mail[] => (kidsOf.get(id) ?? []).flatMap((k) => [k, ...descOf(k.id)]);
  const groups = new Map<string, Mail[]>();
  for (const m of rows) {
    const k = threadKeyOf(rootOf(m));
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const ql = q.trim().toLowerCase();
  const threads = [...groups.values()]
    .map((ms) => [...ms].sort((a, b) => a.sent_at - b.sent_at))
    .filter((ms) => !ql || ms.some((m) => `${m.subject} ${m.from_addr} ${m.to_addr} ${m.body}`.toLowerCase().includes(ql)))
    .sort((a, b) => a[a.length - 1].sent_at - b[b.length - 1].sent_at);
  const maxDepth = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches ? 2 : 4;
  const toggleKids = (id: string) => {
    const n = new Set(collapsed);
    n.has(id) ? n.delete(id) : n.add(id);
    setCollapsed(n);
  };

  const now = new Date();
  const blank = (extra: Record<string, string> = {}) => ({
    direction: 'in',
    sent_on: now.toISOString().slice(0, 10),
    sent_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    tz_offset: String(now.getTimezoneOffset()),
    ...extra,
  });
  const toggle = (id: string) => {
    const n = new Set(expanded);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpanded(n);
  };

  /** One message card. `kids` = number of replies below it; the quote shows only when the parent is not drawn right above. */
  const renderItem = (m: Mail, showQuote: boolean, kids: number) => {
      const k = senderKey(m.from_addr);
      const a = parseAddr(m.from_addr);
      const name = a.name || a.email || t('pm_unknown_sender');
      const color = colorOf(k);
      const atts = (() => {
        try {
          return JSON.parse(m.attachments) as { name: string }[];
        } catch {
          return [];
        }
      })();
      const long = m.body.length > 520 || m.body.split('\n').length > 9;
      const open = expanded.has(m.id);
      return (
        <div id={`mail-${m.id}`} class={'tl-item sc-' + color + (kids ? ' has-kids' : '')}>
          <div class="tl-rail">
            <button type="button" class="tl-av" title={t('pm_sender_color')} aria-label={`${name} · ${t('pm_sender_color')}`} onClick={() => setPicking(picking === m.id ? null : m.id)}>
              {initialsFrom(name)}
            </button>
            {picking === m.id && <ColorPicker value={color} onPick={(c) => setColor(k, c)} onClose={() => setPicking(null)} />}
          </div>
          <article class="tl-box">
            <div class="tl-h">
              <b>{name}</b>
              {a.email && a.email !== name.toLowerCase() && <span class="meta">{a.email}</span>}
              <span class={'tag' + (m.direction === 'out' ? ' on' : '')}>{m.direction === 'out' ? t('pm_out') : t('pm_in')}</span>
              <time>
                {fmtStamp(m.sent_at, lang)}
                {m.edited_at ? <span class="edited" title={fmtStamp(m.edited_at, lang)}> · {t('pm_edited')}</span> : null}
              </time>
              {canChange(m) && (
                <span class="tl-menu">
                  <button type="button" class="tl-dots" aria-label={t('pm_msg_actions')} aria-expanded={menu === m.id} onClick={() => setMenu(menu === m.id ? null : m.id)}>
                    <Icon name="dots" />
                  </button>
                  {menu === m.id && (
                    <div class="tl-pop" onMouseLeave={() => setMenu(null)}>
                      {m.source === 'manual' && (
                        <button type="button" onClick={() => { setMenu(null); editOf(m); }}>
                          {t('edit')}
                        </button>
                      )}
                      <button type="button" class="danger" onClick={() => { setMenu(null); setConfirmDel(m); }}>
                        {t('pm_delete_msg')}
                      </button>
                    </div>
                  )}
                </span>
              )}
            </div>
            {(m.to_addr || m.cc_addr) && (
              <div class="tl-to">
                {t('pm_to')}: {m.to_addr || '—'}
                {m.cc_addr ? ` · CC: ${m.cc_addr}` : ''}
              </div>
            )}
            {m.reply_to &&
              showQuote &&
              (() => {
                const o = rows.find((x) => x.id === m.reply_to);
                if (!o) return null;
                const on = parseAddr(o.from_addr);
                return (
                  <button type="button" class={'tl-reply sc-' + colorOf(senderKey(o.from_addr))} onClick={() => jumpTo(o.id)}>
                    <span class="arr">↪</span> {t('pm_reply_to')} <b>{on.name || on.email || t('pm_unknown_sender')}</b> · {fmtStamp(o.sent_at, lang)}
                    <span class="snip">{(o.body || o.subject || '').replace(/\s+/g, ' ').slice(0, 90)}</span>
                  </button>
                );
              })()}
            <div class={'tl-body' + (long && !open ? ' clamp' : '')}>{m.body || <span class="faint">—</span>}</div>
            {long && (
              <button type="button" class="linkbtn" onClick={() => toggle(m.id)}>
                {open ? t('pm_show_less') : t('pm_show_more')}
              </button>
            )}
            <div class="tl-f">
              {atts.length > 0 && (
                <span>
                  📎 {atts.map((x) => x.name).join(', ')}
                </span>
              )}
              <span>{m.source === 'email' ? t('pm_src_email') : `${t('pm_src_manual')}${m.created_by_name ? ' · ' + m.created_by_name : ''}`}</span>
              {m.item_key && linking !== m.id && (
                <a class="item-chip" href={`#/p/${app.project!.key}/i/${m.item_key}`}>
                  {m.item_key}
                </a>
              )}
              {kids > 0 && (
                <button type="button" class="linkbtn kids-btn" onClick={() => toggleKids(m.id)}>
                  {collapsed.has(m.id) ? `${t('pm_show_replies')} (${kids})` : `${t('pm_hide_replies')} (${kids})`}
                </button>
              )}
              <span class="tl-actions">
                <button type="button" class="linkbtn reply-btn" onClick={() => replyTo(m)}>
                  ↩ {t('pm_reply')}
                </button>
                {linking === m.id ? (
                  <span style={{ width: '240px' }}>
                    <ItemPick
                      value={m.item_id}
                      onChange={async (v) => {
                        if (await run(() => api.patch(`/correspondence/${m.id}`, { item_id: v }))) {
                          setLinking(null);
                          load();
                        }
                      }}
                    />
                  </span>
                ) : (
                  <button type="button" class="linkbtn" onClick={() => setLinking(m.id)}>
                    {m.item_key ? t('pm_change_link') : t('pm_link_item')}
                  </button>
                )}
              </span>
            </div>
          </article>
        </div>
    );
  };
  /** Nested reply tree. At the deepest allowed level, further replies are listed flat (with their quote). */
  const renderList = (list: Mail[], depth: number): preact.JSX.Element => (
    <ol class={depth === 0 ? 'tl tl-root' : 'tl tl-kids'}>
      {list.map((m) => {
        const atCap = depth >= maxDepth - 1;
        const kids = kidsOf.get(m.id) ?? [];
        const total = countDesc(m.id);
        const hidden = collapsed.has(m.id);
        if (atCap) {
          return [m, ...(hidden ? [] : descOf(m.id).sort((a, b) => a.sent_at - b.sent_at))].map((x, i) => (
            <li class={'tl-node sc-' + colorOf(senderKey(x.from_addr))}>{renderItem(x, i === 0 ? depth === 0 : true, i === 0 ? total : 0)}</li>
          ));
        }
        return (
          <li class={'tl-node sc-' + colorOf(senderKey(m.from_addr)) + (kids.length && !hidden ? ' open' : '')}>
            {renderItem(m, depth === 0, total)}
            {kids.length > 0 && !hidden && renderList(kids, depth + 1)}
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      <div class="tb">
        <span class="meta">{t('pm_mail_lede')}</span>
        <div class="row sp">
          <input class="input" style={{ width: '220px' }} placeholder={t('filter_ph')} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="btn solid" onClick={() => setAdd(blank())}>
            <Icon name="plus" />
            {t('pm_add_mail')}
          </button>
        </div>
      </div>

      {senders.size > 0 && (
        <div class="senders" aria-label={t('pm_senders')}>
          <span class="senders-l">{t('pm_senders')}</span>
          {[...senders.entries()]
            .sort((a, b) => b[1].n - a[1].n)
            .map(([k, s]) => (
              <span class="sender-chip-wrap">
                <button type="button" class={'sender-chip sc-' + colorOf(k)} title={`${s.email || s.name} · ${t('pm_sender_color')}`} onClick={() => setPicking(picking === `legend:${k}` ? null : `legend:${k}`)}>
                  <i />
                  {s.name}
                  <small>{s.n}</small>
                </button>
                {picking === `legend:${k}` && <ColorPicker value={colorOf(k)} onPick={(c) => setColor(k, c)} onClose={() => setPicking(null)} />}
              </span>
            ))}
        </div>
      )}

      {!threads.length && <div class="empty">{t('pm_mail_empty')}</div>}

      <div class="threads">
        {threads.map((ms) => {
          const roots = ms.filter((m) => !m.reply_to || !byId.has(m.reply_to));
          const first = roots[0] ?? ms[0];
          return (
            <section class="thread">
              <header class="thread-h">
                <b>{first.subject || '—'}</b>
                <span class="meta">
                  {ms.length} {ms.length % 10 === 1 && ms.length % 100 !== 11 ? t('pm_message') : [2, 3, 4].includes(ms.length % 10) && ![12, 13, 14].includes(ms.length % 100) ? t('pm_messages_few') : t('pm_messages')} · {fmtStamp(ms[ms.length - 1].sent_at, lang)}
                </span>
              </header>
              {renderList(roots, 0)}
            </section>
          );
        })}
      </div>

      {add && (
        <Modal
          title={add.id ? t('pm_edit_mail') : add.reply_to ? t('pm_reply') : t('pm_add_mail')}
          wide
          onClose={() => setAdd(null)}
          footer={
            <>
              <button class="btn" onClick={() => setAdd(null)}>{t('cancel')}</button>
              <button
                class="btn solid"
                onClick={async () => {
                  const { id, ...data } = add;
                  if (await run(() => (id ? api.patch(`/correspondence/${id}`, data) : api.post(`/projects/${pid}/correspondence`, data)))) {
                    setAdd(null);
                    load();
                  }
                }}
              >
                {t('save')}
              </button>
            </>
          }
        >
          <div class="form">
            {add.reply_to &&
              (() => {
                const o = rows.find((x) => x.id === add.reply_to);
                if (!o) return null;
                const on = parseAddr(o.from_addr);
                return (
                  <div class={'tl-reply static sc-' + colorOf(senderKey(o.from_addr))}>
                    <span class="arr">↪</span> {t('pm_reply_to')} <b>{on.name || on.email}</b> · {fmtStamp(o.sent_at, lang)}
                    <span class="snip">{(o.body || o.subject || '').replace(/\s+/g, ' ').slice(0, 140)}</span>
                  </div>
                );
              })()}
            <div class="three">
              <div class="field">
                <span class="label">{t('pm_direction')}</span>
                <div class="seg">
                  {(['in', 'out'] as const).map((d) => (
                    <button type="button" aria-pressed={add.direction === d} onClick={() => setAdd({ ...add, direction: d })}>
                      {d === 'in' ? t('pm_in') : t('pm_out')}
                    </button>
                  ))}
                </div>
              </div>
              <label class="field">
                <span class="label">{t('pm_date')}</span>
                <input class="input" type="date" value={add.sent_on} onInput={(e) => setAdd({ ...add, sent_on: e.currentTarget.value })} />
              </label>
              <label class="field">
                <span class="label">{t('pm_time')}</span>
                <input class="input" type="time" value={add.sent_time} onInput={(e) => setAdd({ ...add, sent_time: e.currentTarget.value })} />
              </label>
            </div>
            <div class="two">
              <label class="field">
                <span class="label">{t('pm_from')}</span>
                <input class="input" placeholder="Ime Prezime <ime@firma.com>" value={add.from_addr ?? ''} onInput={(e) => setAdd({ ...add, from_addr: e.currentTarget.value })} />
              </label>
              <label class="field">
                <span class="label">{t('pm_to')}</span>
                <input class="input" value={add.to_addr ?? ''} onInput={(e) => setAdd({ ...add, to_addr: e.currentTarget.value })} />
              </label>
            </div>
            <label class="field">
              <span class="label">{t('pm_subject')}</span>
              <input class="input" value={add.subject ?? ''} onInput={(e) => setAdd({ ...add, subject: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{t('pm_body')}</span>
              <textarea class="textarea" style={{ minHeight: '200px' }} value={add.body ?? ''} onInput={(e) => setAdd({ ...add, body: e.currentTarget.value })} />
            </label>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <Modal
          title={t('pm_delete_msg')}
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <button class="btn" onClick={() => setConfirmDel(null)}>{t('cancel')}</button>
              <button
                class="btn solid danger"
                onClick={async () => {
                  if (await run(() => api.del(`/correspondence/${confirmDel.id}`))) {
                    setConfirmDel(null);
                    load();
                  }
                }}
              >
                {t('pm_delete_msg')}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{t('pm_delete_msg_q')}</p>
          <p class="meta" style={{ marginTop: '8px' }}>
            {confirmDel.subject || '—'} · {parseAddr(confirmDel.from_addr).name || '—'} · {fmtStamp(confirmDel.sent_at, lang)}
          </p>
        </Modal>
      )}
    </>
  );
}

// ---------------- approvals ----------------
function Approvals() {
  const app = useApp();
  const { t, lang } = useT();
  const run = useRun();
  const canManage = app.me.role !== 'member';
  const [rows, setRows] = useState<Approval[]>([]);
  const [edit, setEdit] = useState<Partial<Approval> | null>(null);
  const [link, setLink] = useState<{ key: string; url: string } | null>(null);
  const [view, setView] = useState<Approval | null>(null);
  const load = () => api.get<Approval[]>(`/projects/${app.project!.id}/approvals`).then(setRows).catch(() => {});
  useEffect(() => {
    load();
  }, [app.project?.id]);

  const save = async () => {
    const e = edit!;
    const data = { kind: e.kind, title: e.title, body: e.body, item_id: e.item_id ?? null, impact_hours: e.impact_hours ?? null, impact_cost: e.impact_cost ?? null, impact_days: e.impact_days ?? null, currency: e.currency ?? null };
    if (await run(() => (e.id ? api.patch(`/approvals/${e.id}`, data) : api.post(`/projects/${app.project!.id}/approvals`, data)))) {
      setEdit(null);
      load();
    }
  };
  const send = async (a: Approval) => {
    try {
      const r = await api.post<{ token: string }>(`/approvals/${a.id}/send`);
      setLink({ key: a.key, url: `${location.origin}/#/a/${r.token}` });
      load();
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
    }
  };
  const statusTag = (s: Approval['status']) => <span class={'tag' + (s === 'accepted' ? ' ok' : s === 'rejected' ? ' bad' : s === 'sent' ? ' warn' : '')}>{t(`ap_${s}` as never)}</span>;
  const numIn = (k: 'impact_hours' | 'impact_cost' | 'impact_days') => (
    <input class="input" inputMode="decimal" value={edit?.[k] ?? ''} onInput={(e) => setEdit({ ...edit!, [k]: e.currentTarget.value ? Number(e.currentTarget.value.replace(',', '.')) : null })} />
  );

  return (
    <>
      <div class="tb">
        <span class="meta">{t('pm_ap_lede')}</span>
        {canManage && (
          <div class="row sp">
            <button class="btn" onClick={() => setEdit({ kind: 'change_request', title: '', body: '', currency: 'EUR' })}>
              <Icon name="plus" />
              {t('ap_new_cr')}
            </button>
            <button class="btn solid" onClick={() => setEdit({ kind: 'acceptance', title: '', body: '' })}>
              <Icon name="plus" />
              {t('ap_new_acc')}
            </button>
          </div>
        )}
      </div>
      {!rows.length && <div class="empty">{t('pm_ap_empty')}</div>}
      {rows.length > 0 && (
        <div class="list">
          {rows.map((a) => (
            <div class="list-row">
              <span class="key">{a.key}</span>
              <span class="tag">{a.kind === 'acceptance' ? t('ap_acceptance') : t('ap_cr')}</span>
              <button class="main-t linkbtn" onClick={() => setView(a)}>
                {a.title}
              </button>
              {a.kind === 'change_request' && (a.impact_hours || a.impact_cost) && (
                <span class="key">
                  {a.impact_hours ? `+${fmtNum(a.impact_hours, lang)}h` : ''} {a.impact_cost ? `· ${fmtNum(a.impact_cost, lang)} ${a.currency ?? ''}` : ''}
                </span>
              )}
              <span class="sp">
                {statusTag(a.status)}
                {a.decided_at && <span class="key">{fmtStamp(a.decided_at, lang)} · {a.client_name}</span>}
                {canManage && a.status === 'draft' && <button class="btn sm" onClick={() => setEdit(a)}>{t('edit')}</button>}
                {canManage && (a.status === 'draft' || a.status === 'sent') && (
                  <button class="btn sm solid" onClick={() => send(a)}>
                    {a.status === 'sent' ? t('ap_new_link') : t('ap_send')}
                  </button>
                )}
                {canManage && (a.status === 'draft' || a.status === 'sent') && (
                  <button class="btn sm danger" onClick={async () => (await run(() => api.post(`/approvals/${a.id}/withdraw`))) && load()}>
                    {t('ap_withdraw')}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Modal
          wide
          title={edit.id ? edit.key ?? '' : edit.kind === 'acceptance' ? t('ap_new_acc') : t('ap_new_cr')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button class="btn" onClick={() => setEdit(null)}>{t('cancel')}</button>
              <button class="btn solid" disabled={!edit.title?.trim()} onClick={save}>{t('save')}</button>
            </>
          }
        >
          <div class="form">
            <label class="field">
              <span class="label">{t('f_title')}</span>
              <input class="input" value={edit.title ?? ''} onInput={(e) => setEdit({ ...edit, title: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{edit.kind === 'acceptance' ? t('ap_body_acc') : t('ap_body_cr')}</span>
              <textarea class="textarea" style={{ minHeight: '200px' }} value={edit.body ?? ''} onInput={(e) => setEdit({ ...edit, body: e.currentTarget.value })} />
              <span class="hint">{edit.kind === 'acceptance' ? t('ap_body_acc_hint') : t('ap_body_cr_hint')}</span>
            </label>
            <label class="field">
              <span class="label">{t('ap_linked')}</span>
              <ItemPick value={edit.item_id ?? null} onChange={(v) => setEdit({ ...edit, item_id: v })} types={['epic', 'story', 'bug']} />
            </label>
            {edit.kind === 'change_request' && (
              <div class="two">
                <label class="field">
                  <span class="label">{t('ap_impact_hours')}</span>
                  {numIn('impact_hours')}
                </label>
                <label class="field">
                  <span class="label">{t('ap_impact_days')}</span>
                  {numIn('impact_days')}
                </label>
                <label class="field">
                  <span class="label">{t('ap_impact_cost')}</span>
                  {numIn('impact_cost')}
                </label>
                <label class="field">
                  <span class="label">{t('ap_currency')}</span>
                  <input class="input" maxLength={8} value={edit.currency ?? ''} onInput={(e) => setEdit({ ...edit, currency: e.currentTarget.value.toUpperCase() })} />
                </label>
              </div>
            )}
          </div>
        </Modal>
      )}

      {link && (
        <Modal title={`${link.key} · ${t('ap_link_title')}`} onClose={() => setLink(null)} footer={<button class="btn solid" onClick={() => setLink(null)}>{t('close')}</button>}>
          <div class="form">
            <p class="muted" style={{ margin: 0 }}>{t('ap_link_lede')}</p>
            <div class="copy">
              <input class="input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
              <button class="btn sm solid" onClick={() => navigator.clipboard?.writeText(link.url).then(() => app.toast(t('copied')), () => {})}>
                {t('copy')}
              </button>
            </div>
            <p class="hint">{t('ap_link_once')}</p>
          </div>
        </Modal>
      )}

      {view && (
        <Modal wide title={view.key} onClose={() => setView(null)} footer={<button class="btn" onClick={() => window.print()}>{t('ap_print')}</button>}>
          <ApprovalDoc a={{ ...view, project_name: app.project!.name, project_client: app.project!.client, lang: app.project!.lang }} />
        </Modal>
      )}
    </>
  );
}

// ---------------- decisions ----------------
function Decisions() {
  const app = useApp();
  const { t, lang } = useT();
  const run = useRun();
  const [rows, setRows] = useState<Decision[]>([]);
  const [edit, setEdit] = useState<Partial<Decision> | null>(null);
  const load = () => api.get<Decision[]>(`/projects/${app.project!.id}/decisions`).then(setRows).catch(() => {});
  useEffect(() => {
    load();
  }, [app.project?.id]);
  const save = async () => {
    const e = edit!;
    const data = { title: e.title, decision: e.decision, decided_by: e.decided_by ?? null, decided_on: e.decided_on || null, source: e.source ?? null, item_id: e.item_id ?? null };
    if (await run(() => (e.id ? api.patch(`/decisions/${e.id}`, data) : api.post(`/projects/${app.project!.id}/decisions`, data)))) {
      setEdit(null);
      load();
    }
  };
  return (
    <>
      <div class="tb">
        <span class="meta">{t('pm_dec_lede')}</span>
        <div class="row sp">
          <button class="btn solid" onClick={() => setEdit({ decided_on: new Date().toISOString().slice(0, 10) })}>
            <Icon name="plus" />
            {t('dec_new')}
          </button>
        </div>
      </div>
      {!rows.length && <div class="empty">{t('pm_dec_empty')}</div>}
      {rows.map((d) => (
        <div class="mail">
          <div class="mail-h" onClick={() => setEdit(d)}>
            <span class="key">{fmtDate(d.decided_on)}</span>
            <b>{d.title}</b>
            {d.item_key && <span class="key">{d.item_key}</span>}
            <time>{d.decided_by ?? ''}</time>
          </div>
          <div class="mail-b">{d.decision}</div>
          <div class="mail-f">
            {d.source && <span>{t('dec_source')}: {d.source}</span>}
            <span>
              {t('dec_logged')} {d.created_by_name} · {fmtStamp(d.created_at, lang)}
            </span>
          </div>
        </div>
      ))}
      {edit && (
        <Modal
          wide
          title={edit.id ? edit.title ?? '' : t('dec_new')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button class="btn" onClick={() => setEdit(null)}>{t('cancel')}</button>
              <button class="btn solid" disabled={!edit.title?.trim() || !edit.decision?.trim()} onClick={save}>{t('save')}</button>
            </>
          }
        >
          <div class="form">
            <label class="field">
              <span class="label">{t('dec_topic')}</span>
              <input class="input" value={edit.title ?? ''} onInput={(e) => setEdit({ ...edit, title: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{t('dec_what')}</span>
              <textarea class="textarea" value={edit.decision ?? ''} onInput={(e) => setEdit({ ...edit, decision: e.currentTarget.value })} />
            </label>
            <div class="two">
              <label class="field">
                <span class="label">{t('dec_by')}</span>
                <input class="input" value={edit.decided_by ?? ''} onInput={(e) => setEdit({ ...edit, decided_by: e.currentTarget.value })} />
              </label>
              <label class="field">
                <span class="label">{t('pm_date')}</span>
                <input class="input" type="date" value={edit.decided_on ?? ''} onInput={(e) => setEdit({ ...edit, decided_on: e.currentTarget.value })} />
              </label>
            </div>
            <label class="field">
              <span class="label">{t('dec_source')}</span>
              <input class="input" placeholder={t('dec_source_ph')} value={edit.source ?? ''} onInput={(e) => setEdit({ ...edit, source: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{t('ap_linked')}</span>
              <ItemPick value={edit.item_id ?? null} onChange={(v) => setEdit({ ...edit, item_id: v })} />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

export function ProjectPage({ tab }: { tab: string }) {
  const { project } = useApp();
  const { t } = useT();
  const tabs: [string, string][] = [
    ['overview', t('pm_overview')],
    ['mail', t('pm_mail')],
    ['approvals', t('pm_approvals')],
    ['decisions', t('pm_decisions')],
  ];
  const cur = tabs.some(([k]) => k === tab) ? tab : 'overview';
  return (
    <>
      <div class="tb" style={{ marginBottom: '6px' }}>
        <h2>{project!.name}</h2>
        <span class="meta">
          {project!.key}
          {project!.client ? ` · ${project!.client}` : ''}
        </span>
        <span class={'rag ' + project!.rag}>
          <i />
        </span>
      </div>
      <nav class="tabs">
        {tabs.map(([k, label]) => (
          <a href={`#/p/${project!.key}/project/${k}`} class={cur === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(`p/${project!.key}/project/${k}`); }}>
            {label}
          </a>
        ))}
      </nav>
      {cur === 'overview' && <Overview />}
      {cur === 'mail' && <Correspondence />}
      {cur === 'approvals' && <Approvals />}
      {cur === 'decisions' && <Decisions />}
    </>
  );
}
