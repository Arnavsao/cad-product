import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SignInHandoffService } from './sign-in-handoff.service';

describe('SignInHandoffService', () => {
  let service: SignInHandoffService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    service = TestBed.inject(SignInHandoffService);
    // Zoneless app: zone.js/testing is not loaded, so fakeAsync/tick are not
    // available. Jasmine's clock drives the service's setTimeout instead.
    jasmine.clock().install();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('starts inactive', () => {
    expect(service.active()).toBe(false);
  });

  it('activates on begin()', () => {
    service.begin();
    expect(service.active()).toBe(true);
  });

  it('holds the loader for the minimum display time when the work finishes instantly', () => {
    service.begin();
    service.end();

    // The whole point of the minimum: a warm session must not flash the loader.
    expect(service.active()).withContext('cleared too early').toBe(true);

    jasmine.clock().tick(399);
    expect(service.active()).toBe(true);

    jasmine.clock().tick(1);
    expect(service.active()).toBe(false);
  });

  it('clears immediately when the minimum has already elapsed', () => {
    service.begin();
    jasmine.clock().tick(400);
    expect(service.active()).toBe(true);

    service.end();
    expect(service.active()).toBe(false);
  });

  it('force-clears at the safety ceiling when end() is never called', () => {
    service.begin();
    jasmine.clock().tick(15_000);

    // A missed end() must not leave a full-page overlay with no dismiss.
    expect(service.active()).toBe(false);
  });

  it('ignores end() when nothing is showing', () => {
    service.end();
    expect(service.active()).toBe(false);
  });

  it('tolerates a repeated end() while the minimum hold is pending', () => {
    service.begin();
    service.end();
    service.end();
    service.end();

    jasmine.clock().tick(400);
    expect(service.active()).toBe(false);
  });

  it('can run a second handoff after the first completes', () => {
    service.begin();
    service.end();
    jasmine.clock().tick(400);
    expect(service.active()).toBe(false);

    service.begin();
    expect(service.active()).toBe(true);
    service.end();
    jasmine.clock().tick(400);
    expect(service.active()).toBe(false);
  });

  it('does not restart the minimum when begin() is called twice', () => {
    service.begin();
    jasmine.clock().tick(200);
    service.begin();
    jasmine.clock().tick(200);

    // 400ms have passed since the FIRST begin, so end() clears at once.
    service.end();
    expect(service.active()).toBe(false);
  });

  it('cancels the safety timer once cleared, so it cannot disturb a later handoff', () => {
    service.begin();
    service.end();
    jasmine.clock().tick(400);
    expect(service.active()).toBe(false);

    // Start a second handoff and run past when the FIRST ceiling would have hit.
    jasmine.clock().tick(14_000);
    service.begin();
    jasmine.clock().tick(1_000);
    expect(service.active()).withContext('stale ceiling cleared a live handoff').toBe(true);
  });
});
