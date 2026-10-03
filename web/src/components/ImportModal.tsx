import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { fmtStamp, useT } from '../i18n';
import { useApp } from '../state';
import { Modal } from './ui';
import { FIELDS, HEADERS, autoMap, downloadTemplate, readFile, type Field, type Sheet } from '../excel';

type Issue = { row: number; level: 'error' | 'warn'; msg: string };
type Result = { total: number; new: number; updated: number; errors: number; warnings: number; issues: Issue[]; applied: boolean; importId?: string };
type Imp = { id: string; file_name: string | null; rows_new: number; rows_updated: number; undone: number; created_at: number; user_name: string };

export function ImportModal({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { t, lang } = useT();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [map, setMap] = useState<(Field | '')[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [recent, setRecent] = useState<Imp[]>([]);
  const pid = app.project!.id;

  const loadRecent = () => api.get<Imp[]>(`/projects/${pid}/imports`).then(setRecent).catch(() => {});
  useEffect(() => {
    loadRecent();
  }, []);

  const sheet = sheets[sheetIdx];
  useEffect(() => {
    if (sheet) setMap(sheet.headers.map((h) => autoMap(h)));
  }, [sheetIdx, sheets]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setBusy(true);
    try {
      const s = await readFile(f);
      if (!s.length || !s.some((x) => x.rows.length)) throw new Error(t('imp_empty'));
      setFile(f);
      setSheets(s);
      setSheetIdx(Math.max(0, s.findIndex((x) => x.rows.length)));
      setStep(2);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  const rows = () =>
    sheet.rows.map((r) => {
      const o: Record<string, unknown> = { row: r.row };
      map.forEach((f, i) => {
        if (f && r.cells[i] !== undefined && r.cells[i] !== '') o[f] = r.cells[i];
      });
      return o;
    });

  const send = async (dryRun: boolean) => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.post<Result>(`/projects/${pid}/import`, { rows: rows(), dryRun, fileName: file?.name });
      setResult(r);
      setStep(3);
      if (r.applied) {
        await app.reloadProject();
        loadRecent();
      }
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id: string) => {
    try {
      await api.post(`/imports/${id}/undo`);
      await app.reloadProject();
      loadRecent();
      app.toast(t('imp_undone'));
      if (result?.importId === id) onClose();
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
    }
  };

  const mapped = map.filter(Boolean);
  const dupes = mapped.filter((f, i) => mapped.indexOf(f) !== i);
  const canPreview = map.includes('title') || map.includes('key');

  const footer =
    step === 1 ? (
      <button class="btn" onClick={onClose}>{t('cancel')}</button>
    ) : step === 2 ? (
      <>
        <button class="btn" onClick={() => setStep(1)}>{t('back')}</button>
        <button class="btn solid" disabled={busy || !canPreview || dupes.length > 0} onClick={() => send(true)}>
          {t('imp_check')} {sheet?.rows.length ?? 0} →
        </button>
      </>
    ) : result?.applied ? (
      <>
        {result.importId && <button class="btn danger" onClick={() => undo(result.importId!)}>{t('imp_undo')}</button>}
        <button class="btn solid" onClick={onClose}>{t('close')}</button>
      </>
    ) : (
      <>
        <button class="btn" onClick={() => setStep(2)}>{t('back')}</button>
        <button class="btn solid" disabled={busy || !result || result.errors > 0 || result.new + result.updated === 0} onClick={() => send(false)}>
          {t('imp_apply')} {result ? result.new + result.updated : ''}
        </button>
      </>
    );

  return (
    <Modal title={t('imp_title')} onClose={onClose} footer={footer} wide>
      <div class="steps-row">
        {[t('imp_s1'), t('imp_s2'), t('imp_s3')].map((s, i) => (
          <span class={'step' + (step === i + 1 ? ' on' : step > i + 1 ? ' done' : '')}>
            {i + 1} {s}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div class="form">
          <label class="drop">
            <input id="import-file" type="file" accept=".xlsx,.csv" onChange={(e) => pick(e.currentTarget.files?.[0])} />
            <b>{busy ? t('loading') : t('imp_pick')}</b>
            <span class="hint">{t('imp_pick_hint')}</span>
          </label>
          <div class="row">
            <button
              class="btn sm"
              type="button"
              onClick={() => downloadTemplate({ lang: app.project!.lang, projectKey: app.project!.key, users: app.users, sprints: app.sprints, items: app.items })}
            >
              {t('imp_template')}
            </button>
            <span class="hint">{t('imp_template_hint')}</span>
          </div>
          {recent.length > 0 && (
            <div>
              <div class="sec-h">{t('imp_recent')}</div>
              <div class="list">
                {recent.slice(0, 5).map((r) => (
                  <div class="list-row">
                    <span class="key">{fmtStamp(r.created_at, lang)}</span>
                    <span>{r.file_name ?? '—'}</span>
                    <span class="key">
                      +{r.rows_new} · ~{r.rows_updated} · {r.user_name}
                    </span>
                    <span class="sp">{r.undone ? <span class="tag">{t('imp_undone')}</span> : <button class="btn sm danger" onClick={() => undo(r.id)}>{t('imp_undo')}</button>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {err && <div class="err">{err}</div>}
        </div>
      )}

      {step === 2 && sheet && (
        <div class="form">
          <div class="row">
            <span class="mono">{file?.name}</span>
            {sheets.length > 1 && (
              <select id="import-sheet" class="select" style={{ width: 'auto' }} value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.currentTarget.value))}>
                {sheets.map((s, i) => (
                  <option value={i}>
                    {s.name} ({s.rows.length})
                  </option>
                ))}
              </select>
            )}
            <span class="key">
              {sheet.rows.length} {t('rows').toLowerCase()} · {t('imp_header_row')}
            </span>
          </div>
          <div class="grid-wrap">
            <table class="map">
              <thead>
                <tr>
                  <th>{t('imp_col')}</th>
                  <th>{t('imp_sample')}</th>
                  <th>{t('imp_field')}</th>
                </tr>
              </thead>
              <tbody>
                {sheet.headers.map((h, i) => (
                  <tr>
                    <td class="mono">{h || `#${i + 1}`}</td>
                    <td class="faint mono" style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sheet.rows.find((r) => r.cells[i])?.cells[i] ?? ''}
                    </td>
                    <td>
                      <select
                        class={'select' + (map[i] && dupes.includes(map[i]) ? ' bad' : '')}
                        value={map[i] ?? ''}
                        onChange={(e) => setMap(map.map((m, j) => (j === i ? (e.currentTarget.value as Field | '') : m)))}
                      >
                        <option value="">{t('imp_skip')}</option>
                        {FIELDS.map((f) => (
                          <option value={f}>{HEADERS[lang][f]}{f === 'note' ? ` → ${t('logbook')}` : ''}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!canPreview && <div class="err">{t('imp_need_title')}</div>}
          {dupes.length > 0 && <div class="err">{t('imp_dupes')}</div>}
          {err && <div class="err">{err}</div>}
        </div>
      )}

      {step === 3 && result && (
        <div class="form">
          <div class="row">
            <span class="tag on">+{result.new} {t('imp_new')}</span>
            <span class="tag">~{result.updated} {t('imp_updated')}</span>
            {result.warnings > 0 && <span class="tag warn">{result.warnings} {t('imp_warnings')}</span>}
            {result.errors > 0 && <span class="tag bad">{result.errors} {t('imp_errors')}</span>}
          </div>
          {result.applied ? <p class="muted" style={{ margin: 0 }}>{t('imp_done')}</p> : result.errors > 0 ? <p class="err" style={{ margin: 0 }}>{t('imp_fix')}</p> : <p class="muted" style={{ margin: 0 }}>{t('imp_ready')}</p>}
          {result.issues.length > 0 && (
            <div class="list" style={{ maxHeight: '280px', overflow: 'auto' }}>
              {result.issues.map((i) => (
                <div class="list-row">
                  <span class={'tag' + (i.level === 'error' ? ' bad' : ' warn')}>
                    {t('imp_row')} {i.row}
                  </span>
                  <span class="muted">{i.msg}</span>
                </div>
              ))}
            </div>
          )}
          {err && <div class="err">{err}</div>}
        </div>
      )}
    </Modal>
  );
}
