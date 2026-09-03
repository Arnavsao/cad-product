import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FolderDetailDto, FolderPathEntry } from '../../../core/api/api.models';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { DRAG_MIME } from './drag-payload';

/** A drop onto a crumb: `folderId` is `null` for the "My Drawings" root. */
export interface BreadcrumbDropEvent {
  folderId: string | null;
  ids: string[];
}

/**
 * "My Drawings › Projects › Site plans" for the folder browser.
 *
 * Design decisions:
 *
 * - The API's `path` is documented as "the folder plus its ancestry (root
 *   first)", which leaves it open whether the folder itself is the last entry.
 *   The component tolerates both — it appends the current folder only when
 *   `path` does not already end with it — so a server change on either side of
 *   that ambiguity never produces a duplicated crumb.
 *
 * - **Every crumb but the current one is a drop target**, which is how a file
 *   manager lets you move something *up*: there is no other gesture for
 *   "out of here" once you have browsed in. Dropping on the crumb you are
 *   already looking at would be a no-op, so it does not accept.
 */
@Component({
  selector: 'app-folder-breadcrumbs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIconComponent],
  template: `
    <nav class="bc" aria-label="Folder path">
      <a
        class="bc__crumb"
        routerLink="/dashboard/drawings"
        [class.is-drop-target]="over() === ''"
        (dragenter)="onDragEnter($event, null)"
        (dragover)="onDragOver($event, null)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event, null)"
      >
        My Drawings
      </a>
      @for (crumb of crumbs(); track crumb.id; let last = $last) {
        <ui-icon class="bc__sep" name="chevron-right" [size]="14" />
        @if (last) {
          <span class="bc__crumb bc__crumb--current" aria-current="page">{{ crumb.name }}</span>
        } @else {
          <a
            class="bc__crumb"
            [routerLink]="['/dashboard/folders', crumb.id]"
            [class.is-drop-target]="over() === crumb.id"
            (dragenter)="onDragEnter($event, crumb.id)"
            (dragover)="onDragOver($event, crumb.id)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event, crumb.id)"
          >
            {{ crumb.name }}
          </a>
        }
      }
    </nav>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      .bc { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: var(--ui-text-base); }
      .bc__crumb {
        padding: 2px 4px; border-radius: var(--ui-radius-sm);
        color: var(--ui-text-dim); text-decoration: none; font-weight: 500;
      }
      a.bc__crumb:hover { color: var(--ui-text-strong); background: var(--ui-hover); }
      a.bc__crumb:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
      .bc__crumb--current { color: var(--ui-text-strong); }
      .bc__sep { color: var(--ui-text-dim); opacity: .7; }
      a.bc__crumb.is-drop-target {
        color: var(--ui-accent);
        background: var(--ui-active);
        box-shadow: inset 0 0 0 1px var(--ui-accent);
      }
    `,
  ],
})
export class FolderBreadcrumbsComponent {
  /** `GET /folders/:id`, or null at the top level (only "My Drawings" renders). */
  readonly folder = input<FolderDetailDto | null>(null);
  /** Accept drawings dragged onto a crumb. */
  readonly droppable = input(true);
  readonly itemsDropped = output<BreadcrumbDropEvent>();

  /** Which crumb is being dragged over: a folder id, `''` for the root, `null` for none. */
  protected readonly over = signal<string | null>(null);

  protected readonly crumbs = computed<FolderPathEntry[]>(() => {
    const folder = this.folder();
    if (!folder) return [];
    const path = folder.path ?? [];
    const last = path.length ? path[path.length - 1] : null;
    return last?.id === folder.id ? [...path] : [...path, { id: folder.id, name: folder.name }];
  });

  protected onDragEnter(event: DragEvent, folderId: string | null): void {
    if (!this.accepts(event)) return;
    event.preventDefault();
    this.over.set(folderId ?? '');
  }

  protected onDragOver(event: DragEvent, folderId: string | null): void {
    if (!this.accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.over.set(folderId ?? '');
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.over.set(null);
  }

  protected onDrop(event: DragEvent, folderId: string | null): void {
    if (!this.accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.over.set(null);
    const raw = event.dataTransfer?.getData(DRAG_MIME);
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
      if (ids.length) this.itemsDropped.emit({ folderId, ids });
    } catch {
      /* A drag from outside the app — nothing to move. */
    }
  }

  /** Only our own row drags; files belong to the shell's upload dropzone. */
  private accepts(event: DragEvent): boolean {
    return this.droppable() && Array.from(event.dataTransfer?.types ?? []).includes(DRAG_MIME);
  }
}
