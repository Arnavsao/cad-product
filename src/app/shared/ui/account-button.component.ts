import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { ClerkService } from '../../core/auth/clerk.service';
import { UiSkeletonComponent } from './skeleton.component';

/**
 * Hosts Clerk's `<UserButton>` (avatar → account menu). Renders nothing in
 * embedded mode, a circular skeleton while the SDK loads, and stays empty if
 * Clerk failed to load (the auth pages surface that error; a header widget
 * should not). Mount/unmount is tied to the view lifecycle so route changes
 * never leak a React root.
 */
@Component({
  selector: 'app-account-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiSkeletonComponent],
  template: `
    @if (clerk.enabled()) {
      @if (!clerk.isLoaded()) {
        <ui-skeleton width="32px" height="32px" circle />
      }
      <div #host class="acct-host" [class.acct-host--hidden]="!clerk.isLoaded()"></div>
    }
  `,
  styles: [
    `
      :host { display: inline-flex; align-items: center; min-width: 32px; min-height: 32px; }
      .acct-host { display: inline-flex; align-items: center; }
      .acct-host--hidden { position: absolute; width: 0; height: 0; overflow: hidden; }
    `,
  ],
})
export class AccountButtonComponent implements AfterViewInit, OnDestroy {
  protected readonly clerk = inject(ClerkService);
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  private mounted: HTMLDivElement | null = null;
  private destroyed = false;

  async ngAfterViewInit(): Promise<void> {
    if (!this.clerk.enabled()) return;
    await this.clerk.load();
    if (this.destroyed || this.clerk.loadError()) return;
    const el = this.host()?.nativeElement;
    if (!el) return;
    this.clerk.mountUserButton(el);
    this.mounted = el;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.mounted) {
      this.clerk.unmountUserButton(this.mounted);
      this.mounted = null;
    }
  }
}
