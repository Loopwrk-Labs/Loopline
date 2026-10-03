import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import wm from '../assets/wm.svg?raw';
import type { ItemType, Status, User } from '../api';
import { useT } from '../i18n';

export function Brand() {
  return (
    <span class="brand">
      <span dangerouslySetInnerHTML={{ __html: wm }} style={{ display: 'contents' }} />
      <span class="dot" />
      <em>Loopline</em>
    </span>
  );
}

const PATHS: Record<string, preact.JSX.Element> = {
  board: <g><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></g>,
  grid: <g><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 14h18M9 4v16" /></g>,
  epic: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  sprint: <g><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></g>,
  log: <g><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 8h8M8 12h8M8 16h5" /></g>,
  set: <g><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></g>,
  search: <g><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></g>,
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  out: <g><path d="M14 4h5v16h-5" /><path d="M10 8l-4 4 4 4M6 12h10" /></g>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Avatar({ user, lg }: { user: Pick<User, 'initials' | 'name'> | null; lg?: boolean }) {
  const { t } = useT();
  if (!user) return <span class={'av av-none' + (lg ? ' lg' : '')} title={t('unassigned')}>–</span>;
  return <span class={'av' + (lg ? ' lg' : '')} title={user.name}>{user.initials}</span>;
}

export function StatusLabel({ s }: { s: Status }) {
  const { t } = useT();
  return (
    <span class={'st ' + s}>
      <i />
      {t(`st_${s}` as never)}
    </span>
  );
}

export function TypeBadge({ type }: { type: ItemType }) {
  const { t } = useT();
  return <span class={'type ' + type} title={t(`ty_${type}` as never)}>{type[0].toUpperCase()}</span>;
}

/** Actual vs scope variance chip: >10% warn, >20% bad. */
export function VarChip({ scope, actual, show }: { scope: number | null; actual: number | null; show?: boolean }) {
  if (!scope || actual === null || actual === undefined) return <span class="faint">·</span>;
  const p = Math.round((actual / scope - 1) * 100);
  if (!show && actual <= scope) return <span class="faint">·</span>;
  const c = p > 20 ? 'b' : p > 10 ? 'w' : 'ok';
  return <span class={'var ' + c}>{(p > 0 ? '+' : '') + p}%</span>;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div class="veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
        <span class="corner tl" />
        <span class="corner br" />
        <div class="modal-h">
          <h3>{title}</h3>
          <button class="btn ghost sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div class="modal-b">{children}</div>
        {footer && <div class="modal-f">{footer}</div>}
      </div>
    </div>
  );
}
