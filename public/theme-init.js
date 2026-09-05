// Runs in <head>, synchronously, before first paint: paints the persisted
// theme's background so the page never flashes the wrong colour. Dark is the
// default when nothing is saved.
//
// Lives in its own file rather than inline in index.html because the CSP
// (nginx.security-headers.conf) is `script-src 'self'` with no 'unsafe-inline':
// an inline <script> is silently blocked in production, so the theme class was
// never applied there while working in `ng serve`, which sends no CSP.
try {
  var bg = localStorage.getItem('cad.theme.bg');
  if (localStorage.getItem('theme') !== 'light') document.documentElement.classList.add('dark-theme-pending');
  if (bg && /^#[0-9a-f]{3,8}$/i.test(bg)) document.documentElement.style.background = bg;
} catch (e) {}
