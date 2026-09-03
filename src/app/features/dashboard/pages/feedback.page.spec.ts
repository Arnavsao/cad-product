import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { CreateFeedbackRequest, FeedbackDto } from '../../../core/api/api.models';
import { FeedbackApiService } from '../../../core/api/feedback-api.service';
import { FeedbackPage } from './feedback.page';

const SENT: FeedbackDto = {
  id: 'f1',
  kind: 'bug',
  rating: null,
  message: 'Trim leaves a stray vertex',
  email: null,
  createdAt: '2026-09-01T10:00:00.000Z',
};

describe('FeedbackPage', () => {
  let api: jasmine.SpyObj<FeedbackApiService>;
  let fixture: ComponentFixture<FeedbackPage>;
  let page: FeedbackPage & {
    message: { set(v: string): void };
    kind: { set(v: string): void };
    canSubmit(): boolean;
    sent(): boolean;
    error(): string | null;
    submit(): Promise<void>;
    setRating(v: number): void;
    rating(): number | null;
    again(): void;
  };

  const submitted = (): CreateFeedbackRequest => api.submit.calls.mostRecent().args[0];

  beforeEach(() => {
    api = jasmine.createSpyObj<FeedbackApiService>('FeedbackApiService', ['submit', 'listMine']);
    api.submit.and.resolveTo(SENT);
    TestBed.configureTestingModule({
      imports: [FeedbackPage],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FeedbackApiService, useValue: api },
        { provide: Router, useValue: { url: '/dashboard/feedback', navigateByUrl: jasmine.createSpy('navigateByUrl') } },
      ],
    });
    fixture = TestBed.createComponent(FeedbackPage);
    page = fixture.componentInstance as unknown as typeof page;
    fixture.detectChanges();
  });

  // ── validation ─────────────────────────────────────────────────────────────

  it('cannot submit an empty form', () => {
    expect(page.canSubmit()).toBeFalse();
  });

  it('cannot submit a message that is only whitespace', () => {
    page.message.set('      ');
    expect(page.canSubmit()).toBeFalse();
  });

  it('can submit once there is a real message', () => {
    page.message.set('Trim leaves a stray vertex');
    expect(page.canSubmit()).toBeTrue();
  });

  it('does not call the API when submit is invoked while invalid', async () => {
    page.message.set('   ');
    await page.submit();
    expect(api.submit).not.toHaveBeenCalled();
  });

  // ── payload ────────────────────────────────────────────────────────────────

  it('sends the trimmed message, the kind, and reproduction context', async () => {
    page.kind.set('idea');
    page.message.set('  A snap for tangents  ');
    await page.submit();

    const body = submitted();
    expect(body.message).toBe('A snap for tangents');
    expect(body.kind).toBe('idea');
    expect(body.context?.route).toBe('/dashboard/feedback');
    expect(body.context?.userAgent).toBeTruthy();
  });

  it('omits the rating entirely when the user did not give one', async () => {
    page.message.set('No stars from me');
    await page.submit();
    expect('rating' in submitted()).toBeFalse();
  });

  it('includes the rating when one was chosen', async () => {
    page.message.set('Pretty good');
    page.setRating(4);
    await page.submit();
    expect(submitted().rating).toBe(4);
  });

  it('clicking the selected star clears it, so a rating is never a one-way door', () => {
    page.setRating(3);
    expect(page.rating()).toBe(3);
    page.setRating(3);
    expect(page.rating()).toBeNull();
  });

  // ── outcome ────────────────────────────────────────────────────────────────

  it('shows the success state after sending', async () => {
    page.message.set('Trim leaves a stray vertex');
    await page.submit();
    expect(page.sent()).toBeTrue();
    expect(page.error()).toBeNull();
  });

  it('surfaces a failure and stays on the form so the text is not lost', async () => {
    api.submit.and.rejectWith(new Error('rate limited'));
    page.message.set('Trim leaves a stray vertex');
    await page.submit();

    expect(page.sent()).toBeFalse();
    expect(page.error()).toBe('rate limited');
  });

  it('"send another" clears the form rather than re-sending', async () => {
    page.message.set('Trim leaves a stray vertex');
    page.setRating(5);
    await page.submit();
    page.again();

    expect(page.sent()).toBeFalse();
    expect(page.canSubmit()).toBeFalse();
    expect(page.rating()).toBeNull();
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
});
