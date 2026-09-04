import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { MeService } from '../../core/api/me.service';
import { WorkspaceService } from '../../core/api/workspace.service';
import { NotificationService } from '../../core/services/notification.service';
import { AccountButtonComponent } from '../../shared/ui/account-button.component';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiInputDirective } from '../../shared/ui/input.directive';
import { UiLogoComponent } from '../../shared/ui/logo.component';
import type { UiMenuItem } from '../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../shared/ui/menu/ui-menu-trigger.directive';
import { InvitationsBannerComponent } from './components/invitations-banner.component';
import { NewDrawingMenuComponent } from './components/new-drawing-menu.component';
import { NewFolderDialogComponent, NewFolderDialogData } from './components/new-folder-dialog.component';
import { WorkspaceSwitcherComponent } from './components/workspace-switcher.component';
import { UploadDropzoneDirective } from './components/upload-dropzone.directive';
import { DashboardEventsService } from './data/dashboard-events.service';
import { InboxService } from './data/inbox.service';
import { UPLOAD_ACCEPT, UploadService } from './data/upload.service';
import { FolderDto } from '../../core/api/api.models';

/** Which nav entry (left rail or header action) the current URL belongs to. */
type DashboardSection =
  | 'recent'
  | 'drawings'
  | 'shared'
  | 'trash'
  | 'settings'
  | 'feedback'
  | 'inbox'
  | 'profile'
  | 'organization';

const SEARCH_DEBOUNCE_MS = 250;

/** Sections that show the in-content search bar. */
const SEARCH_SECTIONS: ReadonlySet<DashboardSection> = new Set<DashboardSection>(['recent', 'drawings', 'shared', 'trash']);

/** Anything above this shows as "9+" so the badge cannot stretch the button. */
const BADGE_CAP = 9;

/**
 * Header help menu. `UiMenuItem` carries no href, so each id is routed in
 * `onHelpSelect`. Only What's New and About are wired up — Social / Community /
 * Contact Support were explicitly deferred, and a menu entry that does nothing is
 * worse than one that is absent.
 */
const HELP_MENU: UiMenuItem[] = [
  { id: 'whats-new', label: "What's New", icon: 'sparkle' },
  { id: 'about', label: 'About', icon: 'help' },
  { id: 'sep', label: '', separator: true },
  { id: 'pricing', label: 'Plans & pricing', icon: 'tag' },
  { id: 'feedback', label: 'Provide Feedback', icon: 'message' },
];

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
    UiLogoComponent,
    UiMenuTriggerDirective,
    InvitationsBannerComponent,
    NewDrawingMenuComponent,
    UploadDropzoneDirective,
    WorkspaceSwitcherComponent,
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
  protected readonly workspace = inject(WorkspaceService);
  protected readonly upload = inject(UploadService);
  protected readonly inbox = inject(InboxService);

  protected readonly appName = environment.appName;
  protected readonly uploadAccept = UPLOAD_ACCEPT;

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly folderInput = viewChild<ElementRef<HTMLInputElement>>('folderInput');

  protected readonly uploadMenu: UiMenuItem[] = [
    { id: 'files', label: 'Upload files…', icon: 'file' },
    { id: 'folder', label: 'Upload folder…', icon: 'folder' },
  ];

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
    if (url.startsWith('/dashboard/shared')) return 'shared';
    if (url.startsWith('/dashboard/trash')) return 'trash';
    if (url.startsWith('/dashboard/settings')) return 'settings';
    if (url.startsWith('/dashboard/feedback')) return 'feedback';
    if (url.startsWith('/dashboard/inbox')) return 'inbox';
    if (url.startsWith('/dashboard/profile')) return 'profile';
    if (url.startsWith('/dashboard/organization')) return 'organization';
    if (url.startsWith('/dashboard/drawings') || url.startsWith('/dashboard/folders')) return 'drawings';
    return 'recent';
  });

  /** Sections that show the in-content search bar above their content. */
  protected readonly searchSection = computed(() => SEARCH_SECTIONS.has(this.section()));

  /** Context-aware placeholder text for the search input. */
  protected readonly searchPlaceholder = computed(() => {
    switch (this.section()) {
      case 'trash': return 'Search trash';
      case 'shared': return 'Search shared drawings';
      default: return 'Search drawings';
    }
  });

  protected readonly helpMenu = HELP_MENU;

  /** `9+` past the cap so a large count cannot stretch the bell button. */
  protected readonly badgeLabel = computed(() => {
    const n = this.inbox.unreadCount();
    return n > BADGE_CAP ? `${BADGE_CAP}+` : String(n);
  });

  protected readonly bellTitle = computed(() => {
    const n = this.inbox.unreadCount();
    if (!n) return 'Notifications';
    return `Notifications — ${n} unread`;
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
    // `/me` carries the organization list, so the switcher is populated by the
    // same request the shell already needs — no second round-trip on arrival.
    void this.me
      .load()
      .then((me) => this.workspace.hydrate(me))
      .catch(() => this.usageUnavailable.set(true));
    // The badge needs a count on arrival. `refreshCount` swallows its own errors,
    // so a notifications outage never blocks the dashboard from rendering.
    void this.inbox.refreshCount();

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
    const section = this.section();
    if (section === 'drawings' || section === 'shared') {
      // Stay on the current page and filter in place.
      void this.router.navigate([], { queryParams: { q }, queryParamsHandling: 'merge' });
    } else if (section === 'trash') {
      // Keep the user in Trash — search only within trashed drawings.
      void this.router.navigate(['/dashboard/trash'], { queryParams: { q } });
    } else if (q) {
      // Recent, and any other section: go to My Drawings.
      void this.router.navigate(['/dashboard/drawings'], { queryParams: { q } });
    }
  }

  // ── actions ───────────────────────────────────────────────────────────────

  protected onDrawingCreated(): void {
    this.events.bump();
  }

  /** Routes a help-menu pick. `UiMenuItem` has no href, so ids are dispatched here. */
  protected onHelpSelect(id: string): void {
    switch (id) {
      case 'whats-new':
        void this.router.navigateByUrl('/whats-new');
        return;
      case 'pricing':
        void this.router.navigateByUrl('/pricing');
        return;
      case 'feedback':
        void this.router.navigateByUrl('/dashboard/feedback');
        return;
      case 'about':
        void this.openAbout();
        return;
      default:
        return;
    }
  }

  /**
   * About is a dialog, not a route — it is a glance at the version, not a
   * destination. Loaded on demand so its content is not in the dashboard chunk.
   */
  private async openAbout(): Promise<void> {
    const { AboutDialogComponent } = await import('../about/about-dialog.component');
    await this.dialog.open(AboutDialogComponent, undefined, { width: '420px' }).afterClosed;
  }

  protected pickFiles(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected pickFolder(): void {
    this.folderInput()?.nativeElement.click();
  }

  protected onUploadSelect(id: string): void {
    if (id === 'folder') {
      this.pickFolder();
    } else {
      this.pickFiles();
    }
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
    const data: NewFolderDialogData = {
      parentId: this.folderId(),
      organizationId: this.workspace.activeOrgId(),
    };
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
    await this.upload.upload(files, this.folderId(), this.workspace.activeOrgId());
    this.events.bump();
    void this.me.refresh().catch(() => undefined); // storage usage moved
  }
}
