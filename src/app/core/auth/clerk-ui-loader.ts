/**
 * Loader for Clerk's prebuilt UI bundle (`@clerk/ui`).
 *
 * Why a CDN script and not an npm import: since Clerk Core 3 the headless SDK
 * (`@clerk/clerk-js`, which we bundle) and the component UI (`@clerk/ui`) ship
 * separately. The UI is a ~1 MB React bundle that we only need on the sign-in,
 * sign-up and account pages, and Clerk serves it from the instance's own
 * Frontend API host — the same host `clerk-js` talks to — so loading it from
 * there keeps it out of our build entirely, lets Clerk patch it independently,
 * and mirrors exactly what the official vanilla-JS quickstart does.
 *
 * The bundle registers itself as `window.__internal_ClerkUICtor`; `clerk-js`
 * reads that global (and/or the `ui.ClerkUI` load option we pass explicitly).
 * The npm build of `clerk-js` does NOT fetch the UI on its own — only the CDN
 * build of `clerk.browser.js` does — which is why this file exists.
 */

const UI_MAJOR = '1';
const SCRIPT_ATTR = 'data-cad-clerk-ui';
const LOAD_TIMEOUT_MS = 15_000;

/**
 * Derive the Frontend API host from a publishable key. Clerk keys are
 * `pk_<env>_<base64(host + '$')>`, e.g. `pk_test_Y2xlcmsuZXhhbXBsZS5jb20k`
 * → `clerk.example.com`. Returns '' for a malformed key.
 */
export function frontendApiFromKey(pk: string): string {
  const encoded = (pk ?? '').trim().split('_')[2] ?? '';
  if (!encoded) return '';
  try {
    const decoded = atob(encoded);
    return decoded.endsWith('$') ? decoded.slice(0, -1) : decoded;
  } catch {
    return '';
  }
}

/** URL of the UI bundle for a given publishable key. */
export function clerkUiBundleUrl(pk: string): string {
  const host = frontendApiFromKey(pk);
  return host ? `https://${host}/npm/@clerk/ui@${UI_MAJOR}/dist/ui.browser.js` : '';
}

/** The constructor registered by the UI bundle, if it has loaded. Typed loosely: the concrete type lives in `@clerk/shared`, a transitive dependency we do not import directly. */
export function getClerkUiCtor(): unknown {
  return typeof window === 'undefined' ? undefined : (window as any).__internal_ClerkUICtor;
}

let pending: Promise<void> | null = null;

/**
 * Inject the `@clerk/ui` script tag and resolve once `window.__internal_ClerkUICtor`
 * exists. Idempotent: concurrent callers share one promise and a bundle that is
 * already present resolves immediately. Rejects on network failure, on a bundle
 * that loads but does not register, and after {@link LOAD_TIMEOUT_MS}.
 */
export function loadClerkUiBundle(pk: string): Promise<void> {
  if (getClerkUiCtor()) return Promise.resolve();
  if (pending) return pending;

  pending = new Promise<void>((resolve, reject) => {
    const src = clerkUiBundleUrl(pk);
    if (!src) {
      pending = null;
      reject(new Error('Invalid Clerk publishable key — cannot derive the Frontend API host.'));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const fail = (err: Error): void => {
      if (timer) clearTimeout(timer);
      script.remove();
      pending = null; // allow a retry
      reject(err);
    };

    // Reuse a tag left behind by an earlier attempt (e.g. a previous route) if it is still loading.
    const existing = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`);
    const script = existing ?? document.createElement('script');

    script.addEventListener('load', () => {
      if (timer) clearTimeout(timer);
      if (getClerkUiCtor()) resolve();
      else fail(new Error('Clerk UI bundle loaded but did not register itself.'));
    });
    script.addEventListener('error', () => fail(new Error(`Failed to load the Clerk UI bundle from ${src}.`)));
    timer = setTimeout(() => fail(new Error('Timed out loading the Clerk UI bundle.')), LOAD_TIMEOUT_MS);

    if (!existing) {
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.setAttribute(SCRIPT_ATTR, '');
      document.head.appendChild(script);
    }
  });

  return pending;
}
