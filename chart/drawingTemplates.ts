// Drawing templates / style presets (Bagian J Tugas 5, 2026-09-01).
//
// A flat, un-scoped list of named {color, lineWidth} presets - deliberately NOT per-tool (every
// tool shares the same template list and the same single "current default"). A per-tool default
// table was considered and dropped: this app's drawings only vary along two style axes (color,
// line width - see DrawingObject in drawingTypes.ts, there's no dash/fill/font style to preset
// yet), so "save this look, switch between looks, one of them is the current default for new
// drawings" covers the real use case without inventing a matrix of tool x template state nobody
// asked for. Stored client-side (localStorage, same convention as saved chart layout/drawings
// elsewhere in this feature) - a per-viewer preference, not real trading data, so it's fine if a
// private window or cleared site data loses it.

export interface DrawingTemplate {
  id: string;
  name: string;
  color: string;
  lineWidth: number;
}

const TEMPLATES_STORAGE_KEY = 'hevora:chart:drawingTemplates';
const DEFAULT_TEMPLATE_ID_STORAGE_KEY = 'hevora:chart:drawingDefaultTemplateId';

function genTemplateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A hand-edited or stale-schema localStorage value is sanitized entry-by-entry (an entry missing
 *  a required field, or with the wrong types, is dropped) rather than trusted wholesale - same
 *  defensive pattern as loadChartLayout in LightweightChart.tsx. */
function loadTemplates(): DrawingTemplate[] {
  try {
    const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is DrawingTemplate =>
        t && typeof t === 'object' && typeof t.id === 'string' && typeof t.name === 'string' &&
        typeof t.color === 'string' && typeof t.lineWidth === 'number'
    );
  } catch {
    return [];
  }
}

function persistTemplates(templates: DrawingTemplate[]): void {
  try {
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // Storage unavailable/full/blocked - the template just won't survive a reload this session.
  }
}

function loadDefaultTemplateId(): string | null {
  try {
    return window.localStorage.getItem(DEFAULT_TEMPLATE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistDefaultTemplateId(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(DEFAULT_TEMPLATE_ID_STORAGE_KEY);
    else window.localStorage.setItem(DEFAULT_TEMPLATE_ID_STORAGE_KEY, id);
  } catch {
    // Same as above - non-fatal, just won't survive a reload.
  }
}

export { genTemplateId, loadTemplates, persistTemplates, loadDefaultTemplateId, persistDefaultTemplateId };
