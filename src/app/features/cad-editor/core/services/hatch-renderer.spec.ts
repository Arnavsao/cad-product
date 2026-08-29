import { TestBed } from '@angular/core/testing';

import { HatchRendererService } from './hatch-renderer.service';

describe('HatchRendererService', () => {
  let service: HatchRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HatchRendererService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
