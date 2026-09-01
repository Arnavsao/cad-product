import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * Renders either the Terms of Service or Privacy Policy, picked by route
 * `data.doc`. Both are DRAFTS — see the banner in the template. They exist so
 * the product has *something* linked from the footer rather than a dead
 * link, not as reviewed legal text. Replace with counsel-reviewed copy
 * before relying on them.
 */
@Component({
  selector: 'app-legal-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.scss',
})
export class LegalPageComponent {
  protected readonly appName = environment.appName;
  protected readonly doc = (inject(ActivatedRoute).snapshot.data['doc'] as 'terms' | 'privacy') ?? 'terms';
}
