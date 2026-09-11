import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../../shared/ui/menu/ui-menu-trigger.directive';
import { injectTranslateFn } from './translate-fn';

/** Menu entries; `labelKey` is resolved per language when the menu is built. */
const MENU: readonly { id: string; labelKey: string; icon: UiMenuItem['icon'] }[] = [
  { id: 'blank', labelKey: 'dashboard.components.newDrawing.blank', icon: 'file' },
  { id: 'template', labelKey: 'dashboard.components.newDrawing.fromTemplate', icon: 'copy' },
];

/**
 * Split button: the face creates a blank drawing, the caret offers the same
 * plus templates.
 *
 * Design decision: the component creates the drawing and navigates itself
 * rather than emitting an event, because the "New drawing" action is identical
 * everywhere it appears (left nav, empty states) and duplicating the
 * create-then-navigate-then-toast sequence in each host is how those drift.
 * `created` is emitted so a host that also lists drawings can refresh.
 *
 * Templates are not implemented server-side yet: choosing one creates a blank
 * drawing and says so, rather than presenting a picker that cannot deliver.
 */
@Component({
  selector: 'app-new-drawing-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, UiButtonDirective, UiIconComponent, UiMenuTriggerDirective],
  template: `
    <div class="nd" *transloco="let t">
      <button
        type="button"
        uiButton
        variant="primary"
        class="nd__main"
        [loading]="creating()"
        [disabled]="creating()"
        (click)="create('blank')"
      >
        <ui-icon name="plus" [size]="15" />
        {{ t('dashboard.components.newDrawing.label') }}
      </button>
      <button
        type="button"
        uiButton
        variant="primary"
        class="nd__caret"
        [attr.aria-label]="t('dashboard.components.newDrawing.options')"
        [disabled]="creating()"
        [uiMenuTrigger]="menu()"
        menuAlign="end"
        (uiMenuSelect)="create($event.id)"
      >
        <ui-icon name="chevron-down" [size]="14" />
      </button>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .nd { display: flex; width: 100%; }
      .nd__main { flex: 1; justify-content: flex-start; border-top-right-radius: 0; border-bottom-right-radius: 0; }
      .nd__caret {
        width: 32px; padding: 0; flex: 0 0 auto;
        border-top-left-radius: 0; border-bottom-left-radius: 0;
        box-shadow: inset 1px 0 0 var(--ui-accent-dark);
      }
    `,
  ],
})
export class NewDrawingMenuComponent {
  /** Folder the new drawing lands in; null for the top level. */
  readonly folderId = input<string | null>(null);
  /** Emitted with the new drawing's id, before navigating to the editor. */
  readonly created = output<string>();

  private readonly drawings = inject(DrawingsApiService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  /** New drawings land in whichever workspace the dashboard is showing. */
  private readonly workspace = inject(WorkspaceService);
  private readonly transloco = inject(TranslocoService);
  private readonly t = injectTranslateFn();

  protected readonly menu = computed<UiMenuItem[]>(() => {
    const t = this.t();
    return MENU.map(({ id, labelKey, icon }) => ({ id, label: t(labelKey), icon }));
  });
  protected readonly creating = signal(false);

  protected async create(kind: string): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    try {
      const drawing = await this.drawings.create({
        name: this.transloco.translate('dashboard.components.newDrawing.untitled'),
        folderId: this.folderId(),
        organizationId: this.workspace.activeOrgId(),
      });
      this.created.emit(drawing.id);
      if (kind === 'template') {
        this.notify.info(this.transloco.translate('dashboard.components.newDrawing.templatesSoon'));
      }
      await this.router.navigate(['/editor', drawing.id]);
    } catch (e) {
      this.notify.error(
        e instanceof Error && e.message ? e.message : this.transloco.translate('dashboard.components.newDrawing.createFailed'),
      );
    } finally {
      this.creating.set(false);
    }
  }
}
