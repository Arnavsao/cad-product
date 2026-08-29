import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FolderDetailDto, FolderPathEntry } from '../../../core/api/api.models';
import { UiIconComponent } from '../../../shared/ui/icon.component';

/**
 * "My Drawings › Projects › Site plans" for the folder browser.
 *
 * Design decision: the API's `path` is documented as "the folder plus its
 * ancestry (root first)", which leaves it open whether the folder itself is the
 * last entry. The component tolerates both — it appends the current folder only
 * when `path` does not already end with it — so a server change on either side
 * of that ambiguity never produces a duplicated crumb.
 */
@Component({
  selector: 'app-folder-breadcrumbs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIconComponent],
  template: `
    <nav class="bc" aria-label="Folder path">
      <a class="bc__crumb" routerLink="/dashboard/drawings">My Drawings</a>
      @for (crumb of crumbs(); track crumb.id; let last = $last) {
        <ui-icon class="bc__sep" name="chevron-right" [size]="14" />
        @if (last) {
          <span class="bc__crumb bc__crumb--current" aria-current="page">{{ crumb.name }}</span>
        } @else {
          <a class="bc__crumb" [routerLink]="['/dashboard/folders', crumb.id]">{{ crumb.name }}</a>
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
    `,
  ],
})
export class FolderBreadcrumbsComponent {
  /** `GET /folders/:id`, or null at the top level (only "My Drawings" renders). */
  readonly folder = input<FolderDetailDto | null>(null);

  protected readonly crumbs = computed<FolderPathEntry[]>(() => {
    const folder = this.folder();
    if (!folder) return [];
    const path = folder.path ?? [];
    const last = path.length ? path[path.length - 1] : null;
    return last?.id === folder.id ? [...path] : [...path, { id: folder.id, name: folder.name }];
  });
}
