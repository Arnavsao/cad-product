/**
 * The full-page loader's rules once sat inside an unclosed `.cad-revert-modal`
 * block, so they compiled to `.cad-revert-modal .cad-full-page-loader` and matched
 * nothing. Unstyled, the overlay lost `position: absolute` and became a real grid
 * item in `.cad-editor-root`, pushing every row down one (header into the toolbar
 * row, toolbar into the doc-tabs row) while a drawing loaded.
 *
 * This asserts the two properties that break that: the loader must be taken out of
 * flow, and it must actually cover the viewport.
 */
describe('cad-editor full-page loader styles', () => {
  const CLASS = 'cad-full-page-loader';
  let style: HTMLStyleElement;
  let host: HTMLElement;

  // The component stylesheet is not loaded in this spec, so the rules under test
  // are declared here in the same shape the SCSS compiles to.
  const RULES = `
    .${CLASS} {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
  `;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = RULES;
    document.head.appendChild(style);

    host = document.createElement('div');
    // Reproduce the editor shell: a fixed grid whose rows are sized like the real one.
    host.style.cssText =
      'position: fixed; inset: 0; display: grid; ' +
      'grid-template-rows: 36px auto 22px minmax(0, 1fr); grid-template-columns: minmax(0, 1fr);';
    host.innerHTML =
      `<div class="${CLASS}"><div class="mark"></div></div>` +
      `<header data-role="header" style="background:#111"></header>` +
      `<div data-role="toolbar" style="height:68px"></div>` +
      `<div data-role="tabs"></div>` +
      `<div data-role="canvas"></div>`;
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    style.remove();
  });

  it('takes the overlay out of the grid flow', () => {
    const overlay = host.querySelector<HTMLElement>(`.${CLASS}`)!;
    expect(getComputedStyle(overlay).position).toBe('fixed');
  });

  it('leaves the header in the first row rather than displacing it', () => {
    const header = host.querySelector<HTMLElement>('[data-role="header"]')!;
    const rect = header.getBoundingClientRect();
    // Row 1 is 36px tall and starts at the top of the shell.
    expect(rect.top).toBeCloseTo(host.getBoundingClientRect().top, 0);
    expect(Math.round(rect.height)).toBe(36);
  });

  it('covers the whole editor shell so the half-built UI is hidden behind it', () => {
    // Compared against the fixed shell rather than window.innerHeight: the Karma
    // runner page has a body margin, so the two differ by a few pixels.
    const overlay = host.querySelector<HTMLElement>(`.${CLASS}`)!.getBoundingClientRect();
    const shell = host.getBoundingClientRect();
    expect(Math.round(overlay.width)).toBe(Math.round(shell.width));
    expect(Math.round(overlay.height)).toBe(Math.round(shell.height));
    expect(Math.round(overlay.top)).toBe(Math.round(shell.top));
    expect(Math.round(overlay.left)).toBe(Math.round(shell.left));
  });

  it('would fail if the rules were scoped to .cad-revert-modal (the original bug)', () => {
    // Re-scope the rules exactly as the broken SCSS compiled them.
    style.textContent = RULES.replace(`.${CLASS} {`, `.cad-revert-modal .${CLASS} {`);
    const overlay = host.querySelector<HTMLElement>(`.${CLASS}`)!;
    expect(getComputedStyle(overlay).position)
      .withContext('mis-scoped rules leave the overlay in flow')
      .not.toBe('fixed');

    const header = host.querySelector<HTMLElement>('[data-role="header"]')!;
    expect(Math.round(header.getBoundingClientRect().height))
      .withContext('header gets pushed out of the 36px row')
      .not.toBe(36);
  });
});
