import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import { FlagsService } from './flags.service';

describe('FlagsService', () => {
  let api: jasmine.SpyObj<HttpManagerService>;
  let flags: FlagsService;

  beforeEach(() => {
    api = jasmine.createSpyObj<HttpManagerService>('HttpManagerService', ['get']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: HttpManagerService, useValue: api },
      ],
    });
    flags = TestBed.inject(FlagsService);
  });

  it('reports what the server sent', async () => {
    api.get.and.returnValue(of([{ key: 'ai.enabled', enabled: false, payload: null }]));
    await flags.load();
    expect(flags.enabled('ai.enabled')).toBe(false);
  });

  it('falls back to the caller default for an unknown key', async () => {
    api.get.and.returnValue(of([]));
    await flags.load();
    expect(flags.enabled('never.heard.of.it', true)).toBe(true);
    expect(flags.enabled('never.heard.of.it', false)).toBe(false);
  });

  it('fails open when the request fails', async () => {
    api.get.and.returnValue(throwError(() => new Error('offline')));
    await flags.load();
    // A flags endpoint that is briefly down must not black out the product.
    expect(flags.enabled('ai.enabled', true)).toBe(true);
    expect(flags.loaded()).toBe(true);
  });

  it('loads once however many callers ask', async () => {
    api.get.and.returnValue(of([]));
    await Promise.all([flags.load(), flags.load(), flags.load()]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('re-reads on refresh', async () => {
    api.get.and.returnValue(of([{ key: 'ai.enabled', enabled: true, payload: null }]));
    await flags.load();
    api.get.and.returnValue(of([{ key: 'ai.enabled', enabled: false, payload: null }]));
    await flags.refresh();
    expect(flags.enabled('ai.enabled')).toBe(false);
  });

  it('exposes a structured payload', async () => {
    api.get.and.returnValue(of([{ key: 'maintenance.banner', enabled: true, payload: { text: 'Back at 9' } }]));
    await flags.load();
    expect(flags.payload<{ text: string }>('maintenance.banner')?.text).toBe('Back at 9');
  });
});
