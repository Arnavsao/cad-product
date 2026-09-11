import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { environment } from '../../../environments/environment';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiRevealDirective } from '../../shared/ui/reveal.directive';
import { CURRENCY, TIERS } from '../pricing/pricing.data';
import { SiteClosingComponent } from '../site/components/closing.component';
import { SiteCtaComponent } from '../site/components/cta.component';
import { SiteExplorerComponent } from '../site/components/explorer.component';
import { SiteHeadingComponent } from '../site/components/heading.component';
import { SiteWorkflowComponent } from '../site/components/workflow.component';
import { AUDIENCES, FACTS } from '../site/data/site-content';
import { SiteCountUpDirective } from '../site/motion/count-up.directive';
import { STACK_LAYERS, SiteLayerStackComponent } from '../site/motion/layer-stack.component';
import { MotionService } from '../site/motion/motion.service';
import { SiteRevealDirective } from '../site/motion/reveal.directive';

/** Plan geometry, in the drafting sheet's own viewBox units. */
const SHEET_W = 960;
const SHEET_H = 600;
const PLAN_X0 = 140;
const PLAN_Y0 = 480;
const MM_PER_UNIT = 10;

/** The example the assistant section walks through. Prose fields are translation keys. */
const AI_EXAMPLE = {
  promptKey: 'site.home.ai.example.prompt',
  plan: [
    { id: 'select', labelKey: 'site.home.ai.example.select.label', detailKey: 'site.home.ai.example.select.detail' },
    { id: 'recolour', labelKey: 'site.home.ai.example.recolour.label', detailKey: 'site.home.ai.example.recolour.detail' },
    { id: 'risk', labelKey: 'site.home.ai.example.risk.label', detailKey: 'site.home.ai.example.risk.detail' },
  ],
};

/**
 * Public landing page (`/`), rendered inside the site shell.
 *
 * The hero pairs the pitch with a Three.js figure that explodes the drawing
 * into its layers as the page scrolls; the drafting sheet beneath it draws
 * itself in CSS (see `blueprint.scss`) with a live coordinate readout. Then the
 * page explains the product in the order a drawing goes through it: workflow,
 * command explorer, assistant, cloud saves, who it is for, what it costs.
 *
 * Signed-in visitors are forwarded to the dashboard; everything else paints
 * before auth has resolved.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButtonDirective,
    UiIconComponent,
    UiRevealDirective,
    SiteClosingComponent,
    SiteCtaComponent,
    SiteCountUpDirective,
    SiteExplorerComponent,
    SiteHeadingComponent,
    SiteLayerStackComponent,
    SiteRevealDirective,
    SiteWorkflowComponent,
  ],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class LandingPage implements AfterViewInit, OnDestroy {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);
  private readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly appName = environment.appName;
  protected readonly facts = FACTS;
  protected readonly audiences = AUDIENCES;
  protected readonly layers = STACK_LAYERS;
  protected readonly tiers = TIERS;
  protected readonly currency = CURRENCY;
  protected readonly ai = AI_EXAMPLE;

  /** 0..1 as the hero scrolls out; drives the 3D stack. */
  protected readonly stackProgress = signal(0);
  protected readonly activeLayer = computed(() =>
    Math.min(this.layers.length - 1, Math.floor(this.stackProgress() * (this.layers.length + 0.5))),
  );

  private readonly hero = viewChild<ElementRef<HTMLElement>>('hero');
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private readonly coordX = viewChild<ElementRef<HTMLElement>>('coordX');
  private readonly coordY = viewChild<ElementRef<HTMLElement>>('coordY');

  private frame = 0;
  private detach: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    effect(() => {
      if (this.auth.isLoaded() && this.auth.isSignedIn()) {
        void this.router.navigateByUrl('/dashboard', { replaceUrl: true });
      }
    });
  }

  ngAfterViewInit(): void {
    this.wireReadout();
    void this.wireHero();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.detach?.();
  }

  /**
   * Scroll → explode. The trigger spans from the top of the page to the point
   * where the hero has left, so the stack is a flat drawing on arrival and
   * fully separated by the time the reader reaches the next section. Under
   * reduced motion the figure renders its exploded state on its own.
   */
  private async wireHero(): Promise<void> {
    const hero = this.hero()?.nativeElement;
    if (!hero || this.motion.reduced()) return;
    const { ScrollTrigger } = await this.motion.load();
    if (this.destroyed) return;
    const trigger = ScrollTrigger.create({
      trigger: hero,
      start: 'top top',
      end: 'bottom 20%',
      onUpdate: (self) => this.stackProgress.set(self.progress),
    });
    this.destroyRef.onDestroy(() => trigger.kill());
  }

  /**
   * Live coordinate readout on the drafting sheet. Written straight to the two
   * text nodes: a pointer stream re-rendering the page on every move would be
   * change detection at input rate for two numbers nothing else depends on.
   */
  private wireReadout(): void {
    const sheet = this.sheet()?.nativeElement;
    const xEl = this.coordX()?.nativeElement;
    const yEl = this.coordY()?.nativeElement;
    if (!sheet || !xEl || !yEl) return;

    let pending: PointerEvent | null = null;
    const flush = (): void => {
      this.frame = 0;
      const event = pending;
      pending = null;
      if (!event) return;
      const rect = sheet.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const u = ((event.clientX - rect.left) / rect.width) * SHEET_W;
      const v = ((event.clientY - rect.top) / rect.height) * SHEET_H;
      xEl.textContent = ((u - PLAN_X0) * MM_PER_UNIT).toFixed(1);
      yEl.textContent = ((PLAN_Y0 - v) * MM_PER_UNIT).toFixed(1);
    };
    const onMove = (event: PointerEvent): void => {
      pending = event;
      this.frame ||= requestAnimationFrame(flush);
    };
    sheet.addEventListener('pointermove', onMove, { passive: true });
    this.detach = () => sheet.removeEventListener('pointermove', onMove);
  }

  protected priceOf(tier: (typeof TIERS)[number]): number {
    return tier.annual;
  }
}
