import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../../core/services/http-manager.service';
import { UiButtonDirective, UiGridBackdropComponent, UiLogoComponent } from '../../shared/ui';

/**
 * Where the unsubscribe link in a product email lands.
 *
 * The token in the URL is what authorises it, so this works with no session —
 * which is the point: somebody unsubscribing is often somebody who has stopped
 * signing in. It is a POST behind a button rather than an action on page load,
 * because mail clients and security scanners pre-fetch links, and a GET here
 * would unsubscribe people who never clicked anything.
 */
@Component({
  selector: 'app-unsubscribe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiGridBackdropComponent, UiLogoComponent],
  template: `
    <ui-grid-backdrop />
    <main class="unsub">
      <ui-logo [size]="40" />

      @switch (state()) {
        @case ('ready') {
          <h1 class="unsub__title">Stop receiving product email?</h1>
          <p class="unsub__body">
            You will still get messages about your own account, like a drawing someone shares with you
            or a reply to something you wrote to us.
          </p>
          <button uiButton variant="primary" [disabled]="busy()" (click)="confirm()">Unsubscribe</button>
        }
        @case ('done') {
          <h1 class="unsub__title">Unsubscribed</h1>
          <p class="unsub__body">
            {{ email() }} will not receive product email from CADO again. If that was a mistake, write to
            us and we will put you back on.
          </p>
          <a uiButton variant="secondary" routerLink="/">Back to CADO</a>
        }
        @case ('invalid') {
          <h1 class="unsub__title">That link did not work</h1>
          <p class="unsub__body">
            It may have been cut short by your mail client. Write to us and we will unsubscribe you by
            hand.
          </p>
          <a uiButton variant="secondary" href="mailto:support@cado.website">Contact support</a>
        }
      }
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: var(--ui-bg);
        color: var(--ui-text);
      }
      .unsub {
        position: relative;
        z-index: 1;
        max-width: 32rem;
        margin: 0 auto;
        padding-block: 18vh var(--ui-space-6);
        padding-inline: var(--ui-space-5);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--ui-space-3);
      }
      .unsub__title {
        margin: var(--ui-space-2) 0 0;
        font-size: 26px;
        text-wrap: balance;
      }
      .unsub__body {
        margin: 0;
        color: var(--ui-text-dim);
        line-height: 1.6;
      }
    `,
  ],
})
export class UnsubscribePage {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(HttpManagerService);

  protected readonly state = signal<'ready' | 'done' | 'invalid'>('ready');
  protected readonly busy = signal(false);
  protected readonly email = signal('');

  protected async confirm(): Promise<void> {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('invalid');
      return;
    }

    this.busy.set(true);
    try {
      const result = await firstValueFrom(this.api.post<{ email: string }>('unsubscribe', { token }));
      this.email.set(result.email);
      this.state.set('done');
    } catch {
      this.state.set('invalid');
    } finally {
      this.busy.set(false);
    }
  }
}
