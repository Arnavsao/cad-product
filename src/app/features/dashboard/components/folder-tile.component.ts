import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FolderDto } from '../../../core/api/api.models';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../../shared/ui/menu/ui-menu-trigger.directive';
import { folderMenuFor } from './folder-menu';
import { DRAG_MIME, markDropHandled } from './drag-payload';

/**
 * One folder in the browser: a link to its contents, a kebab, and a drop target.
 *
 * Design decisions:
 *
 * - **Still an `<a routerLink>`.** Folders were plain links and that is the
 *   right primary affordance — middle-click, Ctrl-click and "Open in new tab"
 *   all keep working. The kebab is a sibling of the link, not inside it.
 *
 * - **Two kinds of drop, one target.** A drag carrying `Files` uploads into this
 *   folder; a drag carrying `DRAG_MIME` (rows/tiles from the same page) moves
 *   those drawings into it. Which one it is has to be decided from
 *   `dataTransfer.types` during `dragover`, because the *data* is unreadable
 *   until the drop — so the two are distinguished by MIME type, never by
 *   guessing at the payload.
 *
 * - **The tile does not perform either action.** It reports `filesDropped` /
 *   `itemsDropped` and lets the page (which owns the store, the workspace and
 *   the toasts) do the work, exactly like `UploadDropzoneDirective`.
 */
@Component({
  selector: 'app-folder-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiIconComponent, UiMenuTriggerDirective],
  template: `
    <div
      class="ft"
      [class.is-drop-target]="over()"
      [uiMenuTrigger]="menu()"
      [openOnClick]="false"
      #ctx="uiMenuTrigger"
      (uiMenuSelect)="action.emit($event.id)"
      (contextmenu)="onContextMenu($event, ctx)"
      (dragenter)="onDragEnter($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <a class="ft__hit" [routerLink]="['/dashboard/folders', folder().id]" [title]="folder().name">
        <ui-icon name="folder" [size]="18" />
        <span class="ft__name">{{ folder().name }}</span>
        @if (sharedLabel(); as label) {
          <span class="ft__chip" [title]="label">
            <ui-icon name="users" [size]="11" />
          </span>
        }
      </a>

      @if (menu().length > 1) {
        <button
          type="button"
          uiButton
          variant="ghost"
          size="sm"
          iconOnly
          class="ft__kebab"
          [attr.aria-label]="'Actions for ' + folder().name"
          [uiMenuTrigger]="menu()"
          menuAlign="end"
          (uiMenuSelect)="action.emit($event.id)"
        >
          <ui-icon name="more" [size]="16" />
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      .ft {
        position: relative; display: flex; align-items: center;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg);
        background: var(--ui-surface);
        transition: border-color var(--ui-dur-fast), background var(--ui-dur-fast), box-shadow var(--ui-dur-fast);
      }
      .ft:hover { border-color: var(--ui-border-strong); background: var(--ui-hover); }
      .ft:hover .ft__kebab, .ft__kebab[aria-expanded='true'] { opacity: 1; }
      /*
       * The accent outline is the only feedback a drag gets — keep it loud, and
       * keep it *visible*: the shell's "Drop to upload" scrim covers the content
       * area at z-index 5 while files are being dragged, so the hovered tile has
       * to sit above it or the user is told the file is going somewhere else.
       */
      .ft.is-drop-target {
        z-index: 6;
        border-color: var(--ui-accent);
        box-shadow: 0 0 0 2px var(--ui-accent-glow);
        background: var(--ui-active);
      }

      .ft__hit {
        display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
        padding: 12px 14px;
        color: var(--ui-text); text-decoration: none;
        font-size: var(--ui-text-md); font-weight: 500;
        border-radius: var(--ui-radius-lg);
      }
      .ft__hit:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .ft__hit > ui-icon:first-child { color: var(--ui-accent); }
      .ft__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ft__chip {
        display: inline-flex; flex: 0 0 auto; padding: 2px;
        color: var(--ui-text-dim);
      }

      .ft__kebab {
        position: absolute; top: 50%; right: 6px; transform: translateY(-50%);
        opacity: 0; background: var(--ui-surface);
        transition: opacity var(--ui-dur-fast);
      }
      .ft__kebab:focus-visible { opacity: 1; }
      @media (hover: none) { .ft__kebab { opacity: 1; } }
    `,
  ],
})
export class FolderTileComponent {
  readonly folder = input.required<FolderDto>();
  /** Accept drops (off in a search result list, where "this folder" is ambiguous). */
  readonly droppable = input(true);

  /** A menu item id — narrow it with `toFolderAction`. */
  readonly action = output<string>();
  /** Files dropped on this folder, to be uploaded into it. */
  readonly filesDropped = output<File[]>();
  /** Drawing ids dropped on this folder, to be moved into it. */
  readonly itemsDropped = output<string[]>();

  protected readonly over = signal(false);
  protected readonly menu = computed<UiMenuItem[]>(() => folderMenuFor(this.folder()));

  protected readonly sharedLabel = computed<string | null>(() => {
    const folder = this.folder();
    if (folder.viaShare) return 'Shared with you';
    return folder.organizationName ? `Shared with ${folder.organizationName}` : null;
  });

  /** dragenter/dragleave fire per child element, so hover uses a depth counter. */
  private depth = 0;

  protected onContextMenu(event: MouseEvent, trigger: UiMenuTriggerDirective): void {
    event.preventDefault();
    trigger.openAt(event.clientX, event.clientY);
  }

  protected onDragEnter(event: DragEvent): void {
    if (!this.accepts(event)) return;
    event.preventDefault();
    this.depth++;
    this.over.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.accepts(event)) return;
    // Without preventDefault the browser refuses the drop (and navigates to a file).
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = hasFiles(event) ? 'copy' : 'move';
  }

  protected onDragLeave(event: DragEvent): void {
    if (!this.depth) return;
    event.preventDefault();
    this.depth = Math.max(0, this.depth - 1);
    if (!this.depth) this.over.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (!this.accepts(event)) return;
    event.preventDefault();
    // The shell's dropzone wraps the whole content area and would otherwise
    // import the same files into the folder being *browsed*. The marker (rather
    // than stopPropagation) lets it clear its own hover state first — see
    // `markDropHandled`.
    markDropHandled(event);
    this.depth = 0;
    this.over.set(false);

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) {
      this.filesDropped.emit(files);
      return;
    }
    const ids = parseIds(event.dataTransfer?.getData(DRAG_MIME));
    if (ids.length) this.itemsDropped.emit(ids);
  }

  private accepts(event: DragEvent): boolean {
    return this.droppable() && (hasFiles(event) || hasItems(event));
  }
}

function types(event: DragEvent): readonly string[] {
  return Array.from(event.dataTransfer?.types ?? []);
}

function hasFiles(event: DragEvent): boolean {
  return types(event).includes('Files');
}

function hasItems(event: DragEvent): boolean {
  return types(event).includes(DRAG_MIME);
}

/** Tolerates anything: a hand-crafted drag from outside must not throw. */
function parseIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
