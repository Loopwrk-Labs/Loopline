import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, type Capacity, type Item } from '../api';
import { fmtDate, fmtNum, useT } from '../i18n';
import { useApp, userById } from '../state';
import { Avatar, TypeBadge } from '../components/ui';
import { isLate, isLeaf } from '../hours';

const DAY = 86400_000;
const dayStart = (iso: string) => Date.parse(iso + 'T00:00:00');

function Burndown({ start, end, total, items, lang }: { start: string; end: string; total: number; items: Item[]; lang: 'sr' | 'en' }) {
  const days = Math.max(1, Math.round((dayStart(end) - dayStart(start)) / DAY));
  const today = Math.min(days, Math.max(0, Math.floor((Date.now() - dayStart(start)) / DAY)));
  const max = Math.max(total, 1);
  const W = 540, H = 230, L = 40, R = 520, T = 16, B = 196;
  const x = (d: number) => L + (d / days) * (R - L);
  const y = (v: number) => B - (v / max) * (B - T);
  const remaining: number[] = [];
  for (let d = 0; d <= today; d++) {
    const cut = dayStart(start) + (d + 1) * DAY;
    const done = items.filter((i) => i.status === 'done' && i.done_at && i.done_at < cut).reduce((a, i) => a + (i.points ?? 0), 0);
    remaining.push(Math.max(0, total - done));
  }
  const pts = remaining.map((v, d) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const step = days > 14 ? Math.ceil(days / 10) : 1;
  const last = remaining[remaining.length - 1] ?? total;
  const ideal = total - (total * today) / days;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burndown ${last}/${total}`}>
      {[...new Set(ticks)].map((v) => (
        <g>
          <line x1={L} x2={R} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--hair)' }} />
          <text x={L - 6} y={y(v) + 3} text-anchor="end" font-size="9" font-family="IBM Plex Mono,monospace" style={{ fill: 'var(--faint)' }}>{v}</text>
        </g>
      ))}
      {Array.from({ length: days + 1 }, (_, d) => d)
        .filter((d) => d % step === 0 || d === days)
        .map((d) => (
          <text x={x(d)} y={B + 16} text-anchor="middle" font-size="9" font-family="IBM Plex Mono,monospace" style={{ fill: d === today ? 'var(--ink)' : 'var(--faint)' }}>
            D{d}
          </text>
        ))}
      <line x1={x(0)} y1={y(total)} x2={x(days)} y2={y(0)} stroke-dasharray="4 4" stroke-width="1.2" style={{ stroke: 'var(--faint)' }} />
      {remaining.length > 1 && <polygon points={`${x(0)},${B} ${pts} ${x(remaining.length - 1)},${B}`} style={{ fill: 'var(--glass-strong)' }} />}
      <polyline points={pts} fill="none" stroke-width="2" stroke-linejoin="round" style={{ stroke: 'var(--ink)' }} />
      <circle cx={x(today)} cy={y(last)} r="4" style={{ fill: 'var(--ink)' }} />
      <text x={Math.min(x(today) + 8, R - 70)} y={y(last) - 8} font-size="10" font-family="IBM Plex Mono,monospace" style={{ fill: 'var(--ink)' }}>
        {fmtNum(last, lang)} pts
      </text>
      {last - ideal !== 0 && (
        <text x={Math.min(x(today) + 8, R - 70)} y={y(last) + 8} font-size="9" font-family="IBM Plex Mono,monospace" style={{ fill: last > ideal ? 'var(--warn)' : 'var(--ok)' }}>
          {last > ideal ? '+' : ''}
          {fmtNum(Math.round((last - ideal) * 10) / 10, lang)} vs ideal
        </text>
      )}
    </svg>
  );
}

export function Dashboard() {
  const app = useApp();
  const { t, lang } = useT();
  const { project, items, sprints, users } = app;
  const active = sprints.find((s) => s.status === 'active') ?? null;
  const [cap, setCap] = useState<Capacity[]>([]);
  useEffect(() => {
    if (active) api.get<Capacity[]>(`/sprints/${active.id}/capacity`).then(setCap).catch(() => setCap([]));
    else setCap([]);
  }, [active?.id]);

  const inScope = useMemo(() => (active ? items.filter((i) => i.sprint_id === active.id) : items.filter((i) => i.type !== 'epic' && i.status !== 'done')), [items, active?.id]);
  const work = inScope.filter((i) => i.type === 'story' || i.type === 'bug');
  const leaves = inScope.filter((i) => isLeaf(items, i));
  const totalPts = work.reduce((a, i) => a + (i.points ?? 0), 0);
  const committed = active?.committed_points ?? totalPts;
  const donePts = work.filter((i) => i.status === 'done').reduce((a, i) => a + (i.points ?? 0), 0);
  const review = work.filter((i) => i.status === 'in_review');
  const reviewOld = review.filter((i) => Date.now() - i.updated_at > DAY);
  const blocked = inScope.filter((i) => i.status === 'blocked');
  const scope = leaves.reduce((a, i) => a + (i.scope_hours ?? 0), 0);
  const actual = leaves.reduce((a, i) => a + (i.actual_hours ?? 0), 0);
  const billable = leaves.filter((i) => i.billable).reduce((a, i) => a + (i.actual_hours ?? 0), 0);
  const days = active?.start_date && active.end_date ? Math.max(1, Math.round((dayStart(active.end_date) - dayStart(active.start_date)) / DAY)) : null;
  const dayNo = active?.start_date ? Math.max(0, Math.min(days ?? 0, Math.floor((Date.now() - dayStart(active.start_date)) / DAY))) : null;

  const people = users
    .filter((u) => u.active)
    .map((u) => {
      const mine = leaves.filter((i) => i.assignee_id === u.id);
      const planned = mine.reduce((a, i) => a + (i.scope_hours ?? 0), 0);
      const c = cap.find((x) => x.user_id === u.id)?.hours ?? 0;
      const doneMine = mine.filter((i) => i.status === 'done' && i.scope_hours);
      const s = doneMine.reduce((a, i) => a + (i.scope_baseline ?? i.scope_hours ?? 0), 0);
      const ac = doneMine.reduce((a, i) => a + (i.actual_hours ?? 0), 0);
      return { u, planned, cap: c, accScope: s, accActual: ac };
    })
    .filter((p) => p.planned || p.cap || p.accScope);
  const unassignedH = leaves.filter((i) => !i.assignee_id).reduce((a, i) => a + (i.scope_hours ?? 0), 0);
  const capMax = Math.max(1, ...people.map((p) => Math.max(p.planned, p.cap)));

  const epics = items
    .filter((i) => i.type === 'epic' && i.status !== 'done')
    .map((e) => {
      const kids = items.filter((i) => i.parent_id === e.id);
      const w = (f: (i: Item) => boolean) => kids.filter(f).reduce((a, i) => a + (i.points ?? 1), 0);
      const tot = kids.reduce((a, i) => a + (i.points ?? 1), 0) || 1;
      return { e, d: (w((i) => i.status === 'done') / tot) * 100, r: (w((i) => i.status === 'in_review') / tot) * 100, p: (w((i) => i.status === 'in_progress') / tot) * 100, n: kids.length };
    })
    .filter((x) => x.n)
    .slice(0, 8);

  const today = new Date().toISOString().slice(0, 10);
  type Att = { it: Item; why: string; bad: boolean };
  const att: Att[] = [];
  for (const it of inScope) {
    if (it.type === 'epic') continue;
    if (it.status === 'blocked') att.push({ it, why: t('att_blocked'), bad: true });
    else if (isLate(it)) att.push({ it, why: `${t('att_overdue')} ${fmtDate(it.due_date)}`, bad: true });
    else if (it.due_date === today && it.status !== 'done') att.push({ it, why: t('att_due_today'), bad: false });
    else if (it.status === 'in_review' && Date.now() - it.updated_at > DAY) att.push({ it, why: t('att_review_wait'), bad: false });
    else if (!it.assignee_id && it.status !== 'done' && active) att.push({ it, why: t('att_no_owner'), bad: false });
    else if (it.scope_hours && it.actual_hours && it.actual_hours / it.scope_hours > 1.2) att.push({ it, why: `${t('att_over')} +${Math.round((it.actual_hours / it.scope_hours - 1) * 100)}%`, bad: false });
  }
  att.sort((a, b) => Number(b.bad) - Number(a.bad));

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const hVar = scope && actual ? Math.round((actual / scope - 1) * 100) : null;

  return (
    <>
      <div class="tb">
        <h2>{active ? active.name : t('open_work')}</h2>
        <span class="meta">{active ? `${fmtDate(active.start_date)} → ${fmtDate(active.end_date)}${active.goal ? ' · ' + active.goal : ''}` : t('dash_no_sprint')}</span>
      </div>
      <div class="kpis">
        <div class="kpi">
          <small>{active ? active.name : t('sprints')}</small>
          <b>
            {dayNo ?? '—'}
            <sub>/ {days ?? '—'} {t('days')}</sub>
          </b>
          <p>{active ? `${fmtDate(active.start_date)} → ${fmtDate(active.end_date)}` : t('dash_no_sprint')}</p>
        </div>
        <div class="kpi">
          <small>{t('st_done')}</small>
          <b>
            {fmtNum(donePts, lang)}
            <sub>/ {fmtNum(committed, lang)} pts</sub>
          </b>
          <p>{pct(donePts, committed)}%</p>
        </div>
        <div class={'kpi' + (reviewOld.length ? ' warn' : '')}>
          <small>{t('st_in_review')}</small>
          <b>
            {fmtNum(review.reduce((a, i) => a + (i.points ?? 0), 0), lang)}
            <sub>pts</sub>
          </b>
          <p>
            {review.length} · {reviewOld.length} &gt; 24h
          </p>
        </div>
        <div class={'kpi' + (blocked.length ? ' alert' : '')}>
          <small>{t('st_blocked')}</small>
          <b>{blocked.length}</b>
          <p>{blocked.slice(0, 3).map((i) => i.key).join(', ') || '—'}</p>
        </div>
        <div class={'kpi' + (hVar !== null && hVar > 10 ? ' warn' : '')}>
          <small>{t('kpi_hours')}</small>
          <b>
            {fmtNum(actual, lang)}
            <sub>/ {fmtNum(scope, lang)} h</sub>
          </b>
          <p>
            {hVar !== null ? `${hVar > 0 ? '+' : ''}${hVar}% · ` : ''}
            {fmtNum(billable, lang)}h {t('billable_short')}
          </p>
        </div>
      </div>

      <div class="dash">
        <div class="panel chart">
          <h5>
            Burndown · story points
            <span class="legend">
              <span>
                <i />
                actual
              </span>
              <span>
                <i class="dash" />
                ideal
              </span>
            </span>
          </h5>
          {active?.start_date && active.end_date ? (
            <Burndown start={active.start_date} end={active.end_date} total={totalPts} items={work} lang={lang} />
          ) : (
            <div class="empty">{t('dash_need_dates')}</div>
          )}
        </div>
        <div class="panel">
          <h5>
            {t('dash_workload')} <em>{t('dash_hours_vs_cap')}</em>
          </h5>
          <div class="bars">
            {people.map((p) => {
              const over = p.cap > 0 && p.planned > p.cap;
              return (
                <div class="bar-row">
                  <span class="who">
                    <Avatar user={p.u} />
                    {p.u.name}
                  </span>
                  <span class="track">
                    <span class={'f' + (over ? ' bad' : '')} style={{ width: `${(Math.min(p.planned, capMax) / capMax) * 100}%` }} />
                    {p.cap > 0 && <span class="cap" style={{ left: `${(p.cap / capMax) * 100}%` }} />}
                  </span>
                  <span class={'num-r' + (over ? ' bad' : '')}>
                    {fmtNum(p.planned, lang)} / {p.cap ? fmtNum(p.cap, lang) : '—'}h
                  </span>
                </div>
              );
            })}
            {unassignedH > 0 && (
              <div class="bar-row">
                <span class="who">
                  <Avatar user={null} />
                  {t('unassigned')}
                </span>
                <span class="track">
                  <span class="f" style={{ width: `${(Math.min(unassignedH, capMax) / capMax) * 100}%`, opacity: 0.5 }} />
                </span>
                <span class="num-r">{fmtNum(unassignedH, lang)}h</span>
              </div>
            )}
            {!people.length && !unassignedH && <span class="hint">{t('dash_no_cap')}</span>}
          </div>
          <h5 style={{ marginTop: '16px' }}>
            {t('dash_epics')}
            <span class="legend">
              <span>
                <i style={{ borderColor: 'var(--ok)' }} />
                {t('st_done')}
              </span>
              <span>
                <i style={{ borderColor: 'var(--warn)' }} />
                {t('st_in_review')}
              </span>
              <span>
                <i />
                {t('st_in_progress')}
              </span>
            </span>
          </h5>
          <div class="bars">
            {epics.map(({ e, d, r, p }) => (
              <div class="bar-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 130px 40px' }}>
                <a class="who" href={`#/p/${project!.key}/i/${e.key}`} style={{ textDecoration: 'none' }}>
                  <span class="key">{e.key}</span>
                  {e.title}
                </a>
                <span class="seg-bar">
                  <span class="d" style={{ width: `${d}%` }} />
                  <span class="r" style={{ width: `${r}%` }} />
                  <span class="p" style={{ width: `${p}%` }} />
                </span>
                <span class="num-r">{Math.round(d)}%</span>
              </div>
            ))}
            {!epics.length && <span class="hint">—</span>}
          </div>
        </div>
        <div class="panel">
          <h5>
            {t('dash_attention')} <em>{att.length}</em>
          </h5>
          <div class="att">
            {att.slice(0, 10).map(({ it, why, bad }) => (
              <div class="att-row">
                <TypeBadge type={it.type} />
                <a href={`#/p/${project!.key}/i/${it.key}`}>
                  <span class="key">{it.key}</span> {it.title}
                </a>
                <span class={'why' + (bad ? ' b' : '')}>{why}</span>
                <Avatar user={userById(users, it.assignee_id)} />
              </div>
            ))}
            {!att.length && <span class="hint">{t('dash_all_good')}</span>}
          </div>
        </div>
        <div class="panel">
          <h5>
            {t('dash_accuracy')} <em>{t('dash_done_items')}</em>
          </h5>
          <table class="cap">
            <thead>
              <tr>
                <th>{t('f_assignee')}</th>
                <th>{t('f_scope_short')}</th>
                <th>{t('f_actual_short')}</th>
                <th>{t('f_var')}</th>
              </tr>
            </thead>
            <tbody>
              {people
                .filter((p) => p.accScope)
                .map((p) => {
                  const v = Math.round((p.accActual / p.accScope - 1) * 100);
                  return (
                    <tr>
                      <td>{p.u.name}</td>
                      <td>{fmtNum(p.accScope, lang)}h</td>
                      <td>{fmtNum(p.accActual, lang)}h</td>
                      <td>
                        <span class={'var ' + (v > 20 ? 'b' : v > 10 ? 'w' : 'ok')}>
                          {v > 0 ? '+' : ''}
                          {v}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {!people.some((p) => p.accScope) && <span class="hint">{t('dash_no_done')}</span>}
        </div>
      </div>
    </>
  );
}
