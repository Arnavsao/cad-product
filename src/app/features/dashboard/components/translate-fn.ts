/**
 * The reactive translate function lives in `core/i18n` now, so the editor,
 * the dashboard and the site all depend on one implementation. This module
 * stays so existing imports keep resolving.
 */
export { injectTranslateFn, type TranslateFn } from '../../../core/i18n/translate-fn';
