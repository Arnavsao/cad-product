import { RowSelection } from './row-selection';

/**
 * Selection is the input to every bulk action, so the interesting cases are the
 * ones where it could quietly act on the wrong rows: a shift-range measured
 * from a stale anchor, a select-all that swallows another page's ids, and a
 * reload that leaves ids behind for rows that no longer exist.
 */
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe('RowSelection', () => {
  it('ticks and unticks one row', () => {
    const page = rows('a', 'b', 'c');
    const selection = new RowSelection();

    selection.toggle(page, 'b', true);
    expect(selection.has('b')).toBe(true);
    expect(selection.count()).toBe(1);

    selection.toggle(page, 'b', false);
    expect(selection.any()).toBe(false);
  });

  it('selects a shift-click range from the last clicked row', () => {
    const page = rows('a', 'b', 'c', 'd', 'e');
    const selection = new RowSelection();

    selection.toggle(page, 'b', true);
    selection.toggle(page, 'd', true, true);

    expect(selection.selected(page).map((r) => r.id)).toEqual(['b', 'c', 'd']);
  });

  it('ranges backwards too', () => {
    const page = rows('a', 'b', 'c', 'd');
    const selection = new RowSelection();

    selection.toggle(page, 'd', true);
    selection.toggle(page, 'b', true, true);

    expect(selection.selected(page).map((r) => r.id)).toEqual(['b', 'c', 'd']);
  });

  it('unticks a whole range with shift', () => {
    const page = rows('a', 'b', 'c');
    const selection = new RowSelection();

    selection.setAll(page, true);
    selection.toggle(page, 'a', false);
    selection.toggle(page, 'c', false, true);

    expect(selection.any()).toBe(false);
  });

  it('reports all / some for the page on screen', () => {
    const page = rows('a', 'b');
    const selection = new RowSelection();

    expect(selection.allOf(page)).toBe(false);
    selection.toggle(page, 'a', true);
    expect(selection.someOf(page)).toBe(true);
    expect(selection.allOf(page)).toBe(false);
    selection.setAll(page, true);
    expect(selection.allOf(page)).toBe(true);
  });

  it('never reports an empty page as fully selected', () => {
    expect(new RowSelection().allOf([])).toBe(false);
  });

  it('leaves other pages alone when clearing this one', () => {
    const first = rows('a', 'b');
    const second = rows('c', 'd');
    const selection = new RowSelection();

    selection.setAll(first, true);
    selection.setAll(second, true);
    selection.setAll(second, false);

    expect(selection.selected([...first, ...second]).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('drops ids for rows that are gone after a reload', () => {
    const selection = new RowSelection();
    selection.setAll(rows('a', 'b', 'c'), true);

    selection.retain(rows('a', 'c'));

    expect(selection.count()).toBe(2);
    expect(selection.has('b')).toBe(false);
  });

  it('clears everything', () => {
    const selection = new RowSelection();
    selection.setAll(rows('a', 'b'), true);
    selection.clear();
    expect(selection.count()).toBe(0);
  });
});
