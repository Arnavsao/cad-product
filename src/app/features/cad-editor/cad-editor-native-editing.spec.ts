/**
 * Ctrl+V in the AI Agent's API-key box used to be swallowed by the editor's
 * global keydown handler: it called `preventDefault()` and ran the drawing's
 * PASTE command, so the key never reached the input and was instead dropped onto
 * the canvas as text — in plain sight, which is how one got leaked.
 *
 * The handler's Ctrl/Cmd block is gated on the predicate reproduced here. It has
 * to hold two things at once:
 *   - ordinary form fields keep the browser's native clipboard/undo shortcuts;
 *   - the command line does NOT, because AutoCAD routes those keys to the
 *     drawing even while a command is being typed, and CADO matches that.
 *
 * `CadEditorComponent` injects too much to mount here, so the predicate is
 * mirrored rather than imported — same shape as `cad-editor-loader.spec.ts`,
 * which reproduces the loader's CSS for the same reason. Keep the two in step.
 */
describe('cad-editor native editing guard', () => {
  /** Mirrors `CadEditorComponent.isEditingText`. */
  const isEditingText = (target: HTMLElement | null): boolean => {
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  };

  /** Mirrors `CadEditorComponent.isNativeEditingTarget`. */
  const isNativeEditingTarget = (target: HTMLElement | null): boolean => {
    if (!isEditingText(target)) return false;
    return !target!.classList.contains('cmd-input');
  };

  const el = (html: string): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild as HTMLElement;
  };

  it('yields to the AI Agent API-key input, the field that leaked a key', () => {
    const input = el('<input class="ai-key-input" type="password" />');
    expect(isNativeEditingTarget(input))
      .withContext('Ctrl+V here must reach the input, not the drawing')
      .toBe(true);
  });

  it('yields to a text input, textarea and select', () => {
    expect(isNativeEditingTarget(el('<input type="text" />'))).toBe(true);
    expect(isNativeEditingTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isNativeEditingTarget(el('<select></select>'))).toBe(true);
  });

  it('yields to a contenteditable region', () => {
    const div = el('<div></div>');
    // jsdom/Chrome only reflects the property when the attribute is honoured;
    // set it directly so the assertion tests the predicate, not the DOM.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isNativeEditingTarget(div)).toBe(true);
  });

  it('does NOT yield to the command line — AutoCAD parity sends those keys to the drawing', () => {
    const cmd = el('<input class="cmd-input" type="text" />');
    expect(isNativeEditingTarget(cmd))
      .withContext('the command line must keep the editor shortcuts')
      .toBe(false);
  });

  it('does NOT yield to the canvas or other non-field targets', () => {
    expect(isNativeEditingTarget(el('<canvas></canvas>'))).toBe(false);
    expect(isNativeEditingTarget(el('<div></div>'))).toBe(false);
    expect(isNativeEditingTarget(null)).toBe(false);
  });

  it('keys off the class, not the element type, so a styled command line still matches', () => {
    const cmd = el('<input class="cmd-input ng-touched" type="text" />');
    expect(isNativeEditingTarget(cmd)).toBe(false);
  });
});
