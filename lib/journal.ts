import { useCallback, useEffect, useState } from 'react';

/**
 * Trading journal entries, keyed to the id of a real closed signal from /api/history.
 *
 * Notes are the user's own words about trades that actually happened - the journal never creates
 * a trade, and an entry whose signal is no longer in history simply stops being shown rather than
 * rendering as a trade with no record behind it.
 */

export interface JournalEntry {
  recordId: string;
  note: string;
  /** Self-assessment of execution, 1-5. Optional - the note alone is a valid entry. */
  rating?: number;
  tags?: string[];
  updatedAt: string;
}

const STORAGE_KEY = 'hev_journal';
const CHANGE_EVENT = 'hev:journal-change';

const readStorage = (): Record<string, JournalEntry> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, JournalEntry>) : {};
  } catch {
    return {};
  }
};

const writeStorage = (entries: Record<string, JournalEntry>): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private mode / quota.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

export const useJournal = () => {
  const [entries, setEntries] = useState<Record<string, JournalEntry>>(() => readStorage());

  useEffect(() => {
    const sync = () => setEntries(readStorage());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const save = useCallback((recordId: string, note: string, rating?: number, tags?: string[]) => {
    const current = readStorage();
    const trimmed = note.trim();

    // An emptied note with no rating removes the entry outright - keeping a blank shell would make
    // the "journalled" count wrong.
    if (!trimmed && rating === undefined) {
      delete current[recordId];
    } else {
      current[recordId] = { recordId, note: trimmed, rating, tags, updatedAt: new Date().toISOString() };
    }
    writeStorage(current);
  }, []);

  const remove = useCallback((recordId: string) => {
    const current = readStorage();
    delete current[recordId];
    writeStorage(current);
  }, []);

  return { entries, save, remove, count: Object.keys(entries).length };
};
