import { provideHttpClient } from '@angular/common/http';
import { provideLocationMocks } from '@angular/common/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { MeService } from '../../core/api/me.service';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { DashboardShellComponent } from './dashboard-shell.component';
import { InboxService } from './data/inbox.service';
import { UploadService } from './data/upload.service';

/**
 * `section()` decides which nav entry is highlighted. It is a prefix chain, so
 * the order of its branches matters and a new page added above the `'recent'`
 * fallback can silently steal another page's highlight. These cases pin each URL
 * to its entry — including the ones most at risk of colliding.
 */
describe('DashboardShellComponent section()', () => {
  let events: Subject<unknown>;
  let router: Record<string, unknown> & { url: string };
  let inbox: { unreadCount: () => number; hasUnread: () => boolean; refreshCount: jasmine.Spy };

  /** Builds the component at a given URL and returns its resolved section. */
  const sectionAt = (url: string): string => {
    router.url = url;
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { section(): string };
    return component.section();
  };

  beforeEach(() => {
    events = new Subject<unknown>();
    router = {
      url: '/dashboard',
      events: events.asObservable(),
      createUrlTree: (commands: unknown) => commands,
      serializeUrl: (tree: unknown) => (Array.isArray(tree) ? tree.join('/') : String(tree)),
      navigateByUrl: jasmine.createSpy('navigateByUrl'),
    };
    inbox = {
      unreadCount: () => 0,
      hasUnread: () => false,
      refreshCount: jasmine.createSpy('refreshCount').and.resolveTo(undefined),
    };

    TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideLocationMocks(),
        { provide: Router, useValue: router },
        { provide: InboxService, useValue: inbox },
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        { provide: UploadService, useValue: { tasks: () => [], upload: () => Promise.resolve(), clearFinished: () => undefined } },
        { provide: UiDialogService, useValue: { open: jasmine.createSpy('open') } },
        {
          provide: MeService,
          useValue: {
            me: () => null,
            preferences: () => ({}),
            load: () => Promise.resolve(null),
            refresh: () => Promise.resolve(null),
          },
        },
      ],
    });
  });

  it('maps each dashboard URL to its own nav entry', () => {
    expect(sectionAt('/dashboard')).toBe('recent');
    expect(sectionAt('/dashboard/drawings')).toBe('drawings');
    expect(sectionAt('/dashboard/folders/abc123')).toBe('drawings');
    expect(sectionAt('/dashboard/shared')).toBe('shared');
    expect(sectionAt('/dashboard/trash')).toBe('trash');
    expect(sectionAt('/dashboard/settings')).toBe('settings');
    expect(sectionAt('/dashboard/feedback')).toBe('feedback');
    expect(sectionAt('/dashboard/inbox')).toBe('inbox');
    expect(sectionAt('/dashboard/profile')).toBe('profile');
  });

  it('keeps the nested account URL on Settings, not Personal info', () => {
    // `/dashboard/settings/account` is the Settings account pane; the `profile`
    // page must not claim it.
    expect(sectionAt('/dashboard/settings/account')).toBe('settings');
  });

  it('keeps query strings from breaking the match', () => {
    expect(sectionAt('/dashboard/drawings?q=plan')).toBe('drawings');
    expect(sectionAt('/dashboard/inbox?x=1')).toBe('inbox');
  });

  it('keeps "Shared with me" off the My Drawings entry', () => {
    // Both are the same routed component; only the nav highlight distinguishes
    // them, and `drawings` matching first would light the wrong one.
    expect(sectionAt('/dashboard/shared?q=plan')).toBe('shared');
  });

  it('falls back to Recent for an unknown dashboard URL', () => {
    expect(sectionAt('/dashboard/something-else')).toBe('recent');
  });

  it('refreshes the unread count on mount so the badge is right on arrival', () => {
    sectionAt('/dashboard');
    expect(inbox.refreshCount).toHaveBeenCalled();
  });

  it('reacts to navigation without being rebuilt', () => {
    router.url = '/dashboard';
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { section(): string };
    expect(component.section()).toBe('recent');

    router.url = '/dashboard/feedback';
    events.next(new NavigationEnd(1, '/dashboard/feedback', '/dashboard/feedback'));
    fixture.detectChanges();
    expect(component.section()).toBe('feedback');
  });
});

describe('DashboardShellComponent notification badge', () => {
  const build = (unread: number) => {
    const events = new Subject<unknown>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideLocationMocks(),
        {
          provide: Router,
          useValue: {
            url: '/dashboard',
            events: events.asObservable(),
            createUrlTree: (commands: unknown) => commands,
            serializeUrl: (tree: unknown) => (Array.isArray(tree) ? tree.join('/') : String(tree)),
            navigateByUrl: () => Promise.resolve(true),
          },
        },
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
        { provide: UploadService, useValue: { tasks: () => [], upload: () => Promise.resolve(), clearFinished: () => undefined } },
        {
          provide: InboxService,
          useValue: {
            unreadCount: () => unread,
            hasUnread: () => unread > 0,
            refreshCount: () => Promise.resolve(),
          },
        },
        { provide: UiDialogService, useValue: { open: () => undefined } },
        {
          provide: MeService,
          useValue: { me: () => null, preferences: () => ({}), load: () => Promise.resolve(null) },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as { badgeLabel(): string; bellTitle(): string };
  };

  it('caps the label so a large count cannot stretch the bell', () => {
    expect(build(3).badgeLabel()).toBe('3');
    expect(build(9).badgeLabel()).toBe('9');
    expect(build(10).badgeLabel()).toBe('9+');
    expect(build(250).badgeLabel()).toBe('9+');
  });

  it('describes the unread count in the accessible name', () => {
    expect(build(0).bellTitle()).toBe('Notifications');
    expect(build(2).bellTitle()).toBe('Notifications — 2 unread');
  });
});
