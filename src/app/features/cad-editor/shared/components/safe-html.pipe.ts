import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Bypasses Angular's DomSanitizer for SVG/HTML strings used in [innerHTML] bindings.
 * Required because Angular strips SVG elements from innerHTML by default.
 *
 * Usage: <span [innerHTML]="svgString | safeHtml"></span>
 */
@Pipe({
  name: 'safeHtml',
  standalone: true,
})
export class SafeHtmlPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(value: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(value);
  }
}
