import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, type Item } from '../api';
import { fmtDate, fmtNum, fmtStamp, useT } from '../i18n';
import { go, useApp } from '../state';
import { Icon, Modal } from '../components/ui';
import { isLeaf } from '../hours';
import { ApprovalDoc, type Approval } from '../components/ApprovalDoc';

type Mail = {
  id: string; source: 'email' | 'manual'; direction: 'in' | 'out'; from_addr: string | null; to_addr: string | null; cc_addr: string | null;
  subject: string | null; body: string; attachments: string; sent_at: number; item_id: string | null; item_key: string | null; created_by_name: string | null;
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

// ---------------- correspondence ----------------
function Correspondence() {
  const app = useApp();
  const { t, lang } = useT();
  const run = useRun();
  const [rows, setRows] = useState<Mail[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState<Record<string, string> | null>(null);
  const [q, setQ] = useState('');
  const load = () => api.get<Mail[]>(`/projects/${app.project!.id}/correspondence`).then(setRows).catch(() => {});
  useEffect(() => {
    load();
  }, [app.project?.id]);
  const shown = rows.filter((m) => !q || `${m.subject} ${m.from_addr} ${m.body}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div class="tb">
        <span class="meta">{t('pm_mail_lede')}</span>
        <div class="row sp">
          <input class="input" style={{ width: '220px' }} placeholder={t('filter_ph')} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="btn solid" onClick={() => setAdd({ direction: 'in', sent_on: new Date().toISOString().slice(0, 10) })}>
            <Icon name="plus" />
            {t('pm_add_mail')}
          </button>
        </div>
      </div>
      {!shown.length && <div class="empty">{t('pm_mail_empty')}</div>}
      {shown.map((m) => {
        const atts = (() => {
          try {
            return JSON.parse(m.attachments) as { name: string }[];
          } catch {
            return [];
          }
        })();
        return (
          <div class="mail">
            <div class="mail-h" onClick={() => setOpen(open === m.id ? null : m.id)}>
              <span class={'tag' + (m.direction === 'out' ? ' on' : '')}>{m.direction === 'out' ? t('pm_out') : t('pm_in')}</span>
              <b>{m.subject || '—'}</b>
              <span class="meta">{m.from_addr}</span>
              <time>{fmtStamp(m.sent_at, lang)}</time>
            </div>
            {open === m.id && (
              <>
                <div class="mail-b">{m.body}</div>
                <div class="mail-f">
                  <span>
                    {t('pm_to')}: {m.to_addr || '—'}
                    {m.cc_addr ? ` · CC: ${m.cc_addr}` : ''}
                  </span>
                  {atts.length > 0 && <span>{t('pm_attachments')}: {atts.map((a) => a.name).join(', ')}</span>}
                  <span>{m.source === 'email' ? t('pm_src_email') : `${t('pm_src_manual')} · ${m.created_by_name ?? ''}`}</span>
                  <span style={{ marginLeft: 'auto' }} class="row">
                    {t('pm_link_item')}
                    <span style={{ width: '220px' }}>
                      <ItemPick value={m.item_id} onChange={async (v) => (await run(() => api.patch(`/correspondence/${m.id}`, { item_id: v }))) && load()} />
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
      {add && (
        <Modal
          title={t('pm_add_mail')}
          wide
          onClose={() => setAdd(null)}
          footer={
            <>
              <button class="btn" onClick={() => setAdd(null)}>{t('cancel')}</button>
              <button
                class="btn solid"
                onClick={async () => {
                  if (await run(() => api.post(`/projects/${app.project!.id}/correspondence`, add))) {
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
            <div class="two">
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
            </div>
            <div class="two">
              <label class="field">
                <span class="label">{t('pm_from')}</span>
                <input class="input" value={add.from_addr ?? ''} onInput={(e) => setAdd({ ...add, from_addr: e.currentTarget.value })} />
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
