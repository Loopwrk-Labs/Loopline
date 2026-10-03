import { useEffect, useState } from 'preact/hooks';
import { api, type LogEntry } from '../api';
import { useT } from '../i18n';
import { useApp } from '../state';
import { Entry } from '../components/LogEntry';

export function Feed() {
  const { project } = useApp();
  const { t } = useT();
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [more, setMore] = useState(false);

  const load = async (before?: number) => {
    const r = await api.get<LogEntry[]>(`/projects/${project!.id}/logbook?limit=100${before ? `&before=${before}` : ''}`);
    setRows((x) => (before ? [...x, ...r] : r));
    setMore(r.length === 100);
  };
  useEffect(() => {
    load();
  }, [project?.id]);

  return (
    <div style={{ maxWidth: '900px' }}>
      <div class="tb">
        <h2>{t('feed_title')}</h2>
        <span class="meta">{t('feed_lede')}</span>
      </div>
      <div class="panel" style={{ padding: '4px 16px' }}>
        {rows.length === 0 && <div class="empty">{t('empty_col')}</div>}
        {rows.map((e) => (
          <Entry e={e} showItem={(k) => `#/p/${project!.key}/i/${k}`} />
        ))}
      </div>
      {more && (
        <div class="row" style={{ marginTop: '12px' }}>
          <button class="btn" onClick={() => load(rows[rows.length - 1].created_at)}>
            {t('load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
