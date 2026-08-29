import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { MeService } from '../../core/api/me.service';
import { NotificationService } from '../../core/services/notification.service';
import { AccountButtonComponent } from '../../shared/ui/account-button.component';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiInputDirective } from '../../shared/ui/input.directive';
import { FileSizePipe } from '../../shared/ui/pipes/file-size.pipe';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';
import { NewDrawingMenuComponent } from './components/new-drawing-menu.component';
import { NewFolderDialogComponent, NewFolderDialogData } from './components/new-folder-dialog.component';
import { UploadDropzoneDirective } from './components/upload-dropzone.directive';
import { DashboardEventsService } from './data/dashboard-events.service';
import { UPLOAD_ACCEPT, UploadService } from './data/upload.service';
import { FolderDto } from '../../core/api/api.models';

/** Which left-nav entry the current URL belongs to. */
type DashboardSection = 'recent' | 'drawings' | 'trash' | 'settings';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Chrome around every dashboard page: left nav, top bar, drop target, outlet.
 *
 * Design decisions:
 *  - **The URL is the state.** The current folder and the search text are read
 *    back out of the router rather than kept in a service, so a bookmark, a
 *    reload and the Back button all reproduce the same view. `?q=` is written
 *    with `queryParamsHandling: 'merge'` so it survives a folder change.
 *  - **The shell owns creation, pages own listing.** New drawing / New folder /
 *    Upload all need the *current folder*, which only the shell knows from the
 *    URL. After they mutate anything the shell bumps `DashboardEventsService`
 *    and each mounted page decides whether to refetch — see that service.
 *  - **Search targets the browser page.** Typing on Recent or Trash moves the
 *    user to My Drawings with the query applied; a search box that filtered a
 *    12-item Recent list would be a different, worse feature.
 *  - **Uploads are shell-level.** The whole content area is the drop target and
 *    the progress panel lives here, so navigating between pages mid-upload
 *    neither cancels it nor hides it.
 */
@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterOutlet,
    AccountButtonComponent,
    UiButtonDirective,
    UiIconComponent,
    UiInputDirective,
    UiSkeletonComponent,
    FileSizePipe,
    NewDrawingMenuComponent,
    UploadDropzoneDirective,
  ],
  templateUrl: './dashboard-shell.component.html',
  styleUrl: './dashboard-shell.component.scss',
})
export class DashboardShellComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly events = inject(DashboardEventsService);

  protected readonly me = inject(MeService);
  protected readonly upload = inject(UploadService);

  protected readonly appName = environment.appName;
  protected readonly uploadAccept = UPLOAD_ACCEPT;

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Current URL, refreshed on every completed navigation. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: null });

  /** Folder currently being browsed, parsed from `/dashboard/folders/:id`. */
  protected readonly folderId = computed<string | null>(() => {
    const match = /^\/dashboard\/folders\/([^/?#]+)/.exec(this.url());
    return match ? decodeURIComponent(match[1]) : null;
  });

  protected readonly section = computed<DashboardSection>(() => {
    const url = this.url();
    if (url.startsWith('/dashboard/trash')) return 'trash';
    if (url.startsWith('/dashboard/settings')) return 'settings';
    if (url.startsWith('/dashboard/drawings') || url.startsWith('/dashboard/folders')) return 'drawings';
    return 'recent';
  });

  /** Mirrors `?q=`; also the value of the search box. */
  protected readonly search = signal('');
  protected readonly usage = computed(() => this.me.me()?.usage ?? null);
  /** True once `/me` failed, so the footer stops pretending to load. */
  protected readonly usageUnavailable = signal(false);
  protected readonly creatingFolder = signal(false);

  /** Last value this component pushed into the URL, so echoes do not fight typing. */
  private pushedQuery = '';
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.me.load().catch(() => this.usageUnavailable.set(true));

    // Adopt `?q=` when it changes from outside (deep link, Back, nav link).
    effect(() => {
      const q = this.queryParams()?.get('q') ?? '';
      untracked(() => {
        if (q === this.pushedQuery) return;
        this.pushedQuery = q;
        this.search.set(q);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.debounce) clearTimeout(this.debounce);
    });
  }

  // ── search ────────────────────────────────────────────────────────────────

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search.set(value);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.commitSearch(value), SEARCH_DEBOUNCE_MS);
  }

  protected onSearchEnter(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.commitSearch(this.search());
  }

  protected clearSearch(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.search.set('');
    this.commitSearch('');
  }

  private commitSearch(value: string): void {
    const q = value.trim() || null;
    this.pushedQuery = q ?? '';
    const onBrowser = this.section() === 'drawings';
    if (onBrowser) {
      void this.router.navigate([], { queryParams: { q }, queryParamsHandling: 'merge' });
    } else if (q) {
      void this.router.navigate(['/dashboard/drawings'], { queryParams: { q } });
    }
  }

  // ── actions ───────────────────────────────────────────────────────────────

  protected onDrawingCreated(): void {
    this.events.bump();
  }

  protected pickFiles(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // so picking the same file twice still fires `change`
    void this.startUpload(files);
  }

  protected onFilesDropped(files: File[]): void {
    void this.startUpload(files);
  }

  protected async newFolder(): Promise<void> {
    if (this.creatingFolder()) return;
    this.creatingFolder.set(true);
    const data: NewFolderDialogData = { parentId: this.folderId() };
    try {
      const folder = await this.dialog.open<FolderDto, NewFolderDialogData>(NewFolderDialogComponent, data).afterClosed;
      if (!folder) return;
      this.notify.success(`Folder "${folder.name}" created.`);
      this.events.bump();
      if (this.section() !== 'drawings') await this.router.navigateByUrl('/dashboard/drawings');
    } finally {
      this.creatingFolder.set(false);
    }
  }

  private async startUpload(files: File[]): Promise<void> {
    if (!files.length) return;
    await this.upload.upload(files, this.folderId());
    this.events.bump();
    void this.me.refresh().catch(() => undefined); // storage usage moved
  }
}
