import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type Item } from '../api';
import { fmtDate, fmtNum, fmtStamp, useT } from '../i18n';
import { go, useApp } from '../state';
import { Icon, Modal } from '../components/ui';
import { autoSubject } from '../subject';
import { RichEditor, cleanHtml, highlightHtml, textToHtml } from '../components/RichEditor';
import { isLeaf } from '../hours';
import { ApprovalDoc, type Approval } from '../components/ApprovalDoc';

type Mail = {
  id: string; source: 'email' | 'manual'; direction: 'in' | 'out'; from_addr: string | null; to_addr: string | null; cc_addr: string | null;
  subject: string | null; body: string; attachments: string; sent_at: number; item_id: string | null; item_key: string | null; created_by_name: string | null; created_by: string | null; edited_at: number | null; reply_to: string | null; body_html: string | null;
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
// Bright 12-colour palette for client companies. Loopwrk (internal) always uses the brand style ('lw'), never a palette colour.
const SENDER_COLORS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink'] as const;
const INTERNAL_DOMAINS = ['lpwrk.dev'];
type SenderColor = (typeof SENDER_COLORS)[number];

/** "Ana Petrović <ana@klijent.com>" → name + email; a bare address keeps the address as the name. */
function parseAddr(raw: string | null): { name: string; email: string } {
  const s = (raw ?? '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  if (/@/.test(s)) return { name: s.split(',')[0].trim(), email: s.split(',')[0].trim().toLowerCase() };
  return { name: s, email: '' };
}
/** Colour group of a sender: the company e-mail domain (all people from one firm share a colour), else the name. */
const senderKey = (raw: string | null) => {
  const a = parseAddr(raw);
  const domain = a.email.includes('@') ? a.email.split('@').pop()! : '';
  // Names typed by hand ("Loopwrk:", " FNF ") are normalised so small typos don't split a group.
  const name = a.name.toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
  return (domain || name || 'unknown').toLowerCase();
};
/** Loopwrk = an internal e-mail domain, or a sender written simply as "Loopwrk" (manual entries without an address). */
const isInternal = (key: string) => key === 'loopwrk' || INTERNAL_DOMAINS.some((d) => key === d || key.endsWith('.' + d));
function initialsFrom(name: string): string {
  const clean = name.trim().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
  // An acronym typed in capitals ("FNF", "IT") is already short: keep it as is (up to 3 letters).
  if (/^\p{Lu}{2,3}$/u.test(clean)) return clean;
  // Hyphens, dots and underscores separate words ("Weiss-Muller" → WM, "ana.petrovic@x.rs" → AP).
  const base = clean.includes('@') ? clean.split('@')[0] : clean;
  const parts = base.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? '')).toUpperCase();
}
/** Stable default colour per company. */
function autoColor(key: string): SenderColor {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
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

type ThreadMeta = { root_id: string; category: string | null; subtopic: string | null; status: string | null; priority: string | null; tags: string };
type ThreadStatus = 'open' | 'waiting_us' | 'waiting_client' | 'resolved';
const THREAD_STATUSES: ThreadStatus[] = ['open', 'waiting_us', 'waiting_client', 'resolved'];
type MetaEdit = { root: string; category: string; subtopic: string; status: string; priority: string; tags: string[]; tagInput: string };
const parseTags = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function Correspondence() {
  const app = useApp();
  const { t, lang } = useT();
  const run = useRun();
  const [rows, setRows] = useState<Mail[]>([]);
  const [colors, setColors] = useState<Record<string, SenderColor>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const threadsRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 1280));
  useEffect(() => {
    const el = threadsRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [linking, setLinking] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [add, setAdd] = useState<Record<string, string> | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Mail | null>(null);
  const [q, setQ] = useState('');
  const [firm, setFirm] = useState<string | null>(null);
  const [metas, setMetas] = useState<Record<string, ThreadMeta>>({});
  const [metaEdit, setMetaEdit] = useState<MetaEdit | null>(null);
  const [fCat, setFCat] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPrio, setFPrio] = useState('');
  const [fTag, setFTag] = useState('');
  const [openResolved, setOpenResolved] = useState<Set<string>>(new Set());
  const [view, setViewState] = useState<'threads' | 'grid'>(() => {
    try {
      return localStorage.getItem('ll.mailView') === 'grid' ? 'grid' : 'threads';
    } catch {
      return 'threads';
    }
  });
  const setView = (v: 'threads' | 'grid') => {
    setViewState(v);
    try {
      localStorage.setItem('ll.mailView', v);
    } catch {
      /* private mode: just don't remember */
    }
  };
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState('');
  const [bulkTag, setBulkTag] = useState('');
  const canChange = (m: Mail) => app.me.role === 'admin' || (!!m.created_by && m.created_by === app.me.id);
  const pad = (n: number) => String(n).padStart(2, '0');
  const replyTo = (m: Mail) =>
    setAdd(
      blank({
        reply_to: m.id,
        direction: m.direction === 'in' ? 'out' : 'in',
        subject: m.subject ? (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`) : '',
        // Replying to the client: we are the sender (their "To", or simply "Loopwrk"); replying to us: the client is.
        from_addr: m.direction === 'in' ? m.to_addr?.split(',')[0].trim() || 'Loopwrk' : m.to_addr?.split(',')[0].trim() ?? '',
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
      body_html: m.body_html ?? textToHtml(m.body ?? ''),
    });
  };
  const pid = app.project!.id;
  const load = () => api.get<Mail[]>(`/projects/${pid}/correspondence`).then(setRows).catch(() => {});
  const loadColors = () =>
    api
      .get<{ sender_key: string; color: SenderColor }[]>(`/projects/${pid}/senders`)
      .then((r) => setColors(Object.fromEntries(r.map((x) => [x.sender_key, x.color]))))
      .catch(() => {});
  const loadMetas = () =>
    api
      .get<ThreadMeta[]>(`/projects/${pid}/threads`)
      .then((r) => setMetas(Object.fromEntries(r.map((x) => [x.root_id, x]))))
      .catch(() => {});
  useEffect(() => {
    load();
    loadColors();
    loadMetas();
  }, [pid]);

  const colorOf = (key: string): SenderColor | 'lw' =>
    isInternal(key) ? 'lw' : SENDER_COLORS.includes(colors[key]) ? colors[key] : autoColor(key);
  const setColor = async (key: string, color: SenderColor) => {
    setColors({ ...colors, [key]: color });
    setPicking(null);
    await run(() => api.put(`/projects/${pid}/senders`, { sender_key: key, color }));
  };

  // Senders (legend) and threads grouped by subject, oldest message first inside a thread.
  // Legend: one chip per company (e-mail domain); Loopwrk first.
  const senders = new Map<string, { name: string; people: Set<string>; n: number }>();
  for (const m of rows) {
    const k = senderKey(m.from_addr);
    const a = parseAddr(m.from_addr);
    const label = isInternal(k) ? 'Loopwrk' : a.email ? k : a.name.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '') || k;
    const cur = senders.get(k) ?? { name: label || t('pm_unknown_sender'), people: new Set<string>(), n: 0 };
    cur.people.add(a.name || a.email || t('pm_unknown_sender'));
    cur.n++;
    senders.set(k, cur);
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
  const matchQ = (m: Mail) => `${m.subject} ${m.from_addr} ${m.to_addr} ${m.body}`.toLowerCase().includes(ql);
  const matchF = (m: Mail) => senderKey(m.from_addr) === firm;
  /** With a filter on, messages that don't match stay visible (context) but are dimmed. */
  const isMiss = (m: Mail) => (!!ql && !matchQ(m)) || (!!firm && !matchF(m));
  /** Wraps search hits in <mark> inside plain text. */
  const hl = (text: string) => {
    if (!ql) return text;
    const out: (string | preact.JSX.Element)[] = [];
    const low = text.toLowerCase();
    let i = 0;
    for (let j = low.indexOf(ql); j !== -1; j = low.indexOf(ql, i)) {
      out.push(text.slice(i, j), <mark class="hit">{text.slice(j, j + ql.length)}</mark>);
      i = j + ql.length;
    }
    out.push(text.slice(i));
    return out;
  };
  // Thread info: messages, roots, metadata (stored on the first root) and the effective status.
  // Status "auto" follows who wrote last: client → waiting on us, Loopwrk → waiting on the client.
  const allThreads = [...groups.values()].map((list) => {
    const ms = [...list].sort((a, b) => a.sent_at - b.sent_at);
    const roots = ms.filter((m) => !m.reply_to || !byId.has(m.reply_to));
    const first = roots[0] ?? ms[0];
    const meta = roots.map((r) => metas[r.id]).find(Boolean) ?? null;
    const last = ms[ms.length - 1];
    const autoStatus: ThreadStatus = isInternal(senderKey(last.from_addr)) || last.direction === 'out' ? 'waiting_client' : 'waiting_us';
    const status = (meta?.status as ThreadStatus | null) ?? autoStatus;
    return { ms, roots, first, meta, metaRoot: meta?.root_id ?? first.id, status, autoStatus, auto: !meta?.status, tags: parseTags(meta?.tags), last };
  });
  type ThreadInfo = (typeof allThreads)[number];
  const categories = [...new Set(allThreads.map((x) => x.meta?.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const allTags = [...new Set(allThreads.flatMap((x) => x.tags))].sort((a, b) => a.localeCompare(b));
  const threads = allThreads
    .filter(({ ms }) => (!ql || ms.some(matchQ)) && (!firm || ms.some(matchF)))
    .filter((x) => !fCat || (fCat === '__none' ? !x.meta?.category : x.meta?.category === fCat))
    .filter((x) => !fStatus || x.status === fStatus)
    .filter((x) => !fPrio || (x.meta?.priority ?? 'normal') === fPrio)
    .filter((x) => !fTag || x.tags.includes(fTag))
    .sort((a, b) => a.last.sent_at - b.last.sent_at);
  // Group by category (only when at least one thread has one); groups ordered by their latest activity.
  const sections: { cat: string | null; list: ThreadInfo[] }[] = [];
  if (categories.length) {
    const byCat = new Map<string | null, ThreadInfo[]>();
    for (const x of threads) byCat.set(x.meta?.category ?? null, [...(byCat.get(x.meta?.category ?? null) ?? []), x]);
    for (const [cat, list] of byCat) sections.push({ cat, list });
    sections.sort((a, b) => a.list[a.list.length - 1].last.sent_at - b.list[b.list.length - 1].last.sent_at);
  } else sections.push({ cat: null, list: threads });
  const anyFilter = !!(firm || ql || fCat || fStatus || fPrio || fTag);
  const clearAll = () => {
    setFirm(null);
    setQ('');
    setFCat('');
    setFStatus('');
    setFPrio('');
    setFTag('');
  };
  const openMeta = (x: ThreadInfo) =>
    setMetaEdit({
      root: x.metaRoot,
      category: x.meta?.category ?? '',
      subtopic: x.meta?.subtopic ?? '',
      status: x.meta?.status ?? '',
      priority: x.meta?.priority ?? '',
      tags: x.tags,
      tagInput: '',
    });
  const saveMeta = async () => {
    if (!metaEdit) return;
    const tags = [...metaEdit.tags, ...metaEdit.tagInput.split(',')].map((s) => s.trim()).filter(Boolean);
    const ok = await run(() =>
      api.put(`/projects/${pid}/threads/${metaEdit.root}`, {
        category: metaEdit.category.trim() || null,
        subtopic: metaEdit.subtopic.trim() || null,
        status: metaEdit.status || null,
        priority: metaEdit.priority || null,
        tags,
      }),
    );
    if (ok) {
      setMetaEdit(null);
      loadMetas();
    }
  };
  const statusLabel = (st: ThreadStatus) => t(`pm_st_${st}` as never);
  type MetaPatch = Partial<{ category: string | null; subtopic: string | null; status: string | null; priority: string | null; tags: string[] }>;
  /** Saves part of a thread's metadata (grid cells and bulk actions); the UI updates right away. */
  const saveMetaFor = async (x: ThreadInfo, patch: MetaPatch) => {
    const next = {
      category: x.meta?.category ?? null,
      subtopic: x.meta?.subtopic ?? null,
      status: x.meta?.status ?? null,
      priority: x.meta?.priority ?? null,
      tags: x.tags,
      ...patch,
    };
    setMetas((m) => ({ ...m, [x.metaRoot]: { root_id: x.metaRoot, ...next, tags: JSON.stringify(next.tags) } }));
    return run(() => api.put(`/projects/${pid}/threads/${x.metaRoot}`, next));
  };
  const bulk = async (f: (x: ThreadInfo) => MetaPatch) => {
    const list = allThreads.filter((x) => picked.has(x.metaRoot));
    for (const x of list) await saveMetaFor(x, f(x));
    loadMetas();
  };
  const textCell = (x: ThreadInfo, field: 'category' | 'subtopic', list?: string) => (
    <input
      key={`${x.metaRoot}-${field}-${x.meta?.[field] ?? ''}`}
      class="cell"
      list={list}
      defaultValue={x.meta?.[field] ?? ''}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v !== (x.meta?.[field] ?? '')) saveMetaFor(x, { [field]: v || null });
      }}
    />
  );
  // Nesting depth adapts to the available width: each level indents ~43 px and a reply box keeps room
  // for a full readable line (~640 px). Phones always get 2 levels; wide monitors up to 8.
  const maxDepth = width <= 640 ? 2 : Math.max(3, Math.min(8, Math.floor((width - 52 - 640) / 43) + 1));
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
        <div id={`mail-${m.id}`} class={'tl-item sc-' + color + (kids ? ' has-kids' : '') + (isMiss(m) ? ' miss' : '')}>
          <div class="tl-rail">
            {color === 'lw' ? (
              <span class="tl-av" title={name}>
                {k === 'loopwrk' ? 'L' : initialsFrom(name)}
                <i class="lw-dot" />
              </span>
            ) : (
              <button type="button" class="tl-av" title={t('pm_sender_color')} aria-label={`${name} · ${t('pm_sender_color')}`} onClick={() => setPicking(picking === m.id ? null : m.id)}>
                {initialsFrom(name)}
              </button>
            )}
            {picking === m.id && color !== 'lw' && <ColorPicker value={color} onPick={(c) => setColor(k, c)} onClose={() => setPicking(null)} />}
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
            {m.body_html ? (
                <div class={'tl-body tl-rich' + (long && !open ? ' clamp' : '')} dangerouslySetInnerHTML={{ __html: highlightHtml(cleanHtml(m.body_html), ql) }} />
              ) : (
                <div class={'tl-body' + (long && !open ? ' clamp' : '')}>{m.body ? hl(m.body) : <span class="faint">—</span>}</div>
              )}
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
            .sort((a, b) => Number(isInternal(b[0])) - Number(isInternal(a[0])) || b[1].n - a[1].n)
            .map(([k, s]) => {
              const c = colorOf(k);
              const who = [...s.people].join(', ');
              return (
                <span class="sender-chip-wrap">
                  <button
                    type="button"
                    class={'sender-chip sc-' + c + (firm === k ? ' on' : '') + (firm && firm !== k ? ' off' : '')}
                    title={`${who} · ${t('pm_filter_firm')}`}
                    aria-pressed={firm === k}
                    onClick={() => setFirm(firm === k ? null : k)}
                  >
                    <i />
                    {s.name}
                    <small>{s.n}</small>
                  </button>
                </span>
              );
            })}
          {anyFilter && (
            <button type="button" class="linkbtn clear-f" onClick={clearAll}>
              × {t('pm_clear_filter')}
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div class="th-filters">
          <div class="seg" role="group" aria-label={t('pm_view')}>
            <button type="button" aria-pressed={view === 'threads'} onClick={() => setView('threads')}>
              {t('pm_view_threads')}
            </button>
            <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
              {t('pm_view_grid')}
            </button>
          </div>
          <select class="input sm" value={fCat} onChange={(e) => setFCat(e.currentTarget.value)} aria-label={t('pm_category')}>
            <option value="">{t('pm_all_categories')}</option>
            {categories.map((c) => (
              <option value={c}>{c}</option>
            ))}
            <option value="__none">{t('pm_no_category')}</option>
          </select>
          <select class="input sm" value={fStatus} onChange={(e) => setFStatus(e.currentTarget.value)} aria-label={t('pm_status')}>
            <option value="">{t('pm_all_statuses')}</option>
            {THREAD_STATUSES.map((st) => (
              <option value={st}>{statusLabel(st)}</option>
            ))}
          </select>
          <select class="input sm" value={fPrio} onChange={(e) => setFPrio(e.currentTarget.value)} aria-label={t('pm_priority')}>
            <option value="">{t('pm_all_priorities')}</option>
            <option value="high">{t('pm_prio_high')}</option>
            <option value="normal">{t('pm_prio_normal')}</option>
            <option value="low">{t('pm_prio_low')}</option>
          </select>
          {allTags.length > 0 && (
            <select class="input sm" value={fTag} onChange={(e) => setFTag(e.currentTarget.value)} aria-label={t('pm_tags')}>
              <option value="">{t('pm_all_tags')}</option>
              {allTags.map((g) => (
                <option value={g}>#{g}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {!threads.length && <div class="empty">{t('pm_mail_empty')}</div>}

      {view === 'grid' && threads.length > 0 && (
        <>
          {picked.size > 0 && (
            <div class="bulk-bar">
              <b>
                {picked.size} {t('pm_selected')}
              </b>
              <span class="bulk-f">
                <input class="input sm" list="ll-cats-grid" placeholder={t('pm_category')} value={bulkCat} onInput={(e) => setBulkCat(e.currentTarget.value)} />
                <button type="button" class="btn sm" disabled={!bulkCat.trim()} onClick={() => bulk(() => ({ category: bulkCat.trim() })).then(() => setBulkCat(''))}>
                  {t('pm_apply')}
                </button>
              </span>
              <select class="input sm" value="" onChange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; bulk(() => ({ status: v === 'auto' ? null : v })); }}>
                <option value="">{t('pm_status')}…</option>
                <option value="auto">{t('pm_status_auto')}</option>
                {THREAD_STATUSES.map((st) => (
                  <option value={st}>{statusLabel(st)}</option>
                ))}
              </select>
              <select class="input sm" value="" onChange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; bulk(() => ({ priority: v === 'normal' ? null : v })); }}>
                <option value="">{t('pm_priority')}…</option>
                <option value="high">{t('pm_prio_high')}</option>
                <option value="normal">{t('pm_prio_normal')}</option>
                <option value="low">{t('pm_prio_low')}</option>
              </select>
              <span class="bulk-f">
                <input
                  class="input sm"
                  list="ll-tags-grid"
                  placeholder={t('pm_add_tag')}
                  value={bulkTag}
                  onInput={(e) => setBulkTag(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    const v = bulkTag.trim();
                    if (e.key === 'Enter' && v) bulk((x) => ({ tags: x.tags.includes(v) ? x.tags : [...x.tags, v] })).then(() => setBulkTag(''));
                  }}
                />
              </span>
              <button type="button" class="linkbtn" onClick={() => setPicked(new Set())}>
                × {t('pm_clear_selection')}
              </button>
            </div>
          )}
          <div class="grid-wrap">
            <table class="sheet threads-sheet">
              <thead>
                <tr>
                  <th class="pick">
                    <input
                      type="checkbox"
                      aria-label={t('select_all')}
                      checked={threads.length > 0 && threads.every((x) => picked.has(x.metaRoot))}
                      onChange={(e) => setPicked(e.currentTarget.checked ? new Set(threads.map((x) => x.metaRoot)) : new Set())}
                    />
                  </th>
                  <th>{t('pm_subject')}</th>
                  <th>{t('pm_category')}</th>
                  <th>{t('pm_subtopic')}</th>
                  <th>{t('pm_status')}</th>
                  <th>{t('pm_priority')}</th>
                  <th>{t('pm_tags')}</th>
                  <th class="r">#</th>
                  <th>{t('pm_last_activity')}</th>
                </tr>
              </thead>
              <tbody>
                {sections.map(({ cat, list }) => (
                  <>
                    {categories.length > 0 && (
                      <tr class="grp">
                        <td colSpan={9} class="grpc">
                          {cat ?? t('pm_no_category')}
                          <span class="key">· {list.length}</span>
                        </td>
                      </tr>
                    )}
                    {list.map((x) => (
                      <tr class={picked.has(x.metaRoot) ? 'picked' : ''}>
                        <td class="pick">
                          <input
                            type="checkbox"
                            checked={picked.has(x.metaRoot)}
                            onChange={() => {
                              const n = new Set(picked);
                              n.has(x.metaRoot) ? n.delete(x.metaRoot) : n.add(x.metaRoot);
                              setPicked(n);
                            }}
                          />
                        </td>
                        <td class="th-title-cell">
                          <button
                            type="button"
                            class="linkbtn"
                            title={t('pm_open_thread')}
                            onClick={() => {
                              setView('threads');
                              setTimeout(() => jumpTo(x.first.id), 60);
                            }}
                          >
                            {x.first.subject || autoSubject(x.first.body) || '—'}
                          </button>
                        </td>
                        <td>{textCell(x, 'category', 'll-cats-grid')}</td>
                        <td>{textCell(x, 'subtopic')}</td>
                        <td>
                          <select
                            class={'cell th-st-cell st-' + x.status}
                            value={x.meta?.status ?? ''}
                            onChange={(e) => saveMetaFor(x, { status: e.currentTarget.value || null })}
                          >
                            <option value="">
                              {statusLabel(x.autoStatus)} (auto)
                            </option>
                            {THREAD_STATUSES.map((st) => (
                              <option value={st}>{statusLabel(st)}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select class="cell th-pr-cell" value={x.meta?.priority ?? ''} onChange={(e) => saveMetaFor(x, { priority: e.currentTarget.value || null })}>
                            <option value="low">{t('pm_prio_low')}</option>
                            <option value="">{t('pm_prio_normal')}</option>
                            <option value="high">{t('pm_prio_high')}</option>
                          </select>
                        </td>
                        <td>
                          <input
                            key={`${x.metaRoot}-tags-${x.tags.join(',')}`}
                            class="cell"
                            defaultValue={x.tags.join(', ')}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                            onBlur={(e) => {
                              const tags = [...new Set(e.currentTarget.value.split(',').map((v) => v.trim()).filter(Boolean))];
                              if (tags.join(',') !== x.tags.join(',')) saveMetaFor(x, { tags });
                            }}
                          />
                        </td>
                        <td class="r k">{x.ms.length}</td>
                        <td class="k">{fmtStamp(x.last.sent_at, lang)}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
            <datalist id="ll-cats-grid">
              {categories.map((c) => (
                <option value={c} />
              ))}
            </datalist>
            <datalist id="ll-tags-grid">
              {allTags.map((g) => (
                <option value={g} />
              ))}
            </datalist>
          </div>
        </>
      )}

      <div class="threads" ref={threadsRef} style={view === 'grid' ? { display: 'none' } : undefined}>
        {sections.map(({ cat, list }) => (
          <div class="th-section">
            {categories.length > 0 && (
              <h3 class="th-cat">
                {cat ?? <span class="faint">{t('pm_no_category')}</span>}
                <small>{list.length}</small>
              </h3>
            )}
            {list.map((x) => {
              const { ms, roots, first } = x;
              const folded = x.status === 'resolved' && fStatus !== 'resolved' && !openResolved.has(x.metaRoot) && !ql;
              const n = ms.length;
              return (
                <section class={'thread' + (x.status === 'resolved' ? ' resolved' : '')}>
                  <header class="thread-h">
                    <b>{first.subject ? hl(first.subject) : <span class="auto-title">{hl(autoSubject(first.body) ?? '—')}</span>}</b>
                    {x.meta?.subtopic && <span class="th-sub">› {x.meta.subtopic}</span>}
                    <button type="button" class={'th-status st-' + x.status} title={x.auto ? t('pm_status_auto_hint') : ''} onClick={() => openMeta(x)}>
                      <i />
                      {statusLabel(x.status)}
                      {x.auto && <small> · auto</small>}
                    </button>
                    {x.meta?.priority === 'high' && <span class="th-prio hi">↑ {t('pm_prio_high')}</span>}
                    {x.meta?.priority === 'low' && <span class="th-prio lo">↓ {t('pm_prio_low')}</span>}
                    {x.tags.map((g) => (
                      <button type="button" class={'th-tag' + (fTag === g ? ' on' : '')} onClick={() => setFTag(fTag === g ? '' : g)}>
                        #{g}
                      </button>
                    ))}
                    <span class="meta">
                      {n} {n % 10 === 1 && n % 100 !== 11 ? t('pm_message') : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? t('pm_messages_few') : t('pm_messages')} · {fmtStamp(x.last.sent_at, lang)}
                    </span>
                    <button type="button" class="linkbtn th-edit" onClick={() => openMeta(x)}>
                      {x.meta ? t('pm_edit_thread') : t('pm_categorize')}
                    </button>
                  </header>
                  {folded ? (
                    <button type="button" class="linkbtn th-unfold" onClick={() => setOpenResolved(new Set([...openResolved, x.metaRoot]))}>
                      {t('pm_show_resolved')} ({n})
                    </button>
                  ) : (
                    <>
                      {renderList(roots, 0)}
                      {x.status === 'resolved' && openResolved.has(x.metaRoot) && (
                        <button
                          type="button"
                          class="linkbtn th-unfold"
                          onClick={() => {
                            const s2 = new Set(openResolved);
                            s2.delete(x.metaRoot);
                            setOpenResolved(s2);
                          }}
                        >
                          {t('pm_hide_resolved')}
                        </button>
                      )}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        ))}
      </div>

      {metaEdit && (
        <Modal
          title={t('pm_thread_meta')}
          onClose={() => setMetaEdit(null)}
          footer={
            <>
              <button class="btn" onClick={() => setMetaEdit(null)}>{t('cancel')}</button>
              <button class="btn solid" onClick={saveMeta}>{t('save')}</button>
            </>
          }
        >
          <div class="form">
            <div class="two">
              <label class="field">
                <span class="label">{t('pm_category')}</span>
                <input class="input" list="ll-cats" placeholder={t('pm_category_ph')} value={metaEdit.category} onInput={(e) => setMetaEdit({ ...metaEdit, category: e.currentTarget.value })} />
                <datalist id="ll-cats">
                  {categories.map((c) => (
                    <option value={c} />
                  ))}
                </datalist>
              </label>
              <label class="field">
                <span class="label">{t('pm_subtopic')}</span>
                <input class="input" list="ll-subs" placeholder={t('pm_subtopic_ph')} value={metaEdit.subtopic} onInput={(e) => setMetaEdit({ ...metaEdit, subtopic: e.currentTarget.value })} />
                <datalist id="ll-subs">
                  {[...new Set(allThreads.filter((x) => (x.meta?.category ?? '') === metaEdit.category.trim()).map((x) => x.meta?.subtopic).filter(Boolean) as string[])].map((c) => (
                    <option value={c} />
                  ))}
                </datalist>
              </label>
            </div>
            <div class="field">
              <span class="label">{t('pm_status')}</span>
              <div class="seg wrap">
                <button type="button" aria-pressed={!metaEdit.status} onClick={() => setMetaEdit({ ...metaEdit, status: '' })}>
                  {t('pm_status_auto')}
                </button>
                {THREAD_STATUSES.map((st) => (
                  <button type="button" aria-pressed={metaEdit.status === st} onClick={() => setMetaEdit({ ...metaEdit, status: st })}>
                    {statusLabel(st)}
                  </button>
                ))}
              </div>
              <span class="hint">{t('pm_status_auto_hint')}</span>
            </div>
            <div class="field">
              <span class="label">{t('pm_priority')}</span>
              <div class="seg">
                {(['low', '', 'high'] as const).map((pr) => (
                  <button type="button" aria-pressed={metaEdit.priority === pr} onClick={() => setMetaEdit({ ...metaEdit, priority: pr })}>
                    {pr === 'low' ? t('pm_prio_low') : pr === 'high' ? t('pm_prio_high') : t('pm_prio_normal')}
                  </button>
                ))}
              </div>
            </div>
            <div class="field">
              <span class="label">{t('pm_tags')}</span>
              <div class="tag-input">
                {metaEdit.tags.map((g) => (
                  <span class="th-tag on">
                    #{g}
                    <button type="button" aria-label="×" onClick={() => setMetaEdit({ ...metaEdit, tags: metaEdit.tags.filter((x) => x !== g) })}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  list="ll-tags"
                  placeholder={t('pm_tags_ph')}
                  value={metaEdit.tagInput}
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    if (v.includes(',')) {
                      const parts = v.split(',');
                      const done = parts.slice(0, -1).map((s) => s.trim()).filter((s) => s && !metaEdit.tags.includes(s));
                      setMetaEdit({ ...metaEdit, tags: [...metaEdit.tags, ...done], tagInput: parts[parts.length - 1] });
                    } else setMetaEdit({ ...metaEdit, tagInput: v });
                  }}
                  onKeyDown={(e) => {
                    const v = metaEdit.tagInput.trim();
                    if (e.key === 'Enter' && v) {
                      e.preventDefault();
                      if (!metaEdit.tags.includes(v)) setMetaEdit({ ...metaEdit, tags: [...metaEdit.tags, v], tagInput: '' });
                      else setMetaEdit({ ...metaEdit, tagInput: '' });
                    } else if (e.key === 'Backspace' && !metaEdit.tagInput && metaEdit.tags.length) {
                      setMetaEdit({ ...metaEdit, tags: metaEdit.tags.slice(0, -1) });
                    }
                  }}
                />
                <datalist id="ll-tags">
                  {allTags.map((g) => (
                    <option value={g} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>
        </Modal>
      )}

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
                    loadMetas();
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
              <input class="input" placeholder={t('pm_subject_auto')} value={add.subject ?? ''} onInput={(e) => setAdd({ ...add, subject: e.currentTarget.value })} />
            </label>
            {!add.id && !add.reply_to && (
              <div class="two">
                <label class="field">
                  <span class="label">{t('pm_category')}</span>
                  <input class="input" list="ll-cats-new" placeholder={t('pm_optional')} value={add.category ?? ''} onInput={(e) => setAdd({ ...add, category: e.currentTarget.value })} />
                  <datalist id="ll-cats-new">
                    {categories.map((c) => (
                      <option value={c} />
                    ))}
                  </datalist>
                </label>
                <label class="field">
                  <span class="label">{t('pm_subtopic')}</span>
                  <input class="input" placeholder={t('pm_optional')} value={add.subtopic ?? ''} onInput={(e) => setAdd({ ...add, subtopic: e.currentTarget.value })} />
                </label>
              </div>
            )}
            <div class="field">
              <span class="label">{t('pm_body')}</span>
              <RichEditor html={add.body_html ?? (add.body ? textToHtml(add.body) : '')} onChange={(html, text) => setAdd((cur) => (cur ? { ...cur, body_html: html, body: text } : cur))} />
            </div>
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
