/**
 * Custom MIME type carrying the ids being dragged inside the dashboard.
 *
 * Design decision: a private type rather than `text/plain`. `dataTransfer.types`
 * is the only thing a drop target may read during `dragover` (the *data* is
 * withheld until the drop, by design, so a page cannot snoop on drags), so the
 * type is what tells a folder tile "these are my rows" apart from "this is a
 * file from the desktop" — and a private type also means dropping a drawing
 * onto an unrelated text field does nothing.
 *
 * The payload is a JSON array of drawing ids: dragging one unselected row sends
 * that row, dragging a selected one sends the whole selection.
 */
export const DRAG_MIME = 'application/x-cadonline-drawings';

/** A drop already dealt with by a nested target. See `markDropHandled`. */
interface HandledDragEvent extends DragEvent {
  cadDropHandled?: boolean;
}

/**
 * Claim a drop so an ancestor dropzone leaves it alone.
 *
 * `stopPropagation()` looks like the obvious tool and is the wrong one: the
 * shell's `appUploadDropzone` wraps the whole content area and tracks hover with
 * a depth counter, so an event that never bubbles up to it means its counter is
 * never unwound — the "Drop to upload" overlay would stay on screen until the
 * next navigation. Letting the event bubble with a marker lets the ancestor
 * reset its own state and then decline to act.
 */
export function markDropHandled(event: DragEvent): void {
  (event as HandledDragEvent).cadDropHandled = true;
}

/** True when a nested target already handled this drop. */
export function isDropHandled(event: DragEvent): boolean {
  return (event as HandledDragEvent).cadDropHandled === true;
}

/** Fill a `dragstart` event with `ids`, or return false if the browser refused. */
export function setDragIds(event: DragEvent, ids: readonly string[]): boolean {
  const transfer = event.dataTransfer;
  if (!transfer || !ids.length) return false;
  transfer.effectAllowed = 'move';
  transfer.setData(DRAG_MIME, JSON.stringify(ids));
  // A human-readable fallback for drops outside the app (a text editor, say).
  transfer.setData('text/plain', ids.join(','));
  return true;
}
