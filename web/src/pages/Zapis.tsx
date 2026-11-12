import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { fmtDate, fmtStamp, useT } from '../i18n';
import { go, useApp } from '../state';
import { Icon, Modal } from '../components/ui';
import { extractFile, ImportError } from '../import/extract';
import { parseDocItems, type DocItem, type Kind } from '../import/statements';

// ---------------------------------------------------------------- types & labels

type Role = 'client' | 'agency' | 'partner' | 'us';
type Party = { id: string; name: string; role: Role; position: number; people: string };
type Status = 'open' | 'done' | 'dropped';
type Source = 'document' | 'message' | 'meeting' | 'call' | 'other';
type LinkKind = 'changes' | 'contradicts' | 'confirms';
type Statement = {
  id: string; topic: string | null; kind: Kind; party_id: string | null; via_party_id: string | null; said_by: string | null; said_at: number;
  quote: string; note: string | null; status: Status; due_at: number | null; source_type: Source; source_label: string | null;
  source_msg_id: string | null; source_msg_subject: string | null; doc_id: string | null; content_sha256: string | null; locked: number;
  created_by: string | null; created_by_name: string | null;
};
type Link = { id: string; from_id: string; to_id: string; kind: LinkKind };
type Doc = { id: string; file_name: string | null; title: string | null; content_sha256: string | null; count: number; created_at: number; created_by: string | null; created_by_name: string | null };
export type RecordTab = { id: string; title: string | null; file_name: string | null; count: number };

const KIND: Record<Kind, string> = { requirement: 'Zahtev', promise: 'Obećanje', claim: 'Tvrdnja', decision: 'Odluka', question: 'Pitanje' };
const ROLE: Record<Role, string> = { client: 'Klijent', agency: 'Agencija', partner: 'Partner', us: 'Mi' };
const ROLE_COLOR: Record<Role, string> = { client: 'amber', agency: 'violet', partner: 'blue', us: 'lw' };
const STATUS: Record<Status, string> = { open: 'Otvoreno', done: 'Ispunjeno', dropped: 'Odustalo se' };
const SOURCE: Record<Source, string> = { document: 'Dokument', message: 'Poruka', meeting: 'Sastanak', call: 'Poziv', other: 'Drugo' };
const LINK_OUT: Record<LinkKind, string> = { changes: 'menja', contradicts: 'protivreči', confirms: 'potvrđuje' };
const LINK_IN: Record<LinkKind, string> = { changes: 'Promenjeno', contradicts: 'Sporno', confirms: 'Potvrđeno' };

/** Set by Loopthreads ("→ Zapis" on a message) right before navigating here. */
export let pendingStatement: Partial<Statement> | null = null;
export const queueStatement = (s: Partial<Statement>) => {
  pendingStatement = s;
};
/** A link may point into another record: remember which statement to show after switching tabs. */
let pendingJump: string | null = null;
/** Tells the project page to reload its record tabs (created, renamed, deleted). */
export const recordsChanged = () => window.dispatchEvent(new CustomEvent('ll:records'));
const recPath = (key: string, id: string) => `p/${key}/project/rec-${id}`;

const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toDay = (ms: number | null) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const initials = (s: string) =>
  s
    .split(/[\s&-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
const izjava = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'izjava' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'izjave' : 'izjava');

function useRun() {
  const app = useApp();
  return async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Greška na mreži.', 'err');
      return false;
    }
  };
}

// ---------------------------------------------------------------- page

export function Zapis({ docId }: { docId: string }) {
  const app = useApp();
  const { lang } = useT();
  const run = useRun();
  const pid = app.project!.id;
  const [parties, setParties] = useState<Party[]>([]);
  const [rows, setRows] = useState<Statement[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState<Partial<Statement> | null>(null);
  const [linkFrom, setLinkFrom] = useState<Statement | null>(null);
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Statement | null>(null);
  const [q, setQ] = useState('');
  const [fKind, setFKind] = useState('');
  const [fParty, setFParty] = useState('');
  const [fTopic, setFTopic] = useState('');
  const [fState, setFState] = useState('');

  const load = () =>
    Promise.all([
      api.get<Party[]>(`/projects/${pid}/parties`).then(setParties),
      api.get<{ statements: Statement[]; links: Link[]; docs: Doc[] }>(`/projects/${pid}/statements`).then((r) => {
        setRows(r.statements);
        setLinks(r.links);
        setDocs(r.docs);
      }),
    ])
      .catch(() => {})
      .finally(() => setLoaded(true));
  useEffect(() => {
    load();
    if (pendingStatement) {
      setEdit({ ...pendingStatement, doc_id: docId });
      pendingStatement = null;
    }
  }, [pid, docId]);
  useEffect(() => {
    if (!pendingJump || !rows.length) return;
    const id = pendingJump;
    pendingJump = null;
    jump(id);
  }, [rows]);
  const doc = docs.find((d) => d.id === docId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [delRecord, setDelRecord] = useState(false);
  const all = rows;
  const recTitle = (id: string | null) => docs.find((d) => d.id === id)?.title ?? '';

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  // A statement taken from a Loopthreads message: recognise the sender's party from names / e-mail domains.
  useEffect(() => {
    if (!edit || edit.id || edit.party_id || !edit.said_by || !parties.length) return;
    const who = edit.said_by.toLowerCase();
    const hit = parties.find((p) =>
      [p.name, ...p.people.split(',')].map((x) => x.trim().toLowerCase()).filter((x) => x.length > 1).some((tok) => who.includes(tok)),
    );
    if (hit) setEdit({ ...edit, party_id: hit.id });
  }, [parties, edit?.said_by]);
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const recRows = all.filter((s) => s.doc_id === docId);
  const inLinks = (id: string) => links.filter((l) => l.to_id === id);
  const outLinks = (id: string) => links.filter((l) => l.from_id === id);
  const now = Date.now();
  const overdue = (s: Statement) => s.kind === 'promise' && s.status === 'open' && !!s.due_at && s.due_at < now;
  const states = (s: Statement) => {
    const inc = inLinks(s.id);
    return {
      disputed: inc.some((l) => l.kind === 'contradicts'),
      changed: inc.some((l) => l.kind === 'changes'),
      confirmed: inc.some((l) => l.kind === 'confirms'),
      overdue: overdue(s),
      openQuestion: s.kind === 'question' && s.status === 'open',
    };
  };
  const topics = [...new Set(recRows.map((s) => s.topic || 'Bez teme'))];
  const counts = {
    disputed: recRows.filter((s) => states(s).disputed).length,
    changed: recRows.filter((s) => states(s).changed).length,
    overdue: recRows.filter((s) => states(s).overdue).length,
    openQuestion: recRows.filter((s) => states(s).openQuestion).length,
  };

  const ql = q.trim().toLowerCase();
  const visible = recRows.filter((s) => {
    if (ql && !`${s.quote} ${s.said_by ?? ''} ${s.note ?? ''} ${s.topic ?? ''} ${s.source_label ?? ''}`.toLowerCase().includes(ql)) return false;
    if (fKind && s.kind !== fKind) return false;
    if (fParty && s.party_id !== fParty) return false;
    if (fTopic && (s.topic || 'Bez teme') !== fTopic) return false;
    if (fState && !states(s)[fState as keyof ReturnType<typeof states>]) return false;
    return true;
  });
  // Topics in order of first appearance (a document's structure stays intact); statements by date inside.
  const sections = topics.map((tp) => ({ topic: tp, list: visible.filter((s) => (s.topic || 'Bez teme') === tp) })).filter((x) => x.list.length);
  const anyFilter = !!(ql || fKind || fParty || fTopic || fState);
  const clear = () => {
    setQ('');
    setFKind('');
    setFParty('');
    setFTopic('');
    setFState('');
  };

  const jump = (id: string) => {
    const target = byId.get(id);
    if (target && target.doc_id && target.doc_id !== docId) {
      pendingJump = id;
      go(recPath(app.project!.key, target.doc_id));
      return;
    }
    if (anyFilter) clear();
    setTimeout(() => {
      const el = document.getElementById(`st-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1400);
    }, 30);
  };
  const setStatus = async (s: Statement, status: Status) => {
    setRows(rows.map((r) => (r.id === s.id ? { ...r, status } : r)));
    await run(() => api.patch(`/statements/${s.id}`, { status }));
  };
  const color = (pId: string | null) => ROLE_COLOR[partyById.get(pId ?? '')?.role ?? 'partner'];

  const card = (s: Statement) => {
    const p = partyById.get(s.party_id ?? '');
    const via = partyById.get(s.via_party_id ?? '');
    const st = states(s);
    const canDel = app.me.role === 'admin' || (!s.locked && s.created_by === app.me.id);
    return (
      <article id={`st-${s.id}`} class={`st sc-${color(s.party_id)}${st.disputed ? ' disputed' : ''}${st.changed ? ' changed' : ''}${s.status !== 'open' ? ' closed' : ''}`}>
        <div class="st-av" title={p ? `${p.name} · ${ROLE[p.role]}` : 'Nepoznata strana'}>
          {p ? initials(p.name) : '?'}
          {p?.role === 'us' && <i class="lw-dot" />}
        </div>
        <div class="st-main">
          <header class="st-h">
            <span class={`st-kind k-${s.kind}`}>{KIND[s.kind]}</span>
            <b>{p?.name ?? 'Nepoznata strana'}</b>
            {via && <span class="faint">preko {via.name}</span>}
            {s.said_by && <span class="st-who">· {s.said_by}</span>}
            <span class="st-side">
              <time>{fmtStamp(s.said_at, lang)}</time>
              {!!s.locked && (
                <span class="st-lock" title={`Zaključano: uvezeno iz dokumenta. Otisak sadržaja ${s.content_sha256?.slice(0, 12)}…`}>
                  🔒
                </span>
              )}
              <button type="button" class="tl-act" title="Izmeni" aria-label="Izmeni" onClick={() => setEdit(s)}>
                <Icon name="pencil" />
              </button>
              {canDel && (
                <button type="button" class="tl-act del" title="Obriši" aria-label="Obriši" onClick={() => setConfirmDel(s)}>
                  <Icon name="trash" />
                </button>
              )}
            </span>
          </header>

          <blockquote class="st-q">{s.quote}</blockquote>
          {s.note && <p class="st-note">{s.note}</p>}

          {(st.disputed || st.changed || st.confirmed || outLinks(s.id).length > 0) && (
            <div class="st-links">
              {inLinks(s.id).map((l) => {
                const o = byId.get(l.from_id);
                if (!o) return null;
                return (
                  <button type="button" class={`st-link in-${l.kind}`} onClick={() => jump(o.id)}>
                    <b>{LINK_IN[l.kind]}</b> · {partyById.get(o.party_id ?? '')?.name ?? '?'}, {fmtDate(toDay(o.said_at))}
                    {o.doc_id !== docId ? ` · ${recTitle(o.doc_id) || 'drugi zapis'}` : ''}: „{o.quote.slice(0, 70)}
                    {o.quote.length > 70 ? '…' : ''}“
                  </button>
                );
              })}
              {outLinks(s.id).map((l) => {
                const o = byId.get(l.to_id);
                if (!o) return null;
                return (
                  <span class={`st-link out-${l.kind}`}>
                    <button type="button" class="linkbtn" onClick={() => jump(o.id)}>
                      ↪ {LINK_OUT[l.kind]}: {partyById.get(o.party_id ?? '')?.name ?? '?'}, {fmtDate(toDay(o.said_at))}
                      {o.doc_id !== docId ? ` · ${recTitle(o.doc_id) || 'drugi zapis'}` : ''} „{o.quote.slice(0, 60)}
                      {o.quote.length > 60 ? '…' : ''}“
                    </button>
                    <button type="button" class="x" title="Ukloni vezu" aria-label="Ukloni vezu" onClick={() => run(() => api.del(`/statement-links/${l.id}`)).then(load)}>
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <footer class="st-f">
            <span class="st-src">
              {SOURCE[s.source_type]}
              {s.source_label ? ` · ${s.source_label}` : ''}
              {s.source_msg_id && (
                <>
                  {' · '}
                  <a href={`#/p/${app.project!.key}/project/mail`} onClick={(e) => { e.preventDefault(); go(`p/${app.project!.key}/project/mail`); }}>
                    {s.source_msg_subject || 'poruka u Loopthreads'}
                  </a>
                </>
              )}
            </span>
            {s.kind === 'promise' && s.due_at && (
              <span class={'st-due' + (st.overdue ? ' late' : '')}>
                Rok {fmtDate(toDay(s.due_at))}
                {st.overdue ? ` · kasni ${Math.ceil((now - s.due_at) / 86_400_000)} d` : ''}
              </span>
            )}
            <span class="st-actions">
              <select class="st-status" value={s.status} aria-label="Stanje" onChange={(e) => setStatus(s, e.currentTarget.value as Status)}>
                {(Object.keys(STATUS) as Status[]).map((k) => (
                  <option value={k}>{STATUS[k]}</option>
                ))}
              </select>
              <button type="button" class="fbtn strong" onClick={() => setLinkFrom(s)}>
                ⇄ Poveži
              </button>
            </span>
          </footer>
        </div>
      </article>
    );
  };

  return (
    <>
      <div class="rec-h">
        {renaming !== null ? (
          <form
            class="rec-rename"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.patch(`/projects/${pid}/statement-docs/${docId}`, { title: renaming }))) {
                setRenaming(null);
                recordsChanged();
                load();
              }
            }}
          >
            <input class="input" id="rec-title" value={renaming} onInput={(e) => setRenaming(e.currentTarget.value)} autoFocus />
            <button class="btn sm solid" type="submit">Sačuvaj</button>
            <button class="btn sm" type="button" onClick={() => setRenaming(null)}>Otkaži</button>
          </form>
        ) : (
          <h3 class="rec-title">
            {doc?.title || doc?.file_name || 'Zapis'}
            <button type="button" class="tl-act" title="Preimenuj zapis" aria-label="Preimenuj zapis" onClick={() => setRenaming(doc?.title || doc?.file_name || '')}>
              <Icon name="pencil" />
            </button>
          </h3>
        )}
        <span class="rec-meta">
          {doc?.file_name ? `${doc.file_name} · ` : 'Zapis bez dokumenta · '}
          {recRows.length} {izjava(recRows.length)}
          {doc?.content_sha256 && <span title={`SHA-256 celog dokumenta: ${doc.content_sha256}`}> · otisak {doc.content_sha256.slice(0, 10)}…</span>}
          {doc && ` · ${fmtStamp(doc.created_at, lang)}${doc.created_by_name ? ' · ' + doc.created_by_name : ''}`}
        </span>
        {doc && (app.me.role === 'admin' || doc.created_by === app.me.id) && (
          <button type="button" class="linkbtn danger rec-del" onClick={() => setDelRecord(true)}>
            Obriši zapis
          </button>
        )}
      </div>

      {/* chain of parties */}
      <div class="chain-bar">
        <span class="mf-l">Lanac</span>
        {parties.length ? (
          parties.map((p, i) => (
            <>
              {i > 0 && <span class="chain-arr">→</span>}
              <button
                type="button"
                class={`chain-p sc-${ROLE_COLOR[p.role]}${fParty === p.id ? ' on' : ''}`}
                title={`${ROLE[p.role]}${p.people ? ' · ' + p.people : ''} · prikaži samo izjave ove strane`}
                onClick={() => setFParty(fParty === p.id ? '' : p.id)}
              >
                <i />
                {p.name}
                <small>{ROLE[p.role]}</small>
              </button>
            </>
          ))
        ) : (
          <span class="faint">Strane u projektu nisu postavljene.</span>
        )}
        <button type="button" class="linkbtn chain-edit" onClick={() => setPartiesOpen(true)}>
          {parties.length ? 'Uredi lanac' : 'Postavi lanac'}
        </button>
      </div>

      <div class="mail-bar">
        <label class="mail-search">
          <Icon name="search" />
          <input placeholder="Pretraži izjave…" value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Pretraži izjave" />
        </label>
        <button class="btn solid mail-add" onClick={() => setEdit({ kind: 'claim', said_at: Date.now(), source_type: 'other', status: 'open', doc_id: docId })}>
          <Icon name="plus" />
          Nova izjava
        </button>
      </div>

      {/* what needs attention: these are also the quick filters */}
      {recRows.length > 0 && (
        <div class="st-alerts">
          {(
            [
              ['disputed', 'Sporno', counts.disputed],
              ['changed', 'Promenjeno', counts.changed],
              ['overdue', 'Obećanja posle roka', counts.overdue],
              ['openQuestion', 'Otvorena pitanja', counts.openQuestion],
            ] as const
          ).map(([k, label, n]) => (
            <button type="button" class={`st-alert a-${k}${fState === k ? ' on' : ''}${n ? '' : ' zero'}`} onClick={() => setFState(fState === k ? '' : k)}>
              <b>{n}</b> {label}
            </button>
          ))}
          <span class="st-alert-sep" />
          <label class={'pill-sel' + (fKind ? ' on' : '')}>
            <select value={fKind} onChange={(e) => setFKind(e.currentTarget.value)} aria-label="Tip">
              <option value="">Tip</option>
              {(Object.keys(KIND) as Kind[]).map((k) => (
                <option value={k}>{KIND[k]}</option>
              ))}
            </select>
          </label>
          <label class={'pill-sel' + (fTopic ? ' on' : '')}>
            <select value={fTopic} onChange={(e) => setFTopic(e.currentTarget.value)} aria-label="Tema">
              <option value="">Tema</option>
              {topics.map((tp) => (
                <option value={tp}>{tp}</option>
              ))}
            </select>
          </label>
          {anyFilter && (
            <button type="button" class="linkbtn clear-f" onClick={clear}>
              × Poništi filter
            </button>
          )}
        </div>
      )}

      {loaded && !recRows.length && (
        <div class="empty st-empty">
          <b>U ovom zapisu još nema izjava.</b>
          <span>Dodaj izjavu ručno, ili u Loopthreads na poruci klikni „→ Zapis“ i izaberi ovaj zapis.</span>
        </div>
      )}
      {recRows.length > 0 && !visible.length && <div class="empty">Nijedna izjava ne odgovara filteru.</div>}

      <div class="st-list">
        {sections.map(({ topic, list }) => (
          <section class="st-sec">
            <h3 class="th-cat">
              {topic}
              <small>{list.length}</small>
            </h3>
            <div class="st-sec-list">{list.map(card)}</div>
          </section>
        ))}
      </div>

      {edit && (
        <StatementForm
          key={`${edit.id ?? 'new'}-${edit.party_id ?? ''}`}
          value={edit}
          parties={parties}
          docs={docs}
          topics={topics.filter((x) => x !== 'Bez teme')}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            load();
          }}
        />
      )}
      {linkFrom && (
        <LinkForm
          from={linkFrom}
          rows={rows}
          docs={docs}
          partyById={partyById}
          onClose={() => setLinkFrom(null)}
          onSaved={() => {
            setLinkFrom(null);
            load();
          }}
        />
      )}
      {partiesOpen && (
        <PartiesForm
          pid={pid}
          parties={parties}
          onClose={() => setPartiesOpen(false)}
          onSaved={() => {
            setPartiesOpen(false);
            load();
          }}
        />
      )}
      {delRecord && (
        <Modal
          title="Obriši zapis"
          onClose={() => setDelRecord(false)}
          footer={
            <>
              <button class="btn" onClick={() => setDelRecord(false)}>Otkaži</button>
              <button
                class="btn solid danger"
                onClick={async () => {
                  if (await run(() => api.del(`/projects/${pid}/statement-docs/${docId}`))) {
                    setDelRecord(false);
                    recordsChanged();
                    go(`p/${app.project!.key}/project/zapis`);
                  }
                }}
              >
                Obriši zapis i {recRows.length} {izjava(recRows.length)}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Trajno obrisati zapis „{doc?.title || doc?.file_name}“ i sve izjave u njemu, zajedno sa njihovim vezama? Ovo ne može da se poništi.
          </p>
        </Modal>
      )}
      {confirmDel && (
        <Modal
          title="Obriši izjavu"
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <button class="btn" onClick={() => setConfirmDel(null)}>Otkaži</button>
              <button
                class="btn solid danger"
                onClick={async () => {
                  if (await run(() => api.del(`/statements/${confirmDel.id}`))) {
                    setConfirmDel(null);
                    load();
                  }
                }}
              >
                Obriši izjavu
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>Trajno obrisati ovu izjavu i njene veze? Ovo ne može da se poništi.</p>
          <p class="meta" style={{ marginTop: '8px' }}>„{confirmDel.quote.slice(0, 160)}“</p>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- add / edit

function StatementForm({ value, parties, docs, topics, onClose, onSaved }: { value: Partial<Statement>; parties: Party[]; docs: Doc[]; topics: string[]; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const run = useRun();
  const [f, setF] = useState<Partial<Statement>>(value);
  const locked = !!value.locked;
  const isNew = !value.id;
  const save = async () => {
    const data = {
      topic: f.topic ?? null,
      kind: f.kind,
      party_id: f.party_id ?? null,
      via_party_id: f.via_party_id ?? null,
      status: f.status ?? 'open',
      due_at: f.kind === 'promise' ? f.due_at ?? null : null,
      note: f.note ?? null,
      ...(locked ? {} : { said_by: f.said_by ?? null, said_at: f.said_at ?? Date.now(), quote: f.quote ?? '', source_type: f.source_type ?? 'other', source_label: f.source_label ?? null }),
      ...(isNew && f.source_msg_id ? { source_msg_id: f.source_msg_id } : {}),
      ...(!locked ? { doc_id: f.doc_id ?? null } : {}),
    };
    const ok = await run(() => (isNew ? api.post(`/projects/${app.project!.id}/statements`, data) : api.patch(`/statements/${value.id}`, data)));
    if (ok) onSaved();
  };
  return (
    <Modal
      title={isNew ? 'Nova izjava' : 'Izmeni izjavu'}
      wide
      onClose={onClose}
      footer={
        <>
          <button class="btn" onClick={onClose}>Otkaži</button>
          <button class="btn solid" disabled={!f.quote?.trim()} onClick={save}>Sačuvaj</button>
        </>
      }
    >
      <div class="form">
        {locked && <div class="warn-box">🔒 Uvezeno iz dokumenta: tekst, autor, datum i izvor su zaključani. Tip, temu, stanje, rok i napomenu možeš da menjaš.</div>}
        <div class="field">
          <span class="label">Tip</span>
          <div class="seg wrap">
            {(Object.keys(KIND) as Kind[]).map((k) => (
              <button type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
                {KIND[k]}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">Šta je rečeno (tačan citat)</span>
          <textarea class="textarea" style={{ minHeight: '110px' }} disabled={locked} value={f.quote ?? ''} onInput={(e) => setF({ ...f, quote: e.currentTarget.value })} />
        </div>
        <div class="three">
          <label class="field">
            <span class="label">Strana</span>
            <select class="input" value={f.party_id ?? ''} onChange={(e) => setF({ ...f, party_id: e.currentTarget.value || null })}>
              <option value="">—</option>
              {parties.map((p) => (
                <option value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label class="field">
            <span class="label">Osoba</span>
            <input class="input" disabled={locked} placeholder="npr. Kovic" value={f.said_by ?? ''} onInput={(e) => setF({ ...f, said_by: e.currentTarget.value })} />
          </label>
          <label class="field">
            <span class="label">Preko (posrednik)</span>
            <select class="input" value={f.via_party_id ?? ''} onChange={(e) => setF({ ...f, via_party_id: e.currentTarget.value || null })}>
              <option value="">—</option>
              {parties.map((p) => (
                <option value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div class="three">
          <label class="field">
            <span class="label">Kada</span>
            <input class="input" type="datetime-local" disabled={locked} value={toLocal(f.said_at ?? Date.now())} onChange={(e) => e.currentTarget.value && setF({ ...f, said_at: new Date(e.currentTarget.value).getTime() })} />
          </label>
          <label class="field">
            <span class="label">Tema</span>
            <input class="input" list="st-topics" placeholder="npr. Loyalty strategija" value={f.topic ?? ''} onInput={(e) => setF({ ...f, topic: e.currentTarget.value })} />
            <datalist id="st-topics">
              {topics.map((x) => (
                <option value={x} />
              ))}
            </datalist>
          </label>
          {f.kind === 'promise' ? (
            <label class="field">
              <span class="label">Rok</span>
              <input class="input" type="date" value={toDay(f.due_at ?? null)} onChange={(e) => setF({ ...f, due_at: e.currentTarget.value ? new Date(e.currentTarget.value + 'T23:59').getTime() : null })} />
            </label>
          ) : (
            <label class="field">
              <span class="label">Stanje</span>
              <select class="input" value={f.status ?? 'open'} onChange={(e) => setF({ ...f, status: e.currentTarget.value as Status })}>
                {(Object.keys(STATUS) as Status[]).map((k) => (
                  <option value={k}>{STATUS[k]}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div class="two">
          <div class="field">
            <span class="label">Izvor</span>
            <div class="seg wrap">
              {(Object.keys(SOURCE) as Source[]).map((k) => (
                <button type="button" disabled={locked} aria-pressed={f.source_type === k} onClick={() => setF({ ...f, source_type: k })}>
                  {SOURCE[k]}
                </button>
              ))}
            </div>
          </div>
          <label class="field">
            <span class="label">Opis izvora</span>
            <input class="input" disabled={locked} placeholder="npr. Sastanak 12.11. · Zoom" value={f.source_label ?? ''} onInput={(e) => setF({ ...f, source_label: e.currentTarget.value })} />
          </label>
        </div>
        {!locked && (
          <label class="field">
            <span class="label">Zapis</span>
            <select class="input" value={f.doc_id ?? ''} onChange={(e) => setF({ ...f, doc_id: e.currentTarget.value || null })}>
              {docs.map((d) => (
                <option value={d.id}>{d.title || d.file_name}</option>
              ))}
            </select>
          </label>
        )}
        <label class="field">
          <span class="label">Napomena (naša, ne deo citata)</span>
          <textarea class="textarea" style={{ minHeight: '60px' }} value={f.note ?? ''} onInput={(e) => setF({ ...f, note: e.currentTarget.value })} />
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- link two statements

function LinkForm({ from, rows, docs, partyById, onClose, onSaved }: { from: Statement; rows: Statement[]; docs: Doc[]; partyById: Map<string, Party>; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const { lang } = useT();
  const run = useRun();
  const [kind, setKind] = useState<LinkKind>('contradicts');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const cands = rows
    .filter((s) => s.id !== from.id)
    .filter((s) => !ql || `${s.quote} ${s.topic ?? ''} ${partyById.get(s.party_id ?? '')?.name ?? ''}`.toLowerCase().includes(ql))
    .slice(0, 60);
  return (
    <Modal
      title="Poveži izjave"
      wide
      onClose={onClose}
      footer={
        <>
          <button class="btn" onClick={onClose}>Otkaži</button>
          <button
            class="btn solid"
            disabled={!to}
            onClick={async () => {
              if (await run(() => api.post(`/projects/${app.project!.id}/statement-links`, { from_id: from.id, to_id: to, kind }))) onSaved();
            }}
          >
            Poveži
          </button>
        </>
      }
    >
      <div class="form">
        <div class="tl-reply static sc-grey">
          <b>Ova izjava</b> · {partyById.get(from.party_id ?? '')?.name ?? '?'}, {fmtDate(toDay(from.said_at))}
          <span class="snip">„{from.quote}“</span>
        </div>
        <div class="field">
          <span class="label">…u odnosu na izabranu</span>
          <div class="seg">
            {(['contradicts', 'changes', 'confirms'] as LinkKind[]).map((k) => (
              <button type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'contradicts' ? 'Protivreči' : k === 'changes' ? 'Menja' : 'Potvrđuje'}
              </button>
            ))}
          </div>
        </div>
        <input class="input" placeholder="Pronađi izjavu…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        <div class="link-list">
          {cands.map((s) => (
            <button type="button" class={'link-c' + (to === s.id ? ' on' : '')} onClick={() => setTo(s.id)}>
              <span class="meta">
                {docs.find((d) => d.id === s.doc_id)?.title ?? '—'} · {KIND[s.kind]} · {partyById.get(s.party_id ?? '')?.name ?? '?'} · {fmtDate(toDay(s.said_at))} · {s.topic || 'Bez teme'}
              </span>
              <span>{s.quote.slice(0, 180)}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- parties

function PartiesForm({ pid, parties, onClose, onSaved }: { pid: string; parties: Party[]; onClose: () => void; onSaved: () => void }) {
  const run = useRun();
  const [list, setList] = useState<Partial<Party>[]>(parties.length ? parties : [{ name: '', role: 'client', people: '' }, { name: 'Loopwrk', role: 'us', people: 'lpwrk.dev' }]);
  const upd = (i: number, p: Partial<Party>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    setList(n);
  };
  return (
    <Modal
      title="Lanac strana u projektu"
      wide
      onClose={onClose}
      footer={
        <>
          <button class="btn" onClick={onClose}>Otkaži</button>
          <button class="btn solid" onClick={async () => (await run(() => api.put(`/projects/${pid}/parties`, { parties: list }))) && onSaved()}>
            Sačuvaj
          </button>
        </>
      }
    >
      <p class="meta" style={{ marginTop: 0 }}>Redom od klijenta do nas. „Ljudi“ su imena ili domeni mejlova, da se pošiljaoci iz Loopthreads sami prepoznaju.</p>
      <div class="parties">
        {list.map((p, i) => (
          <div class="party-row">
            <span class="pos">{i + 1}</span>
            <input class="input" placeholder="Naziv" value={p.name ?? ''} onInput={(e) => upd(i, { name: e.currentTarget.value })} />
            <select class="input" value={p.role ?? 'partner'} onChange={(e) => upd(i, { role: e.currentTarget.value as Role })}>
              {(Object.keys(ROLE) as Role[]).map((r) => (
                <option value={r}>{ROLE[r]}</option>
              ))}
            </select>
            <input class="input" placeholder="Ljudi / domeni, npr. Kovic, Boris, weiss-muller.rs" value={p.people ?? ''} onInput={(e) => upd(i, { people: e.currentTarget.value })} />
            <span class="party-btns">
              <button type="button" class="tl-act" aria-label="Gore" onClick={() => move(i, -1)}>↑</button>
              <button type="button" class="tl-act" aria-label="Dole" onClick={() => move(i, 1)}>↓</button>
              <button type="button" class="tl-act del" aria-label="Ukloni" onClick={() => setList(list.filter((_, j) => j !== i))}>×</button>
            </span>
          </div>
        ))}
      </div>
      <button type="button" class="btn sm" style={{ marginTop: '10px' }} onClick={() => setList([...list, { name: '', role: 'partner', people: '' }])}>
        + Dodaj stranu
      </button>
    </Modal>
  );
}

// ---------------------------------------------------------------- document import

function DocImport({ pid, parties, onClose, onDone }: { pid: string; parties: Party[]; onClose: () => void; onDone: (id: string) => void }) {
  const app = useApp();
  const { lang } = useT();
  const [step, setStep] = useState<'pick' | 'preview'>('pick');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [items, setItems] = useState<DocItem[]>([]);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(Date.now());
  const client = parties.find((p) => p.role === 'client');
  const partner = parties.find((p) => p.role === 'partner');
  const [party, setParty] = useState(client?.id ?? '');
  const [via, setVia] = useState(partner?.id ?? '');
  const [saidBy, setSaidBy] = useState('');

  const pick = async (f: File) => {
    setBusy(true);
    setErr('');
    try {
      const x = await extractFile(f);
      if (x.kind !== 'text') throw new ImportError('Za Zapis uvezi dokument (Word, PDF, Pages, tekst). Mejlove uvozi u Loopthreads.');
      const r = parseDocItems(x.text);
      if (!r.items.length) throw new ImportError('U dokumentu nisam našao stavke.');
      setItems(r.items);
      setText(x.text);
      setFileName(f.name);
      setTitle(r.title || f.name.replace(/\.[^.]+$/, ''));
      if (r.date) setDate(r.date);
      setStep('preview');
    } catch (e) {
      setErr(e instanceof ImportError ? e.message : `Fajl nije mogao da se pročita (${(e as Error).message || 'nepoznata greška'}).`);
    } finally {
      setBusy(false);
    }
  };
  const doImport = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ count: number; doc_id: string }>(`/projects/${pid}/statement-docs`, {
        file_name: fileName,
        title,
        party_id: party || null,
        via_party_id: via || null,
        said_by: saidBy || null,
        said_at: date,
        full_text: text,
        items: items.filter((i) => i.include).map((i) => ({ topic: i.topic, section: i.section, quote: i.quote, kind: i.kind })),
      });
      app.toast(`Uvezeno ${r.count} ${izjava(r.count)}.`, 'ok');
      onClose();
      onDone(r.doc_id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Uvoz nije uspeo.');
    } finally {
      setBusy(false);
    }
  };
  const n = items.filter((i) => i.include).length;
  const groups = [...new Set(items.map((i) => i.topic))];
  return (
    <Modal
      title="Uvezi dokument u Zapis"
      wide
      onClose={onClose}
      footer={
        step === 'pick' ? (
          <button class="btn" onClick={onClose}>Zatvori</button>
        ) : (
          <>
            <button class="btn" onClick={() => setStep('pick')}>← Drugi fajl</button>
            <button class="btn solid" disabled={busy || !n} onClick={doImport}>
              {busy ? 'Uvozim…' : `Uvezi ${n} ${izjava(n)}`}
            </button>
          </>
        )
      }
    >
      {err && <div class="imp-err">{err}</div>}
      {step === 'pick' && (
        <div class="imp-pick">
          <label class="imp-drop">
            <input
              type="file"
              id="st-file"
              accept=".docx,.pdf,.pages,.odt,.rtf,.txt,.md,.html,.htm"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) pick(f);
                e.currentTarget.value = '';
              }}
            />
            <Icon name="up" />
            <b>{busy ? 'Čitam dokument…' : 'Brief, ugovor, zapisnik: prevuci ili klikni'}</b>
            <span>Word · PDF · Pages · tekst. Dokument dobija svoj tab: naslovi postaju teme, svaka stavka postaje zaključana izjava.</span>
          </label>
        </div>
      )}
      {step === 'preview' && (
        <div class="imp-prev">
          <div class="imp-grid">
            <label class="field">
              <span class="label">Naziv dokumenta</span>
              <input class="input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
            </label>
            <label class="field">
              <span class="label">Datum dokumenta</span>
              <input class="input" type="date" value={toDay(date)} onChange={(e) => e.currentTarget.value && setDate(new Date(e.currentTarget.value + 'T12:00').getTime())} />
            </label>
            <label class="field">
              <span class="label">Osoba (opciono)</span>
              <input class="input" placeholder="ko je poslao / potpisao" value={saidBy} onInput={(e) => setSaidBy(e.currentTarget.value)} />
            </label>
            <label class="field">
              <span class="label">Čije su izjave</span>
              <select class="input" value={party} onChange={(e) => setParty(e.currentTarget.value)}>
                <option value="">—</option>
                {parties.map((p) => (
                  <option value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span class="label">Stiglo preko</span>
              <select class="input" value={via} onChange={(e) => setVia(e.currentTarget.value)}>
                <option value="">— direktno</option>
                {parties.map((p) => (
                  <option value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div class="imp-list">
            {groups.map((g) => (
              <div class="doc-g">
                <div class="doc-g-h">{g}</div>
                {items.map((it, i) =>
                  it.topic !== g ? null : (
                    <div class={'doc-it' + (it.include ? '' : ' off')}>
                      <input type="checkbox" checked={it.include} aria-label="Uključi" onChange={() => setItems(items.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))} />
                      <select class="input sm" value={it.kind} aria-label="Tip" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, kind: e.currentTarget.value as Kind } : x)))}>
                        {(Object.keys(KIND) as Kind[]).map((k) => (
                          <option value={k}>{KIND[k]}</option>
                        ))}
                      </select>
                      <span class="doc-q">{it.quote}</span>
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- "+ Zapis": list of records, import, new empty record

export function ZapisHome() {
  const app = useApp();
  const { lang } = useT();
  const run = useRun();
  const pid = app.project!.id;
  const [docs, setDocs] = useState<Doc[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [name, setName] = useState('');
  const pending = !!pendingStatement;
  const load = () =>
    Promise.all([
      api.get<Party[]>(`/projects/${pid}/parties`).then(setParties),
      api.get<{ docs: Doc[]; statements: Statement[] }>(`/projects/${pid}/statements`).then((r) =>
        setDocs(r.docs.map((d) => ({ ...d, count: r.statements.filter((x) => x.doc_id === d.id).length }))),
      ),
    ]).catch(() => {});
  useEffect(() => {
    load();
  }, [pid]);
  const open = (id: string) => go(recPath(app.project!.key, id));
  const create = async () => {
    const title = name.trim();
    if (!title) return;
    try {
      const r = await api.post<{ id: string }>(`/projects/${pid}/statement-docs/empty`, { title });
      recordsChanged();
      open(r.id);
    } catch (e) {
      app.toast(e instanceof ApiError ? e.message : 'Zapis nije napravljen.', 'err');
    }
  };
  return (
    <>
      {pending && <div class="warn-box rec-pending">Izaberi zapis u koji ide izjava iz poruke, ili napravi novi.</div>}
      <div class="chain-bar">
        <span class="mf-l">Lanac</span>
        {parties.length ? (
          parties.map((p, i) => (
            <>
              {i > 0 && <span class="chain-arr">→</span>}
              <span class={`chain-p sc-${ROLE_COLOR[p.role]}`} title={p.people}>
                <i />
                {p.name}
                <small>{ROLE[p.role]}</small>
              </span>
            </>
          ))
        ) : (
          <span class="faint">Strane u projektu nisu postavljene.</span>
        )}
        <button type="button" class="linkbtn chain-edit" onClick={() => setPartiesOpen(true)}>
          {parties.length ? 'Uredi lanac' : 'Postavi lanac'}
        </button>
      </div>

      <div class="rec-grid">
        {docs.map((d) => (
          <button type="button" class="rec-card" onClick={() => open(d.id)}>
            <span class="eyebrow-s">{d.file_name ? 'Dokument' : 'Zapis'}</span>
            <b>{d.title || d.file_name}</b>
            <span class="meta">
              {d.count} {izjava(d.count)} · {fmtStamp(d.created_at, lang)}
            </span>
            {d.file_name && <span class="faint rec-file">{d.file_name}</span>}
          </button>
        ))}
        <div class="rec-card new">
          <span class="eyebrow-s">Novi zapis</span>
          <button type="button" class="btn solid" onClick={() => setImportOpen(true)}>
            <Icon name="up" />
            Uvezi dokument
          </button>
          <span class="meta">brief, ugovor, zapisnik: svaki dobija svoj tab</span>
          <form
            class="rec-new"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input class="input" id="rec-new-name" placeholder="ili prazan zapis, npr. Sastanci" value={name} onInput={(e) => setName(e.currentTarget.value)} />
            <button class="btn" type="submit" disabled={!name.trim()}>
              Napravi
            </button>
          </form>
        </div>
      </div>

      {importOpen && (
        <DocImport
          pid={pid}
          parties={parties}
          onClose={() => setImportOpen(false)}
          onDone={(id) => {
            recordsChanged();
            open(id);
          }}
        />
      )}
      {partiesOpen && (
        <PartiesForm
          pid={pid}
          parties={parties}
          onClose={() => setPartiesOpen(false)}
          onSaved={() => {
            setPartiesOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}
