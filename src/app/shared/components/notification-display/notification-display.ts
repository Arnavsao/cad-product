import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationService, type NotificationType } from '../../../core/services/notification.service';
import { UiIconComponent, type UiIconName } from '../../ui/icon.component';

const ICON: Record<NotificationType, UiIconName> = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'help',
};

const TITLE: Record<NotificationType, string> = {
  success: 'Done',
  error: 'Something went wrong',
  warning: 'Heads up',
  info: 'Note',
};

/**
 * Toast stack, top-right.
 *
 * Each toast has a coloured rail and icon for its kind, a short title so the
 * kind is readable without relying on colour, the message, a dismiss button
 * and a progress bar that drains over the toast's lifetime. Hovering pauses
 * the countdown (and the bar); clicking anywhere on the toast dismisses it.
 * Errors are announced assertively, everything else politely.
 */
@Component({
  selector: 'app-notification-display',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent],
  template: `
    <div class="toasts">
      @for (n of notifications.notifications(); track n.id) {
        <div
          class="toast"
          [attr.data-type]="n.type"
          [class.toast--paused]="n.paused"
          [style.--toast-ms.ms]="n.duration"
          [attr.role]="n.type === 'error' ? 'alert' : 'status'"
          [attr.aria-live]="n.type === 'error' ? 'assertive' : 'polite'"
          (click)="notifications.remove(n.id)"
          (mouseenter)="notifications.pause(n.id)"
          (mouseleave)="notifications.resume(n.id)"
        >
          <span class="toast__rail" aria-hidden="true"></span>
          <span class="toast__icon" aria-hidden="true"><ui-icon [name]="iconFor(n.type)" [size]="15" [strokeWidth]="2.2" /></span>
          <div class="toast__body">
            <p class="toast__title">{{ titleFor(n.type) }}</p>
            <p class="toast__msg">{{ n.message }}</p>
          </div>
          <button type="button" class="toast__close" aria-label="Dismiss" (click)="notifications.remove(n.id); $event.stopPropagation()">
            <ui-icon name="close" [size]="14" />
          </button>
          <span class="toast__bar" aria-hidden="true"></span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toasts {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(380px, calc(100vw - 40px));
        pointer-events: none;
      }

      .toast {
        --toast-color: var(--ui-accent);
        --toast-tint: var(--ui-accent-tint);
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: start;
        gap: 12px;
        padding: 12px 12px 14px 16px;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-lg);
        background: color-mix(in srgb, var(--ui-surface-raised) 92%, transparent);
        backdrop-filter: blur(14px) saturate(1.2);
        -webkit-backdrop-filter: blur(14px) saturate(1.2);
        box-shadow: var(--ui-shadow-float);
        color: var(--ui-text);
        font: 400 var(--ui-text-sm) / 1.45 var(--ui-font);
        pointer-events: auto;
        cursor: pointer;
        overflow: hidden;
        animation: toast-in .42s var(--ui-ease-out) both;
        transition: border-color var(--ui-dur), transform var(--ui-dur) var(--ui-ease-out);
      }
      .toast:hover { border-color: var(--ui-border-strong); transform: translateX(-2px); }

      .toast[data-type='success'] { --toast-color: var(--ui-success); --toast-tint: var(--ui-success-tint); }
      .toast[data-type='error']   { --toast-color: var(--ui-danger);  --toast-tint: var(--ui-danger-tint); }
      .toast[data-type='warning'] { --toast-color: var(--ui-warning); --toast-tint: var(--ui-warning-tint); }

      .toast__rail {
        position: absolute;
        inset: 0 auto 0 0;
        width: 3px;
        background: var(--toast-color);
      }
      .toast__icon {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        margin-top: 1px;
        border-radius: var(--ui-radius-md);
        background: var(--toast-tint);
        color: var(--toast-color);
      }
      .toast__body { display: grid; gap: 2px; min-width: 0; }
      .toast__title {
        margin: 0;
        font-size: var(--ui-text-xs);
        font-weight: 600;
        letter-spacing: .06em;
        text-transform: uppercase;
        color: var(--toast-color);
      }
      .toast__msg {
        margin: 0;
        color: var(--ui-text-strong);
        overflow-wrap: anywhere;
      }
      .toast__close {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        margin: -2px -2px 0 0;
        border: 0;
        border-radius: var(--ui-radius-sm);
        background: transparent;
        color: var(--ui-text-dim);
        cursor: pointer;
        transition: background var(--ui-dur-fast), color var(--ui-dur-fast);
      }
      .toast__close:hover { background: var(--ui-hover); color: var(--ui-text-strong); }
      .toast__close:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }

      .toast__bar {
        position: absolute;
        left: 3px;
        right: 0;
        bottom: 0;
        height: 2px;
        background: var(--toast-color);
        opacity: .55;
        transform-origin: left;
        animation: toast-drain var(--toast-ms, 4000ms) linear forwards;
      }
      .toast--paused .toast__bar { animation-play-state: paused; }

      @keyframes toast-in {
        from { opacity: 0; transform: translateX(24px) scale(.97); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes toast-drain { to { transform: scaleX(0); } }

      @media (max-width: 600px) {
        .toasts { top: 12px; right: 12px; width: calc(100vw - 24px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast { animation: none; transition: none; }
        .toast__bar { animation: none; opacity: 0; }
      }
    `,
  ],
})
export class NotificationDisplayComponent {
  protected readonly notifications = inject(NotificationService);

  protected iconFor(type: NotificationType): UiIconName {
    return ICON[type];
  }
  protected titleFor(type: NotificationType): string {
    return TITLE[type];
  }
}
