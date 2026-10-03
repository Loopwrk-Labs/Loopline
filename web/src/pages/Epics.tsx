import { useState } from 'preact/hooks';
import { fmtNum, useT } from '../i18n';
import { useApp } from '../state';
import { Icon, StatusLabel, VarChip } from '../components/ui';
import { NewItemModal } from '../components/fields';
import { rolled } from '../hours';

export function Epics() {
  const app = useApp();
  const { t, lang } = useT();
  const { project, items } = app;
  const [modal, setModal] = useState(false);
  const epics = items.filter((i) => i.type === 'epic');

  return (
    <>
      <div class="tb">
        <h2>{t('epics')}</h2>
        <span class="meta">{epics.length}</span>
        <div class="row sp">
          <button class="btn solid" onClick={() => setModal(true)}>
            <Icon name="plus" />
            {t('ty_epic')}
          </button>
        </div>
      </div>
      {epics.length === 0 ? (
        <div class="empty">{t('empty_col')}</div>
      ) : (
        <div class="list">
          {epics.map((e) => {
            const kids = items.filter((i) => i.parent_id === e.id);
            const done = kids.filter((k) => k.status === 'done').length;
            const pts = kids.reduce((a, k) => a + (k.points ?? 0), 0);
            const ptsDone = kids.filter((k) => k.status === 'done').reduce((a, k) => a + (k.points ?? 0), 0);
            const h = rolled(items, e);
            const pct = pts ? Math.round((ptsDone / pts) * 100) : kids.length ? Math.round((done / kids.length) * 100) : 0;
            return (
              <div class="list-row">
                <span class="key">{e.key}</span>
                <a class="main-t" href={`#/p/${project!.key}/i/${e.key}`} style={{ textDecoration: 'none' }}>
                  {e.title}
                </a>
                <StatusLabel s={e.status} />
                <span class="sp">
                  <span class="key">
                    {done}/{kids.length} · {fmtNum(ptsDone, lang)}/{fmtNum(pts, lang)} pts
                  </span>
                  <span class="progress" title={`${pct}%`}>
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <span class="key" style={{ minWidth: '34px', textAlign: 'right' }}>{pct}%</span>
                  <span class="key">
                    {fmtNum(h.actual ?? 0, lang)}/{fmtNum(h.scope, lang)}h
                  </span>
                  <VarChip scope={h.scope} actual={h.actual} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {modal && <NewItemModal onClose={() => setModal(false)} defaults={{ type: 'epic' }} />}
    </>
  );
}
