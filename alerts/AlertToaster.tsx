import React, { useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import type { AlertEvent } from '../../lib/alerts/types';
import { useTranslation } from '../../i18n/LanguageContext';

/**
 * Fired alerts, surfaced globally.
 *
 * With the Alerts page gone, this is how a firing becomes visible: a slide-in notice that
 * auto-dismisses, which is exactly the one notification pattern the animation rules allow
 * (§6: "Notifikasi slide-in dari atas + auto-dismiss"). Clicking one opens the module the alert
 * came from, so the alert stays a route into real data rather than a dead-end popup.
 */
const DISMISS_MS = 9_000;

export const AlertToaster: React.FC<{
  events: AlertEvent[];
  onDismiss: (event: AlertEvent) => void;
  onOpen: (route: string) => void;
}> = ({ events, onDismiss, onOpen }) => {
  const { t } = useTranslation();

  // One timer per event, keyed by its trigger time - a re-render must not restart the countdown
  // of a toast that is already half way through dismissing.
  useEffect(() => {
    if (events.length === 0) return undefined;
    const timers = events.map((event) => window.setTimeout(() => onDismiss(event), DISMISS_MS));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [events, onDismiss]);

  if (events.length === 0) return null;

  return (
    <div
      className="fixed z-[120] right-3 sm:right-4 flex flex-col gap-2 w-[min(340px,calc(100vw-1.5rem))]"
      style={{ top: 'calc(var(--hev-header-offset, 84px) + 0.75rem)' }}
      role="status"
      aria-live="polite"
    >
      {events.map((event) => (
        <div
          key={`${event.ruleId}-${event.triggeredAt}`}
          className="hev-toast-in bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-xl shadow-2xl p-3 font-mono"
          style={{
            borderLeftWidth: '3px',
            borderLeftColor: event.severity === 'critical' ? 'var(--color-down)' : 'var(--color-warn)',
          }}
        >
          <div className="flex items-start gap-2">
            <Bell className="w-3.5 h-3.5 text-[var(--color-warn)] shrink-0 mt-0.5" />
            <button
              type="button"
              onClick={() => {
                if (event.route) onOpen(event.route);
                onDismiss(event);
              }}
              className="flex-1 min-w-0 text-left cursor-pointer"
            >
              <span className="block text-[11px] font-bold text-[var(--text-primary)] leading-snug">
                {event.title}
              </span>
              <span className="block text-[10px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
                {event.detail}
              </span>
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-1">
                {event.source}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDismiss(event)}
              aria-label={t('shell.close')}
              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
