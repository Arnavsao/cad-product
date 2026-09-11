import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChildren } from '@angular/core';
import { TranslocoService, TranslocoDirective } from '@jsverse/transloco';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { WORKFLOW } from '../data/site-content';
import { MotionService } from '../motion/motion.service';
import { SiteRevealDirective } from '../motion/reveal.directive';

/**
 * "How a drawing moves through CADO": five steps that scroll past a sticky
 * command-line monitor. Whichever step is nearest the middle of the viewport is
 * the active one; the monitor types out that step's prompt and the progress
 * rail fills to it.
 *
 * `IntersectionObserver` rather than a ScrollTrigger pin: there is nothing to
 * scrub, only a discrete "which step is in view", and IO keeps working if the
 * animation library is slow to arrive. The typewriter is a plain interval and
 * is skipped under reduced motion (the full line renders at once).
 */
@Component({
  selector: 'site-workflow',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, UiIconComponent, SiteRevealDirective],
  template: `
    <div class="wf" *transloco="let t">
      <aside class="wf__monitor" siteReveal="left">
        <div class="wf__mon site-panel" aria-live="polite">
          <div class="wf__mon-bar">
            <span class="wf__mon-dots"><i></i><i></i><i></i></span>
            <span class="wf__mon-title">{{ t('site.components.workflow.commandLine') }}</span>
          </div>
          <div class="wf__mon-body">
            <p class="wf__mon-step">{{ t('site.components.workflow.stepOf', { index: current().index, total: steps.length }) }}</p>
            <p class="wf__mon-line"><span class="wf__mon-prompt" aria-hidden="true">&gt;</span> <span class="wf__mon-text">{{ typed() }}</span><span class="wf__caret" aria-hidden="true"></span></p>
            <ol class="wf__rail" [attr.aria-label]="t('site.components.workflow.progress')">
              @for (step of steps; track step.id; let i = $index) {
                <li class="wf__rail-step" [class.wf__rail-step--done]="i < activeIndex()" [class.wf__rail-step--on]="i === activeIndex()">
                  <button type="button" class="wf__rail-btn" (click)="jump(i)" [attr.aria-current]="i === activeIndex() ? 'step' : null">
                    <span class="wf__rail-dot"><ui-icon [name]="step.icon" [size]="12" /></span>
                    <span class="wf__rail-label">{{ t(step.titleKey) }}</span>
                  </button>
                </li>
              }
            </ol>
          </div>
        </div>
      </aside>

      <ol class="wf__steps">
        @for (step of steps; track step.id; let i = $index) {
          <li #stepEl class="wf__step" [class.wf__step--on]="i === activeIndex()" [attr.data-index]="i" siteReveal>
            <p class="wf__index">{{ step.index }}</p>
            <h3 class="wf__title">{{ t(step.titleKey) }}</h3>
            <p class="wf__body">{{ t(step.bodyKey) }}</p>
          </li>
        }
      </ol>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .wf {
        display: grid;
        grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
        gap: clamp(28px, 5vw, 80px);
        align-items: start;
      }
      .wf__monitor { position: sticky; top: calc(var(--site-header-h) + 24px); }
      .wf__mon { overflow: hidden; }
      .wf__mon-bar {
        display: flex; align-items: center; gap: 12px;
        height: 34px; padding: 0 12px;
        border-bottom: 1px solid var(--ui-border);
        background: color-mix(in srgb, var(--ui-surface-raised) 80%, var(--ui-bg));
      }
      .wf__mon-dots { display: inline-flex; gap: 6px; }
      .wf__mon-dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--ui-border-strong); opacity: .55; }
      .wf__mon-title { font: 500 var(--ui-text-xs) / 1 var(--ui-font-mono); color: var(--ui-text-dim); }
      .wf__mon-body { padding: 18px 18px 20px; }
      .wf__mon-step { margin: 0; font: 600 var(--ui-text-xs) / 1 var(--ui-font); letter-spacing: .12em; text-transform: uppercase; color: var(--ui-accent); }
      .wf__mon-line {
        display: flex; align-items: baseline; gap: 8px;
        min-height: 3.2em;
        margin: 14px 0 0;
        padding: 12px 14px;
        border-radius: var(--ui-radius-md);
        background: var(--ui-bg);
        border: 1px solid var(--ui-border);
        font: 500 var(--ui-text-sm) / 1.5 var(--ui-font-mono);
        color: var(--ui-text);
        overflow-wrap: anywhere;
      }
      .wf__mon-prompt { color: var(--ui-accent); }
      .wf__caret { display: inline-block; width: 7px; height: 1em; margin-left: 2px; background: var(--ui-accent); vertical-align: text-bottom; animation: cado-caret 1.1s steps(1, end) infinite; }
      @keyframes cado-caret { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }

      .wf__rail { list-style: none; margin: 18px 0 0; padding: 0; display: grid; }
      .wf__rail-step { position: relative; }
      .wf__rail-step:not(:last-child)::after {
        content: ''; position: absolute; left: 13px; top: 30px; bottom: -2px; width: 2px;
        background: var(--ui-border); transition: background var(--ui-dur-slow) var(--ui-ease-out);
      }
      .wf__rail-step--done::after { background: var(--ui-accent); }
      .wf__rail-btn {
        display: flex; align-items: center; gap: 12px; width: 100%;
        padding: 6px 4px; border: 0; background: transparent; text-align: left; cursor: pointer;
        color: var(--ui-text-dim); font: 500 var(--ui-text-sm) / 1.3 var(--ui-font);
        border-radius: var(--ui-radius-md);
      }
      .wf__rail-btn:hover { color: var(--ui-text-strong); }
      .wf__rail-btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .wf__rail-dot {
        display: grid; place-items: center; flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%;
        border: 2px solid var(--ui-border); background: var(--ui-surface); color: var(--ui-text-dim);
        transition: border-color var(--ui-dur) var(--ui-ease-out), background var(--ui-dur) var(--ui-ease-out), color var(--ui-dur) var(--ui-ease-out), transform var(--ui-dur) var(--ui-ease-out);
        position: relative; z-index: 1;
      }
      .wf__rail-step--done .wf__rail-dot { border-color: var(--ui-accent); color: var(--ui-accent); }
      .wf__rail-step--on .wf__rail-dot { border-color: var(--ui-accent); background: var(--ui-accent); color: var(--ui-on-accent); transform: scale(1.08); }
      .wf__rail-step--on .wf__rail-btn { color: var(--ui-text-strong); }

      .wf__steps { list-style: none; margin: 0; padding: 0; display: grid; gap: clamp(28px, 6vh, 64px); }
      .wf__step {
        padding: clamp(18px, 3vw, 28px) clamp(18px, 3vw, 28px);
        border-left: 2px solid var(--ui-border);
        transition: border-color var(--ui-dur-slow) var(--ui-ease-out), opacity var(--ui-dur-slow) var(--ui-ease-out);
        opacity: .55;
      }
      .wf__step--on { border-color: var(--ui-accent); opacity: 1; }
      .wf__index { margin: 0 0 8px; font: 600 var(--ui-text-xs) / 1 var(--ui-font-mono); letter-spacing: .16em; color: var(--ui-accent); }
      .wf__title { margin: 0; font-size: clamp(20px, 2.2vw, 26px); line-height: 1.2; font-weight: 700; letter-spacing: -.02em; color: var(--ui-text-strong); text-wrap: balance; }
      .wf__body { margin: 12px 0 0; font-size: var(--ui-text-base); line-height: 1.6; color: var(--ui-text-dim); text-wrap: pretty; }

      @media (max-width: 880px) {
        .wf { grid-template-columns: minmax(0, 1fr); }
        .wf__monitor { position: static; }
        .wf__rail { display: none; }
        .wf__step { opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .wf__caret { animation: none; }
        .wf__step, .wf__rail-dot, .wf__rail-step::after { transition: none; }
      }
    `,
  ],
})
export class SiteWorkflowComponent implements AfterViewInit {
  protected readonly steps = WORKFLOW;
  protected readonly activeIndex = signal(0);
  protected readonly current = computed(() => this.steps[this.activeIndex()]);
  private readonly transloco = inject(TranslocoService);
  protected readonly typed = signal(this.transloco.translate(WORKFLOW[0].promptKey));

  private readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stepEls = viewChildren<ElementRef<HTMLElement>>('stepEl');
  private timer: ReturnType<typeof setInterval> | null = null;

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    // Only the band around the viewport's middle counts, so exactly one step
    // is "in view" at a time as the reader scrolls.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = Number((entry.target as HTMLElement).dataset['index']);
          if (i !== this.activeIndex()) this.activate(i);
        }
      },
      { rootMargin: '-40% 0px -45% 0px', threshold: 0 },
    );
    for (const el of this.stepEls()) observer.observe(el.nativeElement);
    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      if (this.timer) clearInterval(this.timer);
    });
  }

  protected jump(i: number): void {
    const el = this.stepEls()[i]?.nativeElement;
    if (el) this.motion.scrollToElement(el, -Math.round(window.innerHeight * 0.42));
  }

  private activate(i: number): void {
    this.activeIndex.set(i);
    const text = this.transloco.translate(this.steps[i].promptKey);
    if (this.timer) clearInterval(this.timer);
    if (this.motion.reduced()) {
      this.typed.set(text);
      return;
    }
    let n = 0;
    this.typed.set('');
    this.timer = setInterval(() => {
      n += 2;
      this.typed.set(text.slice(0, n));
      if (n >= text.length && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, 18);
  }
}
