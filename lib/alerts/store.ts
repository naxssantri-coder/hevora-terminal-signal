import { useCallback, useEffect, useState } from 'react';
import type { AlertEvent, AlertKind, AlertRule } from './types';

/**
 * Alert rules and their firing history, stored per device.
 *
 * Rules are the user's own configuration, so they live in localStorage like the watchlist and the
 * journal - no server schema, and nothing about them leaves the browser.
 */
const RULES_KEY = 'hev_alert_rules';
const EVENTS_KEY = 'hev_alert_events';
const CHANGE_EVENT = 'hev:alerts-change';
const MAX_EVENTS = 100;

const read = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

export const useAlerts = () => {
  const [rules, setRules] = useState<AlertRule[]>(() => read<AlertRule[]>(RULES_KEY, []));
  const [events, setEvents] = useState<AlertEvent[]>(() => read<AlertEvent[]>(EVENTS_KEY, []));

  useEffect(() => {
    const sync = () => {
      setRules(read<AlertRule[]>(RULES_KEY, []));
      setEvents(read<AlertEvent[]>(EVENTS_KEY, []));
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const addRule = useCallback(
    (kind: AlertKind, subject: string, comparator: AlertRule['comparator'], threshold: number | undefined, ownerModuleId: string) => {
      const rule: AlertRule = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        subject,
        comparator,
        threshold,
        ownerModuleId,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      write(RULES_KEY, [...read<AlertRule[]>(RULES_KEY, []), rule]);
      return rule;
    },
    []
  );

  const toggleRule = useCallback((id: string) => {
    write(
      RULES_KEY,
      read<AlertRule[]>(RULES_KEY, []).map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule))
    );
  }, []);

  const removeRule = useCallback((id: string) => {
    write(RULES_KEY, read<AlertRule[]>(RULES_KEY, []).filter((rule) => rule.id !== id));
  }, []);

  const recordEvents = useCallback((incoming: AlertEvent[]) => {
    if (incoming.length === 0) return;
    const existing = read<AlertEvent[]>(EVENTS_KEY, []);
    write(EVENTS_KEY, [...incoming, ...existing].slice(0, MAX_EVENTS));
  }, []);

  const clearEvents = useCallback(() => write(EVENTS_KEY, []), []);

  return { rules, events, addRule, toggleRule, removeRule, recordEvents, clearEvents };
};

export const readRules = (): AlertRule[] => read<AlertRule[]>(RULES_KEY, []);
export const readEvents = (): AlertEvent[] => read<AlertEvent[]>(EVENTS_KEY, []);
