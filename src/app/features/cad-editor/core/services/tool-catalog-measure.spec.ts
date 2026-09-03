import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ToolCatalogService } from './tool-catalog.service';

/**
 * The four inquiry commands share one ribbon split button. Collapsing them must not
 * make any of them unreachable: each still needs its own entry in the flat registry
 * (that is what the command line searches) and its own aliases.
 */
describe('ToolCatalogService — inquiry split button', () => {
  let catalog: ToolCatalogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ToolCatalogService] });
    catalog = TestBed.inject(ToolCatalogService);
  });

  it('exposes the inquiry commands as one group inside Annotate', () => {
    const sections = catalog.getGrouped();
    expect(sections.map((s) => s.label)).toEqual(['Draw', 'Modify', 'Annotate']);

    const annotate = sections.find((s) => s.label === 'Annotate')!;
    const group = annotate.tools.find((t) => t.id === 'dist');
    expect(group).withContext('Distance group should live in Annotate').toBeTruthy();
    expect(group!.subTools?.map((t) => t.id)).toEqual(['dist', 'area', 'id', 'list']);
  });

  it('places Distance immediately after Linear so the 2-row grid packs it into that column', () => {
    const annotate = catalog.getGrouped().find((s) => s.label === 'Annotate')!;
    const ids = annotate.tools.map((t) => t.id);
    expect(ids.indexOf('dist')).toBe(ids.indexOf('dimlinear') + 1);
  });

  it('keeps every inquiry command in the flat registry', () => {
    for (const id of ['dist', 'area', 'id', 'list']) {
      expect(catalog.getById(id)).withContext(id).toBeTruthy();
    }
  });

  it('still resolves each command by its AutoCAD alias', () => {
    const expectations: Array<[string, string]> = [
      ['di', 'dist'],
      ['distance', 'dist'],
      ['aa', 'area'],
      ['area', 'area'],
      ['id', 'id'],
      ['li', 'list'],
      ['list', 'list'],
    ];
    for (const [query, expectedId] of expectations) {
      const ids = catalog.search(query).map((t) => t.id);
      expect(ids).withContext(`search("${query}") -> ${ids.join(',')}`).toContain(expectedId);
    }
  });

  it('does not register the repeated parent id twice', () => {
    const all = catalog.getAll().filter((t) => t.id === 'dist');
    expect(all.length).toBe(1);
  });
});
