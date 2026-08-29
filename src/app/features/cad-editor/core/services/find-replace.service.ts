import { Injectable, inject } from '@angular/core';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import type { Entity } from '../models/entity.model';
import { TextEntity, InsertEntity, DimensionEntity } from '../models/entity-extended.model';

export interface FindOptions {
  matchCase?: boolean;
  wholeWords?: boolean;
  scope: 'entire_drawing' | 'current_layout' | 'selected';
}

export interface FindResult {
  entity: Entity;
  matchText: string;
  property: string; // The property name where the text was found (e.g., 'text', 'textOverride', 'attributeValue')
  subEntity?: Entity; // If the text was found inside a block definition, this points to the inner entity.
}

/**
 * Strips AutoCAD MTEXT formatting codes to allow searching the raw text.
 * - Removes font/color/height/alignment/tracking tags: \f...; \C...; \H...; \p...; \A...; etc.
 * - Converts \P to \n
 * - Removes grouping braces {}
 */
export function stripMtext(text: string): string {
  if (!text) return '';
  return text
    // Replace \P with newline
    .replace(/\\P/g, '\n')
    // Remove backslash-command up to the semicolon
    .replace(/\\[A-Za-z0-9~][^;]*;/g, '')
    // Remove curly braces used for grouping
    .replace(/[{}]/g, '');
}

@Injectable({ providedIn: 'root' })
export class FindReplaceService {
  private docService = inject(DocumentService);
  private vm = inject(ViewModelService);

  findMatches(query: string, options: FindOptions): FindResult[] {
    if (!query) return [];
    
    let targetEntities: Entity[] = [];
    if (options.scope === 'selected') {
      targetEntities = this.docService.getSelectedEntities();
    } else if (options.scope === 'current_layout') {
      // Current space
      const isPaper = this.docService.activeSpace() === 'paper';
      for (const f of this.docService.files) {
        if (!f.visible) continue;
        for (const e of f.entities) {
          if (e.inPaperSpace === isPaper) targetEntities.push(e);
        }
      }
    } else {
      // Entire drawing
      for (const f of this.docService.files) {
        if (f.visible) targetEntities.push(...f.entities);
      }
    }

    const results: FindResult[] = [];
    
    const searchRegex = this.buildRegex(query, options);

    for (const e of targetEntities) {
      if (e instanceof TextEntity) {
        const cleanText = stripMtext(e.text);
        searchRegex.lastIndex = 0;
        if (searchRegex.test(cleanText)) {
          results.push({ entity: e, matchText: cleanText, property: 'text' });
        }
      } else if (e instanceof DimensionEntity) {
        const cleanTextOverride = e.textOverride ? stripMtext(e.textOverride) : '';
        searchRegex.lastIndex = 0;
        if (cleanTextOverride && searchRegex.test(cleanTextOverride)) {
          results.push({ entity: e, matchText: cleanTextOverride, property: 'textOverride' });
        }
      } else if (e instanceof InsertEntity) {
        // Search attributes if present
        if (e['attributes'] && e['attributes'].length) {
          for (const attr of e['attributes']) {
            searchRegex.lastIndex = 0;
            if (attr.value && searchRegex.test(attr.value)) {
              results.push({ entity: e, matchText: attr.value, property: `attribute:${attr.tag}` });
            }
          }
        }
        
        // Search inside the block definition recursively
        const searchBlock = (blockDef: any) => {
          if (!blockDef || !blockDef.entities) return;
          for (const subE of blockDef.entities) {
            if (subE instanceof TextEntity) {
              const cleanText = stripMtext(subE.text);
              searchRegex.lastIndex = 0;
              if (searchRegex.test(cleanText)) {
                results.push({ entity: e, matchText: cleanText, property: 'block_text', subEntity: subE });
              }
            } else if (subE instanceof DimensionEntity) {
              const cleanTextOverride = subE.textOverride ? stripMtext(subE.textOverride) : '';
              searchRegex.lastIndex = 0;
              if (cleanTextOverride && searchRegex.test(cleanTextOverride)) {
                results.push({ entity: e, matchText: cleanTextOverride, property: 'block_textOverride', subEntity: subE });
              }
            } else if (subE instanceof InsertEntity && subE._blockDef) {
              searchBlock(subE._blockDef);
            }
          }
        };
        searchBlock(e._blockDef);
      }
      // Expand to table cells, multileaders, etc. later if needed.
    }

    return results;
  }

  replace(result: FindResult, query: string, replacement: string, options: FindOptions): void {
    const searchRegex = this.buildRegex(query, options);
    
    if (result.entity instanceof TextEntity && result.property === 'text') {
      result.entity.text = result.entity.text.replace(searchRegex, replacement);
    } else if (result.entity instanceof DimensionEntity && result.property === 'textOverride') {
      if (result.entity.textOverride) {
        result.entity.textOverride = result.entity.textOverride.replace(searchRegex, replacement);
      }
    } else if (result.entity instanceof InsertEntity && result.property.startsWith('attribute:')) {
      const tag = result.property.split(':')[1];
      const attr = result.entity['attributes']?.find((a: any) => a.tag === tag);
      if (attr && attr.value) {
        attr.value = attr.value.replace(searchRegex, replacement);
      }
    } else if (result.entity instanceof InsertEntity && result.property.startsWith('block_') && result.subEntity) {
      if (result.subEntity instanceof TextEntity && result.property === 'block_text') {
        result.subEntity.text = result.subEntity.text.replace(searchRegex, replacement);
      } else if (result.subEntity instanceof DimensionEntity && result.property === 'block_textOverride') {
        if (result.subEntity.textOverride) {
          result.subEntity.textOverride = result.subEntity.textOverride.replace(searchRegex, replacement);
        }
      }
    }
    
    // Mark dirty
    const file = this.docService.getFileOfEntity(result.entity);
    if (file) {
      this.docService.bump(); // Bump doc version to re-render
      this.vm.markContentDirty();
    }
  }

  replaceAll(query: string, replacement: string, options: FindOptions): number {
    const results = this.findMatches(query, options);
    for (const res of results) {
      this.replace(res, query, replacement, options);
    }
    return results.length;
  }

  private buildRegex(query: string, options: FindOptions): RegExp {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let pattern = escapedQuery;
    if (options.wholeWords) {
      pattern = `\\b${pattern}\\b`;
    }
    const flags = options.matchCase ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  }
}
