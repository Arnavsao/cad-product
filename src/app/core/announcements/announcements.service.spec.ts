import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import { AnnouncementsService } from './announcements.service';

const NOTICE = { id: 'a1', title: 'Maintenance', body: 'Back at 09:00.', kind: 'system' as const, linkUrl: null };

describe('AnnouncementsService', () => {
  let api: jasmine.SpyObj<HttpManagerService>;

  function build(): AnnouncementsService {
    api = jasmine.createSpyObj<HttpManagerService>('HttpManagerService', ['get']);
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: HttpManagerService, useValue: api }],
    });
    return TestBed.inject(AnnouncementsService);
  }

  beforeEach(() => localStorage.removeItem('cad.announcements.dismissed'));
  afterAll(() => localStorage.removeItem('cad.announcements.dismissed'));

  it('shows what the server returned', async () => {
    const service = build();
    api.get.and.returnValue(of([NOTICE]));
    await service.load();
    expect(service.visible().map((a) => a.id)).toEqual(['a1']);
  });

  it('hides a dismissed announcement', async () => {
    const service = build();
    api.get.and.returnValue(of([NOTICE]));
    await service.load();
    service.dismiss('a1');
    expect(service.visible()).toEqual([]);
  });

  it('remembers the dismissal for the next load', async () => {
    const first = build();
    api.get.and.returnValue(of([NOTICE]));
    await first.load();
    first.dismiss('a1');

    // A fresh instance, as a page reload would build.
    TestBed.resetTestingModule();
    const second = build();
    api.get.and.returnValue(of([NOTICE]));
    await second.load();
    expect(second.visible()).toEqual([]);
  });

  it('stays silent when the request fails', async () => {
    const service = build();
    api.get.and.returnValue(throwError(() => new Error('offline')));
    await service.load();
    // An announcement is the least important thing on the page; an error toast
    // about one would be worse than not seeing it.
    expect(service.visible()).toEqual([]);
  });
});
