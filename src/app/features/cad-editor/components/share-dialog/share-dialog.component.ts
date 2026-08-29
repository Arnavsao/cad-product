import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-share-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './share-dialog.component.html',
  styleUrls: ['./share-dialog.component.scss']
})
export class ShareDialogComponent {
  readonly fileName = input<string>('Drawing');
  readonly close = output<void>();

  permission: 'READ' | 'EDIT' = 'READ';
  shareLink: string = '';
  isCopied: boolean = false;

  ngOnInit() {
    this.generateMockLink();
  }

  setPermission(perm: 'READ' | 'EDIT') {
    this.permission = perm;
    this.generateMockLink();
    this.isCopied = false;
  }

  generateMockLink() {
    // Generates a fake link that includes the permission for UI demonstration
    const base = window.location.origin + window.location.pathname;
    const randomId = Math.random().toString(36).substring(2, 10);
    this.shareLink = `${base}?shareId=${randomId}&perm=${this.permission.toLowerCase()}`;
  }

  copyLink() {
    navigator.clipboard.writeText(this.shareLink);
    this.isCopied = true;
    setTimeout(() => {
      this.isCopied = false;
    }, 2000);
  }

  onClose() {
    // TODO: The 'emit' function requires a mandatory void argument
    this.close.emit();
  }
}
