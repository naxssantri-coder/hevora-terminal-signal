import { useCallback, useMemo, useState } from 'react';
import {
  DrawingTemplate,
  genTemplateId,
  loadTemplates,
  persistTemplates,
  loadDefaultTemplateId,
  persistDefaultTemplateId,
} from './drawingTemplates';

/** Manages the saved-template list plus which one (if any) is the current default applied to
 *  every newly drawn object - see drawingTemplates.ts for the storage/scope decisions. Kept as
 *  its own hook (not folded into useDrawingTools) since it has nothing to do with canvas
 *  rendering/hit-testing - purely style-preset bookkeeping. */
export function useDrawingTemplates() {
  const [templates, setTemplates] = useState<DrawingTemplate[]>(() => loadTemplates());
  const [defaultTemplateId, setDefaultTemplateIdState] = useState<string | null>(() => loadDefaultTemplateId());

  const saveTemplate = useCallback((name: string, color: string, lineWidth: number): DrawingTemplate => {
    const template: DrawingTemplate = { id: genTemplateId(), name, color, lineWidth };
    setTemplates((prev) => {
      const next = [...prev, template];
      persistTemplates(next);
      return next;
    });
    return template;
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id);
      persistTemplates(next);
      return next;
    });
    setDefaultTemplateIdState((cur) => {
      if (cur !== id) return cur;
      persistDefaultTemplateId(null);
      return null;
    });
  }, []);

  const setDefaultTemplateId = useCallback((id: string | null) => {
    setDefaultTemplateIdState(id);
    persistDefaultTemplateId(id);
  }, []);

  /** The style every NEW drawing (of any tool) starts with - null falls back to this feature's
   *  own hardcoded default (DEFAULT_DRAWING_COLOR/DEFAULT_DRAWING_LINE_WIDTH in drawingTypes.ts),
   *  same as before templates existed at all. */
  const defaultStyle = useMemo(() => {
    const template = templates.find((t) => t.id === defaultTemplateId);
    return template ? { color: template.color, lineWidth: template.lineWidth } : null;
  }, [templates, defaultTemplateId]);

  return { templates, defaultTemplateId, defaultStyle, saveTemplate, deleteTemplate, setDefaultTemplateId };
}
