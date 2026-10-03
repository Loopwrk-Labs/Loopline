import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { fmtDate, fmtNum, useT } from '../i18n';
import { useApp, userById } from '../state';
import { Avatar } from '../components/ui';

type M = {
  sprint: { id: string; name: string; status: string; start_date: string | null; end_date: string | null };
  committed_points: number; committed_items: number; done_points: number; done_items: number; say_do: number | null; cycle_median_days: number | null;
  capacity: number; planned_hours: number | null; actual_hours: number | null; billable_hours: number | null; load: number | null; utilization: number | null;
  billable_share: number | null; estimate_accuracy: number | null; waiting_share: number | null; scope_added_points: number; scope_added_items: number;
  carry_over: { key: string; title: string }[]; aging_wip: { key: string; title: string; days: number }[]; bugs: number; bug_ratio: number | null;
  people: { user_id: string; capacity: number; planned: number | null; actual: number | null; load: number | null; utilization: number | null }[];
};
type Resp = {
  current: M | null;
  trend: { name: string; id: string; status: string; done_points: number; say_do: number | null; cycle: number | null }[];
  averages: { done_points: number | null; say_do: number | null; cycle: number | null };
  sprints: { id: string; name: string; status: string }[];
};

function Mini({ vals, labels, type, fmt = '', min = 0 }: { vals: (number | null)[]; labels: string[]; type: 'bar' | 'line'; fmt?: string; min?: number }) {
  const n = vals.length;
  const nums = vals.filter((v): v is number => v !== null);
  const max = Math.max(1, ...nums) * 1.1;
  const lo = Math.min(min, ...nums);
  const L = 30, R = 292, T = 14, B = 100, step = (R - L) / Math.max(n, 1);
  const x = (i: number) => L + (i + 0.5) * step;
  const y = (v: number) => B - ((v - lo) / (max - lo || 1)) * (B - T);
  const ticks = [lo, (lo + max) / 2, max].map((v) => Math.round(v));
  const pts = vals.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  return (
    <svg viewBox="0 0 300 124" role="img">
      {ticks.map((v) => (
        <g>
          <line x1={L} x2={R} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--hair)' }} />
          <text x={L - 6} y={y(v) + 3} text-anchor="end" font-size="8.5" font-family="IBM Plex Mono,monospace" style={{ fill: 'var(--faint)' }}>
            {v}
            {fmt}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text x={x(i)} y={116} text-anchor="middle" font-size="8.5" font-family="IBM Plex Mono,monospace" style={{ fill: i === n - 1 ? 'var(--ink)' : 'var(--faint)' }}>
          {l.length > 9 ? l.slice(-9) : l}
        </text>
      ))}
      {type === 'bar'
        ? vals.map((v, i) => v !== null && <rect x={x(i) - step * 0.26} y={y(v)} width={step * 0.52} height={Math.max(0, B - y(v))} rx="1.5" style={{ fill: i === n - 1 ? 'var(--ink)' : 'var(--surface-3)' }} />)
        : pts && <polyline points={pts} fill="none" stroke-width="1.8" stroke-linejoin="round" style={{ stroke: 'var(--ink)' }} />}
      {type === 'line' && vals.map((v, i) => v !== null && <circle cx={x(i)} cy={y(v)} r={i === n - 1 ? 3.6 : 2} stroke-width="1.2" style={{ fill: i === n - 1 ? 'var(--ink)' : 'var(--surface)', stroke: 'var(--ink)' }} />)}
    </svg>
  );
}

export function Metrics() {
  const { project, users } = useApp();
  const { t, lang } = useT();
  const [sel, setSel] = useState('');
  const [d, setD] = useState<Resp | null>(null);

  useEffect(() => {
    api.get<Resp>(`/projects/${project!.id}/metrics${sel ? `?sprint=${sel}` : ''}`).then(setD).catch(() => setD(null));
  }, [project?.id, sel]);

  if (!d) return <div class="empty">{t('loading')}</div>;
  const m = d.current;
  if (!m) return <div class="empty"><h3>{t('metrics')}</h3>{t('metrics_none')}</div>;

  const delta = (v: number | null, avg: number | null, lowerBetter = false) => {
    if (v === null || avg === null) return null;
    const up = v >= avg;
    const good = lowerBetter ? !up : up;
    return <span class={'d ' + (good ? 'up' : 'dn')}>{(up ? '▲ ' : '▼ ') + t('vs_avg')} {fmtNum(avg, lang)}</span>;
  };
  const pct = (v: number | null) => (v === null ? '—' : fmtNum(v, lang));
  const totalPlanned = m.people.reduce((a, p) => a + (p.planned ?? 0), 0);
  const totalActual = m.people.reduce((a, p) => a + (p.actual ?? 0), 0);

  const signals: { sev: 'b' | '' | 'n'; title: string; text: string; val: string }[] = [];
  if (m.aging_wip.length) signals.push({ sev: 'b', title: t('sig_aging'), text: m.aging_wip.map((a) => `${a.key} (${a.days}d)`).join(', '), val: `${m.aging_wip.length}` });
  if (m.scope_added_items) signals.push({ sev: '', title: t('sig_scope_added'), text: `${m.scope_added_items} ${t('items_word')}`, val: `+${fmtNum(m.scope_added_points, lang)} pts` });
  if (m.carry_over.length) signals.push({ sev: 'b', title: t('sig_carry'), text: m.carry_over.map((c) => c.key).join(', '), val: `${m.carry_over.length}` });
  if (m.waiting_share !== null && m.waiting_share >= 25) signals.push({ sev: '', title: t('sig_waiting'), text: t('sig_waiting_text'), val: `${fmtNum(m.waiting_share, lang)}%` });
  if (m.bugs) signals.push({ sev: 'n', title: t('sig_bugs'), text: `${m.bugs} ${t('sig_bugs_text')}`, val: m.bug_ratio !== null ? fmtNum(m.bug_ratio, lang) : `${m.bugs}` });

  return (
    <>
      <div class="tb">
        <h2>
          {m.sprint.name} · {t('scorecard')}
        </h2>
        <span class="meta">
          {fmtDate(m.sprint.start_date)} → {fmtDate(m.sprint.end_date)} · {t(`sp_${m.sprint.status}` as never)}
        </span>
        <div class="row sp">
          <select id="metrics-sprint" class="select" value={sel || m.sprint.id} onChange={(e) => setSel(e.currentTarget.value)}>
            {d.sprints.map((s) => (
              <option value={s.id}>
                {s.name} · {t(`sp_${s.status}` as never)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div class="kpis">
        <div class={'kpi' + (m.load !== null && m.load > 105 ? ' warn' : '')}>
          <small>{t('m_load')}</small>
          <b>
            {pct(m.load)}
            <sub>%</sub>
          </b>
          <p>
            {fmtNum(m.planned_hours, lang)}h / {m.capacity ? fmtNum(m.capacity, lang) + 'h' : '—'}
          </p>
          {!m.capacity && <span class="d">{t('m_set_capacity')}</span>}
        </div>
        <div class="kpi">
          <small>Say / Do</small>
          <b>
            {pct(m.say_do)}
            <sub>%</sub>
          </b>
          <p>
            {fmtNum(m.done_points, lang)} / {fmtNum(m.committed_points, lang)} pts
          </p>
          {delta(m.say_do, d.averages.say_do)}
        </div>
        <div class="kpi">
          <small>Throughput</small>
          <b>
            {fmtNum(m.done_points, lang)}
            <sub>pts</sub>
          </b>
          <p>
            {m.done_items} {t('items_done')}
          </p>
          {delta(m.done_points, d.averages.done_points)}
        </div>
        <div class="kpi">
          <small>Cycle time</small>
          <b>
            {m.cycle_median_days !== null ? fmtNum(m.cycle_median_days, lang) : '—'}
            <sub>{t('days')}</sub>
          </b>
          <p>{t('m_cycle_hint')}</p>
          {delta(m.cycle_median_days, d.averages.cycle, true)}
        </div>
        <div class="kpi">
          <small>Utilization</small>
          <b>
            {pct(m.utilization)}
            <sub>%</sub>
          </b>
          <p>
            {fmtNum(m.actual_hours, lang)}h / {m.capacity ? fmtNum(m.capacity, lang) + 'h' : '—'}
          </p>
          <span class="d">{m.billable_share !== null ? `${fmtNum(m.billable_share, lang)}% ${t('billable_short')}` : ''}</span>
        </div>
        <div class={'kpi' + (m.estimate_accuracy !== null && Math.abs(m.estimate_accuracy) > 10 ? ' warn' : '')}>
          <small>{t('m_accuracy')}</small>
          <b>
            {m.estimate_accuracy !== null ? (m.estimate_accuracy > 0 ? '+' : '') + fmtNum(m.estimate_accuracy, lang) : '—'}
            <sub>%</sub>
          </b>
          <p>{t('m_accuracy_hint')}</p>
        </div>
      </div>

      <div class="trio">
        <div class="panel chart">
          <h5>
            Throughput · pts <em>{t('last_n')}</em>
          </h5>
          <Mini type="bar" vals={d.trend.map((x) => x.done_points)} labels={d.trend.map((x) => x.name.replace(/^Sprint\s*/i, 'S'))} />
        </div>
        <div class="panel chart">
          <h5>
            Say / Do <em>%</em>
          </h5>
          <Mini type="line" fmt="%" min={0} vals={d.trend.map((x) => x.say_do)} labels={d.trend.map((x) => x.name.replace(/^Sprint\s*/i, 'S'))} />
        </div>
        <div class="panel chart">
          <h5>
            Cycle time · {t('days')} <em>{t('lower_better')}</em>
          </h5>
          <Mini type="line" vals={d.trend.map((x) => x.cycle)} labels={d.trend.map((x) => x.name.replace(/^Sprint\s*/i, 'S'))} />
        </div>
      </div>

      <div class="dash">
        <div class="panel">
          <h5>
            {t('capacity')} <em>{t('capacity_hint')}</em>
          </h5>
          <table class="cap">
            <thead>
              <tr>
                <th>{t('f_assignee')}</th>
                <th>{t('capacity')}</th>
                <th>{t('planned')}</th>
                <th>Load</th>
                <th>{t('f_actual_short')}</th>
                <th>Util.</th>
              </tr>
            </thead>
            <tbody>
              {m.people.map((p) => {
                const u = userById(users, p.user_id);
                return (
                  <tr>
                    <td>
                      <span class="row" style={{ gap: '6px', flexWrap: 'nowrap' }}>
                        <Avatar user={u} />
                        {u?.name ?? '—'}
                      </span>
                    </td>
                    <td>{p.capacity ? fmtNum(p.capacity, lang) + 'h' : '—'}</td>
                    <td>{fmtNum(p.planned, lang)}h</td>
                    <td class={p.load !== null && p.load > 105 ? 'bad' : ''}>{p.load !== null ? `${fmtNum(p.load, lang)}%` : '—'}</td>
                    <td>{fmtNum(p.actual, lang)}h</td>
                    <td>{p.utilization !== null ? `${fmtNum(p.utilization, lang)}%` : '—'}</td>
                  </tr>
                );
              })}
              <tr class="tot">
                <td>{t('team')}</td>
                <td>{m.capacity ? fmtNum(m.capacity, lang) + 'h' : '—'}</td>
                <td>{fmtNum(totalPlanned, lang)}h</td>
                <td>{m.load !== null ? `${fmtNum(m.load, lang)}%` : '—'}</td>
                <td>{fmtNum(totalActual, lang)}h</td>
                <td>{m.utilization !== null ? `${fmtNum(m.utilization, lang)}%` : '—'}</td>
              </tr>
            </tbody>
          </table>
          <p class="hint">{t('m_people_note')}</p>
        </div>
        <div class="panel">
          <h5>
            {t('signals')} <em>{t('signals_hint')}</em>
          </h5>
          <div class="att">
            {signals.map((s) => (
              <div class="att-row" style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
                <span class={'sig ' + s.sev} />
                <span>
                  <b>{s.title}</b>
                  <br />
                  <span class="muted" style={{ fontSize: '.78rem' }}>{s.text}</span>
                </span>
                <span class="mono">{s.val}</span>
              </div>
            ))}
            {!signals.length && <span class="hint">{t('dash_all_good')}</span>}
          </div>
        </div>
      </div>
    </>
  );
}
