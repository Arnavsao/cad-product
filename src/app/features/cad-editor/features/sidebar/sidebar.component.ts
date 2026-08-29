import { Component, inject , ChangeDetectionStrategy
} from '@angular/core';

import { SafeHtmlPipe } from '../../shared/components/safe-html.pipe';

import { DrawerPanelId, WorkspacePanelService } from '../workspace-panel/workspace-panel.service';

interface SidebarBtn {
  id: Exclude<DrawerPanelId, null>;
  label: string;
  svg: string;
}

const BUTTONS: SidebarBtn[] = [
  {
    id: 'properties',
    label: 'Props',
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="14" height="14" rx="1.5"/><line x1="5" y1="6" x2="13" y2="6"/><line x1="5" y1="9" x2="13" y2="9"/><line x1="5" y1="12" x2="9" y2="12"/></svg>`
  },
  {
    id: 'layers',
    label: 'Layers',
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9 L9 5 L16 9 L9 13 Z"/><path d="M2 12 L9 16 L16 12" opacity="0.5"/><path d="M2 6 L9 2 L16 6" opacity="0.5"/></svg>`
  },
  {
    id: 'blocks',
    label: 'Blocks',
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="6" height="6" rx="0.5"/><rect x="10" y="2" width="6" height="6" rx="0.5"/><rect x="2" y="10" width="6" height="6" rx="0.5"/><rect x="10" y="10" width="6" height="6" rx="0.5"/></svg>`
  },
  {
    id: 'viewports',
    label: 'Views',
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="14" height="14" rx="1"/><rect x="5" y="5" width="8" height="8" rx="0.5" stroke-dasharray="2 1.5"/></svg>`
  },
  {
    id: 'library',
    label: 'Library',
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h3v11H3z"/><path d="M8 4h3v11H8z"/><path d="M13.5 4l2.5 1-3.5 10-2.5-1z"/></svg>`
  },
  {
    id: 'ai-agent',
    label: 'AI Agent',
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2 Q9 9 16 9 Q9 9 9 16 Q9 9 2 9 Q9 9 9 2z"/></svg>`
  },
  {
    id: 'l-section',
    label: 'L-section',
    svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 2 4 16 16 16"/></svg>`
  },
];

const SETTINGS_BTN: SidebarBtn = {
  id: 'settings' as any,
  label: 'Settings',
  svg: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="3"/><path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.22 3.22l1.41 1.41M13.37 13.37l1.41 1.41M3.22 14.78l1.41-1.41M13.37 4.63l1.41-1.41"/></svg>`
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cad-sidebar',
  standalone: true,
  imports: [SafeHtmlPipe],
  styles: [`:host { display: flex; flex-direction: column; height: 100%; }`],
  template: `
    <div class="cad-sidebar">
      @for (b of buttons; track b) {
        <button
          type="button"
          class="sb-btn"
          [class.active]="panelService.activePanel() === b.id"
          [title]="b.label"
          (click)="panelService.toggle(b.id)"
          >
          <span class="sb-icon" [innerHTML]="b.svg | safeHtml"></span>
          <span class="sb-label">{{ b.label }}</span>
        </button>
      }
    
      <div class="sidebar-spacer"></div>
    
      <button
        type="button"
        class="sb-btn"
        [class.active]="panelService.activePanel() === 'settings'"
        title="Settings"
        (click)="panelService.toggle('settings')"
        >
        <span class="sb-icon" [innerHTML]="settingsBtn.svg | safeHtml"></span>
        <span class="sb-label">{{ settingsBtn.label }}</span>
      </button>
    </div>
    `,
})
export class SidebarComponent {
  protected panelService = inject(WorkspacePanelService);

  readonly buttons = BUTTONS;
  readonly settingsBtn = SETTINGS_BTN;
}
