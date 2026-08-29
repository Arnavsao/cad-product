import type { Entity } from '../../../core/models/entity.model';
import type { DocumentService } from '../../../core/services/document.service';
import type { TargetSelector, EntityWhere } from '../models/ai-action.model';

/**
 * Pure, deterministic target resolver.
 * Every AI action passes through here; the resolved id set is logged for audit.
 * No mutations. No Angular DI — takes DocumentService as a plain argument.
 */
export function resolveTarget(sel: TargetSelector, doc: DocumentService): Entity[] {
  const file = doc.activeFile;
  const entities = file.entities;

  switch (sel.kind) {
    case 'selection':
      return doc.getSelectedEntities();

    case 'ids': {
      const set = new Set(sel.ids);
      return entities.filter(e => set.has(e.id));
    }

    case 'all':
      return visibleEntities(entities, doc);

    case 'query':
      return filterByWhere(visibleEntities(entities, doc), sel.where, doc);

    case 'layer':
      return entities.filter(
        e => e.layer.toLowerCase() === sel.layer.toLowerCase(),
      );

    default:
      return [];
  }
}

function visibleEntities(entities: Entity[], doc: DocumentService): Entity[] {
  const file = doc.activeFile;
  return entities.filter(e => {
    const lay = file.layers.get(e.layer);
    return !lay || (lay.visible && !lay.frozen);
  });
}

function filterByWhere(entities: Entity[], where: EntityWhere, doc: DocumentService): Entity[] {
  let result = entities;
  const file = doc.activeFile;

  if (where.visibleOnly !== false) {
    result = result.filter(e => {
      const lay = file.layers.get(e.layer);
      return !lay || (lay.visible && !lay.frozen);
    });
  }

  if (where.type) {
    const types = (Array.isArray(where.type) ? where.type : [where.type])
      .map(t => t.toUpperCase());
    result = result.filter(e => types.includes(e.type.toUpperCase()));
  }

  if (where.layer) {
    const layers = (Array.isArray(where.layer) ? where.layer : [where.layer])
      .map(l => l.toLowerCase());
    result = result.filter(e => layers.includes(e.layer.toLowerCase()));
  }

  if (where.color && where.color.length > 0) {
    const colors = where.color;
    result = result.filter(
      e => colors.includes(e.colorNumber) || (e.color != null && colors.includes(e.color)),
    );
  }

  if (where.withinBBox) {
    const bb = where.withinBBox;
    result = result.filter(e => {
      const eb = typeof e.bbox === 'function' ? e.bbox() : null;
      if (!eb) return false;
      return (
        eb.x >= bb.x && eb.y >= bb.y &&
        eb.x + eb.w <= bb.x + bb.w &&
        eb.y + eb.h <= bb.y + bb.h
      );
    });
  }

  return result;
}
