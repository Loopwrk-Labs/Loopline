import { dicts, fmtNum, fmtStamp, type Lang } from '../i18n';

export type Approval = {
  id: string; kind: 'acceptance' | 'change_request'; key: string; item_id: string | null; item_key?: string | null; title: string; body: string;
  impact_hours: number | null; impact_cost: number | null; impact_days: number | null; currency: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'withdrawn'; sent_at: number | null; content_sha256: string | null;
  client_name: string | null; client_email: string | null; decided_at: number | null; decided_ip?: string | null; decision_note: string | null;
};
export type PublicApproval = Omit<Approval, 'id' | 'item_id'> & { project_name: string; project_client: string | null; lang: Lang };

/** The client-facing document, always in the project's language. */
export function ApprovalDoc({ a }: { a: Omit<PublicApproval, never> & Partial<Approval> }) {
  const t = (k: keyof (typeof dicts)['en']) => dicts[a.lang][k];
  const isCR = a.kind === 'change_request';
  return (
    <div class="pub-doc">
      <div class="stamp">
        {isCR ? t('ap_cr') : t('ap_acceptance')} · {a.key}
      </div>
      <h2 style={{ fontSize: '1.35rem', fontWeight: 900, margin: '6px 0 2px' }}>{a.title}</h2>
      <div class="muted" style={{ fontSize: '.86rem', marginBottom: '14px' }}>
        {a.project_name}
        {a.project_client ? ` · ${a.project_client}` : ''}
        {a.sent_at ? ` · ${t('ap_sent_on')} ${fmtStamp(a.sent_at, a.lang)}` : ''}
      </div>
      <div class="doc">
        <span class="corner tl" />
        <span class="corner br" />
        <div class="pre">{a.body || '—'}</div>
        {isCR && (a.impact_hours || a.impact_days || a.impact_cost) ? (
          <div class="impact">
            {a.impact_hours ? (
              <div>
                <span class="label">{t('ap_impact_hours')}</span>
                <b>+{fmtNum(a.impact_hours, a.lang)} h</b>
              </div>
            ) : null}
            {a.impact_days ? (
              <div>
                <span class="label">{t('ap_impact_days')}</span>
                <b>+{fmtNum(a.impact_days, a.lang)}</b>
              </div>
            ) : null}
            {a.impact_cost ? (
              <div>
                <span class="label">{t('ap_impact_cost')}</span>
                <b>
                  {fmtNum(a.impact_cost, a.lang)} {a.currency ?? ''}
                </b>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {(a.status === 'accepted' || a.status === 'rejected') && (
        <div class={'decided' + (a.status === 'rejected' ? ' rej' : '')}>
          <b>{a.status === 'accepted' ? t('ap_accepted') : t('ap_rejected')}</b>
          <div class="muted" style={{ fontSize: '.86rem', marginTop: '4px' }}>
            {a.client_name} · {a.client_email} · {a.decided_at ? fmtStamp(a.decided_at, a.lang) : ''}
            {a.decided_ip ? ` · IP ${a.decided_ip}` : ''}
          </div>
          {a.decision_note && <div class="pre" style={{ marginTop: '8px' }}>{a.decision_note}</div>}
        </div>
      )}
      {a.status === 'withdrawn' && <div class="decided rej"><b>{t('ap_withdrawn')}</b></div>}
      {a.content_sha256 && (
        <div class="hash">
          {t('ap_fingerprint')}: SHA-256 {a.content_sha256}
        </div>
      )}
    </div>
  );
}
