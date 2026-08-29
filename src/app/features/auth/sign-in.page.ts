import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClerkService } from '../../core/auth/clerk.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';
import { AuthLayoutComponent } from './auth-layout.component';

/**
 * `/sign-in` and every Clerk sub-step beneath it (`/sign-in/factor-one`, …).
 * Mounts Clerk's `<SignIn>` once the SDK is ready and unmounts it on destroy.
 * The host `<div>` is always in the DOM (hidden while loading) so the mount
 * target never depends on change detection having run after the `await`.
 */
@Component({
  selector: 'app-sign-in',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthLayoutComponent, RouterLink, UiButtonDirective, UiIconComponent, UiSkeletonComponent],
  templateUrl: './sign-in.page.html',
  styleUrl: './auth-page.scss',
})
export class SignInPage implements AfterViewInit, OnDestroy {
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
    this.clerk.mountSignIn(el);
    this.mounted = el;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.mounted) {
      this.clerk.unmountSignIn(this.mounted);
      this.mounted = null;
    }
  }

  /** A failed CDN/SDK load is only recoverable by a fresh page load. */
  protected retry(): void {
    location.reload();
  }
}
