import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { fmtStamp, useT } from '../i18n';
import { useApp } from '../state';
import { Icon, Modal } from './ui';
import { extractFile, ImportError } from '../import/extract';
import { normSubject, parseText, threadEmails, type Draft, type Format } from '../import/parse';

type Side = 'lw' | 'client';
type ThreadChoice = { id: string; title: string; lastId: string };
type ImportRow = { id: string; file_name: string | null; format: string | null; count: number; remaining: number; created_at: number; created_by: string | null; created_by_name: string | null };
type Row = Draft & { include: boolean };

const FORMAT_LABEL: Record<Format, string> = {
  whatsapp: 'WhatsApp',
  viber: 'Viber',
  chat: 'Čet',
  'email-text': 'Mejl (tekst)',
  email: 'Mejl fajl',
  speakers: 'Beleška sa govornicima',
  plain: 'Običan tekst',
};
const ACCEPT = '.txt,.csv,.eml,.mbox,.zip,.docx,.odt,.pdf,.pages,.rtf,.html,.htm,.md,.doc,.msg';

const SIDES_KEY = 'll.importSides';
const loadSides = (): Record<string, Side> => {
  try {
    return JSON.parse(localStorage.getItem(SIDES_KEY) ?? '{}');
  } catch {
    return {};
  }
};
const saveSides = (s: Record<string, Side>) => {
  try {
    localStorage.setItem(SIDES_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
};
const pad = (n: number) => String(n).padStart(2, '0');
/** 1 poruka, 2–4 poruke, 5+ poruka */
const poruka = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'poruka' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'poruke' : 'poruka');
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * "Uvezi prepisku": file or pasted text → parsed messages → preview (who is Loopwrk, dates, thread, category) → import.
 * `defaultSide` decides the starting side for a sender name/address; the user's choice is remembered per browser.
 */
export function MailImport({
  pid,
  threads,
  categories,
  defaultSide,
  onClose,
  onDone,
}: {
  pid: string;
  threads: ThreadChoice[];
  categories: string[];
  defaultSide: (from: string) => Side;
  onClose: () => void;
  onDone: () => void;
}) {
  const app = useApp();
  const { lang } = useT();
  const [step, setStep] = useState<'pick' | 'preview'>('pick');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [paste, setPaste] = useState('');
  const [drag, setDrag] = useState(false);
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<Format>('plain');
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState('');
  const [chain, setChain] = useState(false);
  const [target, setTarget] = useState(''); // '' = new thread, else root id
  const [category, setCategory] = useState('');
  const [subtopic, setSubtopic] = useState('');
  const [tags, setTags] = useState('');
  const [sides, setSides] = useState<Record<string, Side>>(loadSides);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadImports = () => api.get<ImportRow[]>(`/projects/${pid}/correspondence/imports`).then(setImports).catch(() => {});
  useEffect(() => {
    loadImports();
  }, [pid]);

  const take = (drafts: Draft[], fmt: Format, ttl: string, ch: boolean, name: string) => {
    if (!drafts.length) {
      setErr('U ovome nisam našao nijednu poruku.');
      return;
    }
    setFormat(fmt);
    setFileName(name);
    setTitle(ttl || name.replace(/\.[^.]+$/, ''));
    setChain(ch);
    setRows(drafts.map((d) => ({ ...d, include: true })));
    setStep('preview');
    setErr('');
  };

  const fromFile = async (f: File) => {
    setBusy(true);
    setErr('');
    try {
      const x = await extractFile(f);
      if (x.kind === 'emails') {
        const mails = threadEmails(x.mails);
        take(mails, 'email', normSubject(mails[0]?.subject ?? ''), true, x.name);
      } else {
        const r = parseText(x.text, x.name);
        take(r.drafts, r.format, r.title, r.chain, x.name);
      }
    } catch (e) {
      setErr(e instanceof ImportError ? e.message : `Fajl nije mogao da se pročita (${(e as Error).message || 'nepoznata greška'}).`);
    } finally {
      setBusy(false);
    }
  };
  const fromPaste = () => {
    const r = parseText(paste, '');
    take(r.drafts, r.format, r.title, r.chain, 'Zalepljen tekst');
  };

  // Senders and their side (Loopwrk / client)
  const senders = useMemo(() => [...new Set(rows.map((r) => r.from.trim()).filter(Boolean))], [rows]);
  const sideOf = (from: string): Side => sides[from.trim()] ?? defaultSide(from);
  const setSide = (from: string, s: Side) => {
    const next = { ...sides, [from.trim()]: s };
    setSides(next);
    saveSides(next);
  };

  // Messages without a date follow the previous one by a minute, so the order stays as in the file.
  const dated = useMemo(() => {
    let last = Date.now() - rows.length * 60_000;
    return rows.map((r) => {
      const t = r.sentAt ?? last + 60_000;
      last = t;
      return t;
    });
  }, [rows]);
  const undated = rows.filter((r) => r.include && r.sentAt === null).length;
  const included = rows.filter((r) => r.include).length;
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const doImport = async () => {
    const ex = threads.find((x) => x.id === target);
    const base = ex ? normSubject(ex.title) : title.trim();
    const tagList = [...new Set(tags.split(',').map((v) => v.trim()).filter(Boolean))];
    // Keep only included rows; a reply whose parent was left out answers the nearest earlier included message.
    const keep = rows.map((r, i) => ({ r, t: dated[i] })).filter((x) => x.r.include);
    keep.sort((a, b) => a.t - b.t);
    const keys = new Set<string>();
    const messages = keep.map(({ r, t }, i) => {
      let reply_key: string | null = null;
      if (chain) reply_key = r.replyKey && keys.has(r.replyKey) ? r.replyKey : i > 0 ? keep[i - 1].r.key : null;
      keys.add(r.key);
      const subj = format === 'email' || format === 'email-text' ? (i === 0 && base ? base : r.subject || (base ? `Re: ${base}` : '')) : i === 0 || !chain ? base : `Re: ${base}`;
      return {
        key: r.key,
        reply_key,
        reply_to_existing: !!ex && chain && i === 0,
        direction: sideOf(r.from) === 'lw' ? 'out' : 'in',
        from_addr: r.from.trim() || (sideOf(r.from) === 'lw' ? 'Loopwrk' : ''),
        to_addr: r.to,
        subject: subj,
        body: r.body,
        body_html: r.html ?? null,
        sent_at: t,
        category: category.trim() || null,
        subtopic: subtopic.trim() || null,
        tags: tagList,
      };
    });
    setBusy(true);
    try {
      const res = await api.post<{ count: number }>(`/projects/${pid}/correspondence/import`, {
        file_name: fileName,
        format,
        reply_to: ex?.lastId ?? null,
        messages,
      });
      app.toast(`Uvezeno ${res.count} poruka.`, 'ok');
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Uvoz nije uspeo. Pokušaj ponovo.');
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id: string) => {
    try {
      await api.del(`/projects/${pid}/correspondence/imports/${id}`);
      app.toast('Uvoz je poništen.', 'ok');
      loadImports();
      onDone();
    } catch (e) {
      app.toast(e instanceof ApiError ? e.message : 'Poništavanje nije uspelo.', 'err');
    }
  };

  return (
    <Modal
      title="Uvezi prepisku"
      wide
      onClose={onClose}
      footer={
        step === 'pick' ? (
          <button class="btn" onClick={onClose}>
            Zatvori
          </button>
        ) : (
          <>
            <button class="btn" onClick={() => setStep('pick')}>
              ← Drugi fajl
            </button>
            <button class="btn solid" disabled={busy || !included} onClick={doImport}>
              {busy ? 'Uvozim…' : `Uvezi ${included} ${included % 10 === 1 && included % 100 !== 11 ? 'poruku' : poruka(included)}`}
            </button>
          </>
        )
      }
    >
      {err && <div class="imp-err">{err}</div>}

      {step === 'pick' && (
        <div class="imp-pick">
          <label
            class={'imp-drop' + (drag ? ' on' : '')}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) fromFile(f);
            }}
          >
            <input
              ref={fileRef}
              id="imp-file"
              type="file"
              accept={ACCEPT}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) fromFile(f);
                e.currentTarget.value = '';
              }}
            />
            <Icon name="up" />
            <b>{busy ? 'Čitam fajl…' : 'Prevuci fajl ovde ili klikni da izabereš'}</b>
            <span>WhatsApp i Viber izvoz (.txt, .zip, .csv) · mejl (.eml, .mbox) · Word (.docx) · PDF · Pages · RTF · HTML · tekst</span>
          </label>
          <div class="imp-or">ili zalepi tekst</div>
          <textarea
            id="imp-paste"
            class="textarea"
            placeholder={'Zalepi prepisku iz mejla, četa ili beleške…'}
            value={paste}
            onInput={(e) => setPaste(e.currentTarget.value)}
          />
          <div class="imp-row-end">
            <button class="btn solid" disabled={!paste.trim()} onClick={fromPaste}>
              Obradi tekst →
            </button>
          </div>
          {imports.length > 0 && (
            <div class="imp-hist">
              <span class="label">Poslednji uvozi</span>
              {imports.map((i) => (
                <div class="imp-hist-row">
                  <span>
                    <b>{i.file_name || 'Uvoz'}</b> · {i.remaining} {poruka(i.remaining)} · {fmtStamp(i.created_at, lang)}
                    {i.created_by_name ? ` · ${i.created_by_name}` : ''}
                  </span>
                  {i.remaining > 0 && (app.me.role === 'admin' || i.created_by === app.me.id) && (
                    <button type="button" class="linkbtn danger" onClick={() => undo(i.id)}>
                      Poništi uvoz
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div class="imp-prev">
          <div class="imp-sum">
            <span class="tag on">{FORMAT_LABEL[format]}</span>
            <b>{fileName}</b>
            <span class="meta">
              {rows.length} {poruka(rows.length)}
              {undated > 0 ? ` · ${undated} bez datuma (popunjeno redom, proveri)` : ''}
            </span>
          </div>

          <div class="imp-grid">
            <label class="field">
              <span class="label">Naslov threada</span>
              <input class="input" disabled={!!target} value={target ? threads.find((x) => x.id === target)?.title ?? '' : title} onInput={(e) => setTitle(e.currentTarget.value)} />
            </label>
            <label class="field">
              <span class="label">Gde</span>
              <select class="input" value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
                <option value="">Novi thread</option>
                {threads.map((x) => (
                  <option value={x.id}>Dodaj u: {x.title}</option>
                ))}
              </select>
            </label>
            <div class="field">
              <span class="label">Struktura</span>
              <div class="seg">
                <button type="button" aria-pressed={chain} onClick={() => setChain(true)}>
                  Odgovori u lancu
                </button>
                <button type="button" aria-pressed={!chain} onClick={() => setChain(false)}>
                  Sve na istom nivou
                </button>
              </div>
            </div>
            <label class="field">
              <span class="label">Kategorija</span>
              <input class="input" list="imp-cats" placeholder="opciono" value={category} onInput={(e) => setCategory(e.currentTarget.value)} />
              <datalist id="imp-cats">
                {categories.map((c) => (
                  <option value={c} />
                ))}
              </datalist>
            </label>
            <label class="field">
              <span class="label">Podtema</span>
              <input class="input" placeholder="opciono" value={subtopic} onInput={(e) => setSubtopic(e.currentTarget.value)} />
            </label>
            <label class="field">
              <span class="label">Tagovi</span>
              <input class="input" placeholder="npr. whatsapp, faza 2" value={tags} onInput={(e) => setTags(e.currentTarget.value)} />
            </label>
          </div>

          {senders.length > 0 && (
            <div class="imp-senders">
              <span class="label">Ko je ko</span>
              {senders.map((s) => (
                <div class="imp-sender">
                  <span class="nm" title={s}>
                    {s}
                  </span>
                  <div class="seg">
                    <button type="button" aria-pressed={sideOf(s) === 'lw'} onClick={() => setSide(s, 'lw')}>
                      Loopwrk
                    </button>
                    <button type="button" aria-pressed={sideOf(s) === 'client'} onClick={() => setSide(s, 'client')}>
                      Klijent
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div class="imp-list">
            {rows.map((r, i) => (
              <div class={'imp-msg' + (r.include ? '' : ' off') + (sideOf(r.from) === 'lw' ? ' lw' : '')}>
                <input type="checkbox" aria-label="Uključi poruku" checked={r.include} onChange={() => setRow(i, { include: !r.include })} />
                <div class="imp-msg-main">
                  <div class="imp-msg-h">
                    <input class="input sm" aria-label="Pošiljalac" placeholder="Pošiljalac" value={r.from} onInput={(e) => setRow(i, { from: e.currentTarget.value })} />
                    <span class="dir">{sideOf(r.from) === 'lw' ? '↗ Izlaz' : '↙ Ulaz'}</span>
                    <input
                      class={'input sm dt' + (r.sentAt === null ? ' guess' : '')}
                      type="datetime-local"
                      aria-label="Datum i vreme"
                      value={toLocalInput(dated[i])}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        if (v) setRow(i, { sentAt: new Date(v).getTime() });
                      }}
                    />
                  </div>
                  <textarea class="textarea imp-body" aria-label="Tekst poruke" value={r.body} onInput={(e) => setRow(i, { body: e.currentTarget.value, html: null })} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
