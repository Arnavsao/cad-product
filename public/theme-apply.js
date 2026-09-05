// Runs at the end of <body>, once <body> exists: promotes the pending theme
// marker set by theme-init.js into the real `dark-theme` class the stylesheet
// keys on. External file for the same CSP reason as theme-init.js.
try {
  if (localStorage.getItem('theme') !== 'light') document.body.classList.add('dark-theme');
  document.documentElement.classList.remove('dark-theme-pending');
} catch (e) {}
