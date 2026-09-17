import { Info, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { ClimateAlert } from '../lib/alerts';

export function PageHeader({ title, description, actions, icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-title">
        {icon && <span className="page-icon">{icon}</span>}
        <div>
          <h1>{title}</h1>
          {description && <p className="muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  unit,
  hint,
  tone = 'green',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: 'green' | 'blue' | 'red' | 'amber' | 'teal' | 'gray' | 'orange';
}) {
  return (
    <div className={`card stat-card tone-${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <span className="stat-value">
          {value}
          {unit && value !== '—' && <small>{unit}</small>}
        </span>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel = 'Eliminar', danger = true, onConfirm, onClose }: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function AlertItem({ alert, compact }: { alert: ClimateAlert; compact?: boolean }) {
  const Icon = alert.level === 'danger' ? OctagonAlert : alert.level === 'warning' ? TriangleAlert : Info;
  return (
    <div className={`alert-item level-${alert.level} ${compact ? 'compact' : ''}`}>
      <Icon size={18} className="alert-icon" />
      <div>
        <strong>{alert.level === 'info' ? '' : '⚠️ '}{alert.title}</strong>
        <span>{alert.detail}</span>
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, error, hint, children, required }: { label: string; htmlFor?: string; error?: string; hint?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden> *</span>}
      </label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div className={`segmented ${size === 'sm' ? 'seg-sm' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
