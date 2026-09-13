import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminFeedbackRowDto } from '../../../core/api/admin.models';
import { provideI18nTesting } from '../../../../testing/i18n-testing';
import { AdminFeedbackPage, statusLabel, statusTone } from './feedback.page';

function row(overrides: Partial<AdminFeedbackRowDto> = {}): AdminFeedbackRowDto {
  return {
    id: 'f1',
    kind: 'bug',
    status: 'new',
    rating: null,
    excerpt: 'The trim tool leaves a stray segment',
    fromEmail: 'reporter@example.com',
    fromUserId: null,
    fromName: null,
    assigneeId: null,
    assigneeEmail: null,
    appVersion: '1.1.0',
    repliedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('AdminFeedbackPage', () => {
  let api: jasmine.SpyObj<AdminApiService>;

  // The spy has to exist before each test stubs it, and the component must not
  // be created until it has — its constructor fetches immediately.
  beforeEach(() => {
    api = jasmine.createSpyObj<AdminApiService>('AdminApiService', ['listFeedback', 'feedbackExportUrl']);
    api.feedbackExportUrl.and.returnValue('/api/v1/admin/feedback/export.csv');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideI18nTesting(),
        { provide: AdminApiService, useValue: api },
      ],
    });
  });

  function build() {
    return TestBed.createComponent(AdminFeedbackPage);
  }

  /**
   * The page loads from an effect, so the fetch is still in flight when
   * `whenStable()` returns. Poll on a task until the component says it is done,
   * the same shape `profile.page.spec.ts` uses for its async browser work.
   */
  async function settle(done: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !done(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('defaults to the open work queue, not everything ever submitted', async () => {
    api.listFeedback.and.resolveTo({ items: [row()], nextCursor: null, total: 1 });
    const fixture = build();
    fixture.detectChanges();
    await settle(() => api.listFeedback.calls.count() >= 3);

    // "Open" is three statuses, so three calls — and none of them unfiltered.
    const statuses = api.listFeedback.calls.allArgs().map(([q]) => q?.status);
    expect(statuses.sort()).toEqual(['in_progress', 'new', 'triaged']);
  });

  it('merges the open statuses newest-first', async () => {
    api.listFeedback.and.callFake((query) =>
      Promise.resolve({
        items:
          query?.status === 'new'
            ? [row({ id: 'older', createdAt: '2026-09-01T00:00:00.000Z' })]
            : query?.status === 'in_progress'
              ? [row({ id: 'newer', createdAt: '2026-09-05T00:00:00.000Z' })]
              : [],
        nextCursor: null,
        total: 1,
      }),
    );
    const fixture = build();
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { rows(): AdminFeedbackRowDto[] };
    await settle(() => page.rows().length >= 2);

    expect(page.rows().map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('survives an API failure with an empty list rather than a broken page', async () => {
    api.listFeedback.and.rejectWith(new Error('offline'));
    const fixture = build();
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { rows(): AdminFeedbackRowDto[]; loading(): boolean };
    await settle(() => !page.loading());

    expect(page.rows()).toEqual([]);
    expect(page.loading()).toBe(false);
  });
});

describe('feedback status presentation', () => {
  it('makes only NEW visually urgent', () => {
    expect(statusTone('new')).toBe('warning');
    expect(statusTone('resolved')).toBe('success');
    expect(statusTone('wont_fix')).toBe('neutral');
  });

  it('spells the underscored statuses as words', () => {
    expect(statusLabel('in_progress')).toBe('in progress');
    expect(statusLabel('wont_fix')).toBe("won't fix");
    expect(statusLabel('new')).toBe('new');
  });
});
