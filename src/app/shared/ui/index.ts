/**
 * Design-system seed — barrel. Import primitives from '…/shared/ui'.
 * Styles: `tokens.scss` (`--ui-*`) and `ui.scss` (button/input/dialog chrome)
 * are pulled in once by src/styles.scss.
 */
export { UiButtonDirective, type UiButtonSize, type UiButtonVariant } from './button.directive';
export { UiInputDirective } from './input.directive';
export { UiCardComponent, type UiCardPadding } from './card.component';
export { UiEmptyStateComponent } from './empty-state.component';
export { UiSkeletonComponent } from './skeleton.component';
export { PAGE_SIZES, UiPaginatorComponent } from './paginator.component';
export { ICON_PATHS, UiIconComponent, type UiIconName } from './icon.component';
export { LOGO_TILE_PATHS, LOGO_VIEWBOX, UiLogoComponent } from './logo.component';
export { UiLogoLoaderComponent } from './logo-loader.component';
export { AccountButtonComponent } from './account-button.component';
export { UI_DIALOG_DATA, UiDialogRef, type UiDialogAction, type UiDialogData } from './dialog/ui-dialog-ref';
export { UiDialogComponent } from './dialog/ui-dialog.component';
export { UiDialogService, type UiChooseOptions, type UiConfirmOptions, type UiDialogConfig } from './dialog/ui-dialog.service';
export { UiMenuComponent, type UiMenuItem } from './menu/ui-menu.component';
export { UiMenuTriggerDirective, type UiMenuAlign } from './menu/ui-menu-trigger.directive';
export { RelativeTimePipe, relativeTime } from './pipes/relative-time.pipe';
export { FileSizePipe, formatFileSize } from './pipes/file-size.pipe';
