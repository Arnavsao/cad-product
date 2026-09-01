import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { AiPreviewService } from './ai-preview.service';
import { ViewModelService } from '../../../core/services/view-model.service';

describe('AiPreviewService', () => {
  let svc: AiPreviewService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    svc = TestBed.inject(AiPreviewService);
  });

  it('starts with no preview', () => {
    expect(svc.hasPreview()).toBeFalse();
    expect(svc.activeIds().size).toBe(0);
  });

  it('shows the given ids and risk', () => {
    svc.show([1, 2, 3], 'destructive');
    expect(svc.hasPreview()).toBeTrue();
    expect(svc.activeIds().size).toBe(3);
    expect(svc.risk()).toBe('destructive');
  });

  it('ignores an empty id list', () => {
    svc.show([], 'review');
    expect(svc.hasPreview()).toBeFalse();
  });

  it('clears the preview', () => {
    svc.show([1, 2], 'safe');
    svc.clear();
    expect(svc.hasPreview()).toBeFalse();
    expect(svc.activeIds().size).toBe(0);
  });

  it('marks the view dirty when showing (so the canvas repaints)', () => {
    const vm = TestBed.inject(ViewModelService);
    vm.dirty = false;
    svc.show([5], 'review');
    expect(vm.dirty).toBeTrue();
  });

  it('render() is a no-op with no active ids', () => {
    const fakeCtx = jasmine.createSpyObj<CanvasRenderingContext2D>('ctx', ['save', 'restore', 'strokeRect', 'fillRect', 'setLineDash']);
    const fakeDoc = { activeFile: { entities: [] } } as never;
    svc.render(fakeCtx, fakeDoc);
    expect(fakeCtx.save).not.toHaveBeenCalled();
  });
});
