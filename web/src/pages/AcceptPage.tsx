import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { dicts } from '../i18n';
import { Brand } from '../components/ui';
import { ApprovalDoc, type PublicApproval } from '../components/ApprovalDoc';

/** Public page a client opens from the link: review, then accept or request changes. No account needed. */
export function AcceptPage({ token }: { token: string }) {
  const [a, setA] = useState<PublicApproval | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<PublicApproval>(`/public/approval/${encodeURIComponent(token)}`)
      .then((x) => {
        setA(x);
        document.documentElement.lang = x.lang === 'sr' ? 'sr-Latn' : 'en';
        document.title = `${x.key} · ${x.project_name}`;
      })
      .catch((x) => setErr(x instanceof ApiError ? x.message : 'Network error.'));
  }, [token]);

  if (err && !a) {
    return (
      <div class="pub">
        <Brand />
        <p class="err" style={{ marginTop: '24px' }}>{err}</p>
      </div>
    );
  }
  if (!a) return <div class="auth faint mono">…</div>;
  const t = (k: keyof (typeof dicts)['en']) => dicts[a.lang][k];

  const decide = async (decision: 'accept' | 'reject') => {
    setBusy(true);
    setErr('');
    try {
      setA(await api.post<PublicApproval>(`/public/approval/${encodeURIComponent(token)}/decide`, { decision, name, email, note }));
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="pub">
      <div class="head">
        <Brand />
        <span class="stamp">{a.kind === 'change_request' ? t('ap_cr') : t('ap_acceptance')}</span>
      </div>
      <ApprovalDoc a={a} />
      {a.status === 'sent' && (
        <div class="panel no-print" style={{ marginTop: '20px' }}>
          <h3>{t('ap_your_decision')}</h3>
          <div class="form">
            <div class="two">
              <label class="field">
                <span class="label">{t('ap_full_name')}</span>
                <input id="acc-name" class="input" autocomplete="name" value={name} onInput={(e) => setName(e.currentTarget.value)} />
              </label>
              <label class="field">
                <span class="label">{t('email')}</span>
                <input id="acc-email" class="input" type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
              </label>
            </div>
            <label class="field">
              <span class="label">{t('ap_comment')}</span>
              <textarea id="acc-note" class="textarea" style={{ minHeight: '80px' }} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
              <span class="hint">{t('ap_comment_hint')}</span>
            </label>
            <label class="chk">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.currentTarget.checked)} />
              {t('ap_agree')}
            </label>
            {err && <div class="err">{err}</div>}
            <div class="row">
              <button class="btn solid" disabled={busy || !agree || !name.trim() || !email.includes('@')} onClick={() => decide('accept')}>
                {a.kind === 'change_request' ? t('ap_approve') : t('ap_accept')}
              </button>
              <button class="btn" disabled={busy || !name.trim() || !email.includes('@') || !note.trim()} onClick={() => decide('reject')}>
                {t('ap_request_changes')}
              </button>
            </div>
            <p class="hint" style={{ margin: 0 }}>{t('ap_record_note')}</p>
          </div>
        </div>
      )}
      {(a.status === 'accepted' || a.status === 'rejected') && (
        <div class="row no-print" style={{ marginTop: '16px' }}>
          <button class="btn" onClick={() => window.print()}>{t('ap_print')}</button>
          <span class="hint">{t('ap_thanks')}</span>
        </div>
      )}
    </div>
  );
}
