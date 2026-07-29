// host-standalone.js — entry script for the standalone preview host
// (runtime/standalone.html). Used as the local preview during dashboard
// authoring (the skill spins up serve.py and opens this page) and as
// the public preview for the example dashboards.
//
// URL params:
//   ?path=<relative>    Fetch a def at this path under window.location.origin.
//                       Most flexible; the skill uses this to preview drafts.
//   ?example=<name>     Shortcut for a known example dashboard. Currently:
//                         "hr-attrition"     → examples/_internal/hr_attrition/...
//                         "public-showcase"  → examples/public-showcase/...
//   ?base=<url>         Optional override for the base URL (the prefix the
//                       path is resolved against). Defaults to same-origin.

(function () {
  const params = new URLSearchParams(window.location.search);
  const baseUrl = params.get('base') || '';

  // Known example shortcuts so the dev URL stays short.
  const EXAMPLES = {
    'hr-attrition':
      'examples/_internal/hr_attrition/hr_attrition.canvasdashboard.html',
    'public-showcase':
      'examples/public-showcase/ecommerce.canvasdashboard.html',
  };

  let path = params.get('path');
  if (!path) {
    const example = params.get('example');
    if (example && EXAMPLES[example]) {
      path = EXAMPLES[example];
    }
  }

  if (!path) {
    document.body.textContent =
      '[standalone host: missing ?path=<relative-path> or ?example=<name> in URL]';
    document.body.style.cssText = 'padding:24px;color:#c33;font-family:sans-serif;';
    return;
  }

  window.canvasDashboard.loadDashboard({
    baseUrl,
    path,
    container: document.body,
  }).then(() => {
    // Wire up dashboard-internal cross-filtering. The standalone host
    // has no external filter source to merge with, so we just push the
    // active cross-filter map straight onto the dashboard.
    const dash = document.querySelector('canvas-dashboard');
    if (dash) {
      window.canvasDashboard.installCrossFiltering(dash, (local) => {
        dash.setBroadcastFilters({ ...local });
      });
    }
  }).catch(err => {
    console.error('standalone host loadDashboard:', err);
    const div = document.createElement('div');
    div.style.cssText = 'padding:24px;color:#c33;font-family:sans-serif;';
    div.textContent = '[failed to load dashboard: ' + err.message + ']';
    document.body.appendChild(div);
  });
})();
