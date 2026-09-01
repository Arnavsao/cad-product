import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { HatchRendererService } from './hatch-renderer.service';

describe('HatchRendererService', () => {
  let service: HatchRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(HatchRendererService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
