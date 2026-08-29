import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClerkService } from '../../core/auth/clerk.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';
import { AuthLayoutComponent } from './auth-layout.component';

/**
 * `/sign-up` and its Clerk sub-steps (`/sign-up/verify-email-address`, …).
 * Same lifecycle as SignInPage; new accounts continue to `/onboarding`.
 */
@Component({
  selector: 'app-sign-up',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthLayoutComponent, RouterLink, UiButtonDirective, UiIconComponent, UiSkeletonComponent],
  templateUrl: './sign-up.page.html',
  styleUrl: './auth-page.scss',
})
export class SignUpPage implements AfterViewInit, OnDestroy {
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
    this.clerk.mountSignUp(el);
    this.mounted = el;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.mounted) {
      this.clerk.unmountSignUp(this.mounted);
      this.mounted = null;
    }
  }

  protected retry(): void {
    location.reload();
  }
}
