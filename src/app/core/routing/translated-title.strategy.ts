import { Injectable, effect, inject, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { environment } from '../../../environments/environment';
import { LanguageService } from '../i18n/language.service';

/**
 * Browser-tab titles that follow the UI language.
 *
 * A route's `title` is a translation key (`'dashboard.shell.nav.trash'`), not
 * English. Angular's default strategy would print the key verbatim, so this
 * one resolves it and formats it with the product name — and re-resolves it
 * when the language changes, which the default cannot do because it only runs
 * on navigation. Before this, the tab read "Trash · CADO" in every language.
 *
 * Two surfaces manage their own title and are left alone: the public site
 * (route `data.titleKey`, resolved by `SiteShellComponent` together with the
 * meta description) and the editor (drawing name and dirty marker, set from
 * `cad-editor.ts`). Both have routes with no `title`, so `buildTitle` yields
 * nothing and this strategy does not touch `document.title`. The editor route
 * carries the bare product name as its `title`; a key that does not resolve is
 * used literally, which is what makes that work without a special case.
 *
 * The language-change re-apply only fires while the title is still the one
 * this strategy last wrote. If a page has since set its own, that page owns
 * the tab and a language switch must not clobber it.
 */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly language = inject(LanguageService);

  /** The active route's title key, or null when the route has no `title`. */
  private key: string | null = null;
  /** What this strategy last wrote, so it can tell its own title from a page's. */
  private applied: string | null = null;

  constructor() {
    super();
    effect(() => {
      this.language.revision();
      untracked(() => {
        if (this.applied !== null && this.title.getTitle() === this.applied) this.apply();
      });
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key = this.buildTitle(snapshot) ?? null;
    if (this.key === null) {
      // The page owns its title from here on (site shell, editor).
      this.applied = null;
      return;
    }
    this.apply();
  }

  private apply(): void {
    if (this.key === null) return;
    const t = this.language.t();
    const appName = environment.appName;
    const page = t(this.key);
    // An unresolvable key comes back as itself; treat it as a literal title.
    // That is also how the editor's bare product-name title works.
    const next = page === this.key ? page : t('app.title.format', { page, appName });
    this.title.setTitle(next);
    this.applied = next;
  }
}
