import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import { CreateFeedbackRequest, FeedbackDto } from './api.models';

/**
 * Promise-returning client for `/feedback`.
 *
 * `POST` is reachable without a session (the server marks it `@OptionalAuth()`),
 * so this works signed out too — the submission is simply anonymous. The codes
 * worth branching on are 400 `VALIDATION_ERROR` (blank/too-long message, bad
 * email) and 429 `TOO_MANY_REQUESTS` (10 submissions per minute per IP).
 */
@Injectable({ providedIn: 'root' })
export class FeedbackApiService {
  private readonly api = inject(HttpManagerService);

  /** `POST /feedback` — records one submission. */
  submit(req: CreateFeedbackRequest): Promise<FeedbackDto> {
    return firstValueFrom(this.api.post<FeedbackDto>('feedback', req));
  }

  /** `GET /feedback/mine` — the caller's own submissions, newest first. Requires a session. */
  listMine(): Promise<FeedbackDto[]> {
    return firstValueFrom(this.api.get<FeedbackDto[]>('feedback/mine'));
  }
}
