import { useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { Brand } from '../components/ui';

function Card({ title, lede, children }: { title: string; lede: string; children: preact.ComponentChildren }) {
  return (
    <div class="auth">
      <div class="auth-card">
        <span class="corner tl" />
        <span class="corner br" />
        <Brand />
        <h1>{title}</h1>
        <p class="lede">{lede}</p>
        {children}
      </div>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

export function Login({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit(async () => {
    await api.post('/auth/login', { email, password });
    onDone();
  });
  return (
    <Card title={t('signin')} lede={t('signin_lede')}>
      <form class="form" onSubmit={s.run}>
        <label class="field">
          <span class="label">{t('email')}</span>
          <input id="login-email" class="input" type="email" autocomplete="username" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="label">{t('password')}</span>
          <input id="login-pw" class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        {s.err && <div class="err">{s.err}</div>}
        <button class="btn solid" disabled={s.busy}>{t('signin')}</button>
      </form>
    </Card>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setCode] = useState('');
  const s = useSubmit(async () => {
    await api.post('/setup', { email, name, password, setupCode });
    onDone();
  });
  return (
    <Card title={t('setup_title')} lede={t('setup_lede')}>
      <form class="form" onSubmit={s.run}>
        <label class="field">
          <span class="label">{t('name')}</span>
          <input id="setup-name" class="input" required value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="label">{t('email')}</span>
          <input id="setup-email" class="input" type="email" autocomplete="username" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="label">{t('password')}</span>
          <input id="setup-pw" class="input" type="password" autocomplete="new-password" minLength={12} required value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
          <span class="hint">{t('pw_rule')}</span>
        </label>
        <label class="field">
          <span class="label">{t('setup_code')}</span>
          <input id="setup-code" class="input mono" required autocomplete="off" value={setupCode} onInput={(e) => setCode(e.currentTarget.value)} />
        </label>
        {s.err && <div class="err">{s.err}</div>}
        <button class="btn solid" disabled={s.busy}>{t('setup_btn')}</button>
      </form>
    </Card>
  );
}

export function ChangePassword({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const s = useSubmit(async () => {
    await api.post('/me/password', { current, next });
    setCurrent('');
    setNext('');
    onDone();
  });
  const form = (
    <form class="form" onSubmit={s.run}>
      <label class="field">
        <span class="label">{t('current_pw')}</span>
        <input id="pw-current" class="input" type="password" autocomplete="current-password" required value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="label">{t('new_pw')}</span>
        <input id="pw-next" class="input" type="password" autocomplete="new-password" minLength={12} required value={next} onInput={(e) => setNext(e.currentTarget.value)} />
        <span class="hint">{t('pw_rule')}</span>
      </label>
      {s.err && <div class="err">{s.err}</div>}
      <div class="row">
        <button class="btn solid" disabled={s.busy}>{t('change_pw')}</button>
      </div>
    </form>
  );
  if (!forced) return form;
  return (
    <Card title={t('change_pw_title')} lede={t('change_pw_lede')}>
      {form}
    </Card>
  );
}
