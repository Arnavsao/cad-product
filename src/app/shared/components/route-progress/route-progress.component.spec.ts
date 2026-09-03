import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { RouteProgressComponent } from './route-progress.component';

describe('RouteProgressComponent', () => {
  let events: Subject<unknown>;
  let fixture: ComponentFixture<RouteProgressComponent>;

  const bar = () => fixture.nativeElement.querySelector('.rp');
  const advance = (ms: number) => {
    jasmine.clock().tick(ms);
    fixture.detectChanges();
  };

  beforeEach(() => {
    events = new Subject<unknown>();
    TestBed.configureTestingModule({
      imports: [RouteProgressComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { events: events.asObservable() } },
      ],
    });
    fixture = TestBed.createComponent(RouteProgressComponent);
    fixture.detectChanges();
    // Zoneless app: zone.js/testing is not loaded, so fakeAsync/tick are not
    // available. Jasmine's clock drives the component's setTimeout instead.
    jasmine.clock().install();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('shows nothing while idle', () => {
    expect(bar()).toBeNull();
  });

  it('does not flash for a navigation that finishes quickly', () => {
    events.next(new NavigationStart(1, '/dashboard'));
    advance(100); // still inside the 150ms grace period
    expect(bar()).withContext('should not appear yet').toBeNull();

    events.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    advance(500);
    expect(bar()).withContext('fast navigation should never show a bar').toBeNull();
  });

  it('appears once a navigation outlasts the grace period', () => {
    events.next(new NavigationStart(1, '/editor'));
    advance(200);
    expect(bar()).not.toBeNull();

    events.next(new NavigationEnd(1, '/editor', '/editor'));
    fixture.detectChanges();
    expect(bar()).withContext('should clear on arrival').toBeNull();
  });

  it('clears on a cancelled navigation (e.g. a guard redirect)', () => {
    events.next(new NavigationStart(1, '/editor'));
    advance(200);
    expect(bar()).not.toBeNull();

    events.next(new NavigationCancel(1, '/editor', 'guard'));
    fixture.detectChanges();
    expect(bar()).toBeNull();
  });

  it('clears on a failed navigation so the bar cannot get stuck', () => {
    events.next(new NavigationStart(1, '/editor'));
    advance(200);
    expect(bar()).not.toBeNull();

    events.next(new NavigationError(1, '/editor', new Error('chunk failed')));
    fixture.detectChanges();
    expect(bar()).toBeNull();
  });

  it('does not stack timers across consecutive navigations', () => {
    events.next(new NavigationStart(1, '/a'));
    events.next(new NavigationEnd(1, '/a', '/a'));
    events.next(new NavigationStart(2, '/b'));
    advance(200);
    expect(bar()).withContext('second navigation still shows normally').not.toBeNull();

    events.next(new NavigationEnd(2, '/b', '/b'));
    advance(1000);
    expect(bar()).toBeNull();
  });
});

describe('RouteProgressComponent rendered markup', () => {
  it('renders a visible, non-zero-size bar with the accent colour', () => {
    const events = new Subject<unknown>();
    TestBed.configureTestingModule({
      imports: [RouteProgressComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { events: events.asObservable() } },
      ],
    });
    const fixture = TestBed.createComponent(RouteProgressComponent);
    fixture.detectChanges();

    jasmine.clock().install();
    try {
      events.next(new NavigationStart(1, '/editor'));
      jasmine.clock().tick(200);
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement.querySelector('.rp');
      expect(host).withContext('bar element should exist').not.toBeNull();

      // Attach to the live document so getComputedStyle reflects real layout.
      document.body.appendChild(fixture.nativeElement);
      const cs = getComputedStyle(host);
      expect(cs.position).toBe('fixed');
      expect(parseFloat(cs.height)).toBeGreaterThan(0);
      expect(cs.display).not.toBe('none');
      expect(cs.visibility).toBe('visible');

      const inner: HTMLElement = host.querySelector('.rp__bar')!;
      expect(inner).not.toBeNull();
      expect(inner.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(host.getBoundingClientRect().width).toBeGreaterThan(0);

      expect(host.getAttribute('role')).toBe('status');
      expect(host.getAttribute('aria-label')).toBe('Loading page');
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
