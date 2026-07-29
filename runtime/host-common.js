// host-common.js — loader shared by standalone.html and tile.js.
//
// Fetches a dashboard definition (an HTML fragment) from the storage
// backend, injects it into the document, and lets the canvas-dashboard
// runtime upgrade the custom elements.
//
// The fragment may contain <script> tags (author callbacks + an optional
// inline <script id="canvas-data"> mock-data block). Scripts inserted via
// innerHTML do NOT execute, so the loader walks the parsed fragment and
// re-creates each <script> as a fresh element before appending.

(function () {
  // Fetch a canvas dashboard def by relative path and mount it.
  //   baseUrl  — '' is allowed (means same-origin relative paths).
  //   path     — path relative to baseUrl, e.g.
  //              "examples/_internal/hr_attrition/hr_attrition.canvasdashboard.html".
  //   container — element to inject the parsed HTML into.
  async function loadDashboard({ baseUrl, path, container }) {
    if (typeof baseUrl !== 'string' || !path || !container) {
      throw new Error('loadDashboard: baseUrl (string), path, container are required');
    }
    const url = `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) {
      throw new Error(`dashboard def ${path}: HTTP ${resp.status}`);
    }
    const text = await resp.text();
    injectHTML(container, text);
  }

  // Mount a canvas dashboard from inline HTML (no fetch). Used by the
  // Looker tile host (tile.js) after it reads the def back out of the
  // dashboard_element's body_text via the Extension SDK.
  function loadDashboardFromHTML({ html, container }) {
    if (typeof html !== 'string' || !container) {
      throw new Error('loadDashboardFromHTML: html (string) and container are required');
    }
    injectHTML(container, html);
  }

  // Parse `html` into a fragment, re-create script elements so they execute,
  // and append the fragment to `container`. External scripts (src=) load and
  // execute in document order; inline scripts execute synchronously.
  function injectHTML(container, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const frag = template.content;
    frag.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      for (const attr of oldScript.attributes) {
        newScript.setAttribute(attr.name, attr.value);
      }
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });
    container.appendChild(frag);
  }

  // Wire dashboard-internal cross-filtering. Listens for the click events
  // each chart dispatches (canvas-chart-click + canvas-chart-background-click)
  // and maintains a small map of active per-field cross-filters. The map is
  // owned by the caller (passed in as opts.map) so hosts that overlay
  // host-provided filters — e.g. tile.js merging Looker dashboard filters
  // with this map — can read it directly. After every change the shared
  // applyBroadcast callback fires; standalone can just push the map onto
  // the dashboard via setBroadcastFilters, while tile.js merges first.
  //
  //   applyBroadcast(localCrossFilters) — called after every change.
  //   opts.map        — existing map to mutate in-place (default: new {}).
  //   opts.onPointClick(detail, local)
  //                   — fires on canvas-chart-click (e.g. tile.js mirrors
  //                     to Looker via tileSDK.toggleCrossFilter).
  //   opts.onBackgroundClick(detail, local)
  //                   — fires on canvas-chart-background-click.
  //
  // Returns { localCrossFilters } — the map being mutated.
  function installCrossFiltering(canvasDashEl, applyBroadcast, opts) {
    opts = opts || {};
    const localCrossFilters = opts.map || {};

    canvasDashEl.addEventListener('canvas-chart-click', (e) => {
      const detail = e.detail || {};
      const chart = detail.chart;
      // Normalize to a predicate list. Charts that emit the new shape
      // include detail.predicates; legacy single-field clicks come through
      // as detail.field + detail.value.
      let predicates = Array.isArray(detail.predicates) && detail.predicates.length
        ? detail.predicates
        : null;
      if (!predicates && detail.field && detail.value != null) {
        predicates = [{ field: detail.field, value: detail.value }];
      }
      if (!predicates) return;
      const explore = (chart && chart.getAttribute && chart.getAttribute('explore')) || null;
      // Toggle vs set: if every predicate this click would set is already
      // active with the same value, the click is a clear (re-clicking the
      // same slice / bar). Otherwise set/replace each predicate's field.
      const allMatch = predicates.every(p => {
        const ex = localCrossFilters['__cf_' + p.field];
        return ex && String(ex.value) === String(p.value);
      });
      if (allMatch) {
        predicates.forEach(p => { delete localCrossFilters['__cf_' + p.field]; });
        if (chart && chart.setCrossFilterValue) chart.setCrossFilterValue(null);
      } else {
        predicates.forEach(p => {
          localCrossFilters['__cf_' + p.field] = {
            field: p.field,
            value: p.value,
            explore,
            model: null,
          };
        });
        if (chart && chart.setCrossFilterValue) {
          // Pass the whole predicate set so pies can highlight just the
          // clicked slice and column charts can still fade by category.
          chart.setCrossFilterValue({ predicates });
        }
      }
      if (opts.onPointClick) opts.onPointClick(detail, localCrossFilters);
      applyBroadcast(localCrossFilters);
    });

    canvasDashEl.addEventListener('canvas-chart-background-click', (e) => {
      const { field, chart } = e.detail || {};
      if (!field) return;
      const key = '__cf_' + field;
      if (!localCrossFilters[key]) return;
      delete localCrossFilters[key];
      if (chart && chart.setCrossFilterValue) chart.setCrossFilterValue(null);
      if (opts.onBackgroundClick) opts.onBackgroundClick(e.detail, localCrossFilters);
      applyBroadcast(localCrossFilters);
    });

    return { localCrossFilters };
  }

  window.canvasDashboard = window.canvasDashboard || {};
  window.canvasDashboard.loadDashboard = loadDashboard;
  window.canvasDashboard.loadDashboardFromHTML = loadDashboardFromHTML;
  window.canvasDashboard.installCrossFiltering = installCrossFiltering;
})();
