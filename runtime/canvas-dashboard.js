// canvas-dashboard.js — minimal runtime for canvas dashboards.
// Supports: <canvas-dashboard>, <canvas-chart>, <canvas-kpi>, <canvas-text>,
//           <canvas-shape>, <canvas-filter>, <canvas-constraint>, <canvas-listen>.
// Absolute positioning only. Sync data lookup against a global
// <script type="application/json" id="canvas-data">.
//
// Filter model mirrors LookML dashboards:
//   <canvas-filter>     dashboard-only, user-facing UI control. Has a `name`
//                       (the handle <canvas-listen> references) decoupled from
//                       its default `field`.
//   <canvas-constraint> chart-only, hardcoded predicate AND'd into the
//                       chart's effective filter context. Always on, no UI.
//   <canvas-listen>     chart-only, wires a dashboard filter (by name) onto a
//                       field on this chart. With no `field=`, the listen
//                       defaults to the filter's own field.
//
// A chart's effective filter context = its constraints + every dashboard
// filter it listens to, projected onto the listened field. Charts that don't
// declare a <canvas-listen> for a filter do NOT respond to it (no broadcast).

// Public surface for hosts to swap in their own query runner. The default
// posts to a same-origin /api/query proxy (the standalone host on Cloud Run
// uses this). The Looker tile-extension host overrides queryRunner with one
// that calls run_inline_query via the Looker Extension SDK.
window.canvasDashboard = window.canvasDashboard || {};
if (!window.canvasDashboard.queryRunner) {
  window.canvasDashboard.queryRunner = async (query) => {
    const r = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });
    if (!r.ok) {
      // Read the structured error envelope serve.py returns:
      // { error_type, message, hint, suggested_action }. Fall back to
      // the older { error, detail } shape if a different proxy is in
      // front. r.statusText is the last resort.
      let body = {};
      try { body = await r.json(); } catch {}
      const text =
        body.message || body.detail || body.error || r.statusText || '';
      throw new Error(`HTTP ${r.status}: ${String(text).slice(0, 400)}`);
    }
    return r.json();
  };
}

(() => {
  // Number formatting vocabulary shared by <canvas-kpi> (`format=`),
  // <canvas-chart> series (`valueFormat`), and <canvas-grid> column defs
  // (`valueFormat`). See docs/canvas-dashboard-spec.md § Number formatting.
  // Authors must annotate numeric values; the runtime also installs a
  // safety net (≤2 decimals + thousands separator) for un-annotated charts
  // and grid columns so a forgetful agent doesn't ship `54.923823712`.
  function formatValue(v, fmt) {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    switch (fmt) {
      case 'int':
        return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
      case 'decimal1':
        return n.toFixed(1);
      case 'decimal2':
        return n.toFixed(2);
      case 'percent':
        // Measure already expressed as a percentage (e.g. 54.9 → "54.9%").
        return n.toFixed(1) + '%';
      case 'percent1':
        // Ratio (e.g. 0.549 → "54.9"). Multiply ×100, 1 decimal. No `%`
        // suffix for back-compat with existing KPI defs that append it
        // themselves via the unit attribute.
        return (n * 100).toFixed(1);
      case 'percent1-signed': {
        // Signed ratio (e.g. 0.034 → "+3.4", -0.034 → "-3.4"). For
        // period-over-period deltas; pair with `unit="%"` on the KPI.
        // Check the rounded value's sign, not the raw input — sub-threshold
        // inputs that round to display-zero must render unsigned, including
        // the toFixed "-0.0" case where the minus would otherwise survive.
        const pct = (n * 100).toFixed(1);
        if (Number(pct) === 0) return pct.replace('-', '');
        return Number(pct) > 0 ? '+' + pct : pct;
      }
      case 'percent2-signed': {
        const pct = (n * 100).toFixed(2);
        if (Number(pct) === 0) return pct.replace('-', '');
        return Number(pct) > 0 ? '+' + pct : pct;
      }
      case 'usd':
        return (n < 0 ? '-$' : '$')
          + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
      case 'usd2':
        return (n < 0 ? '-$' : '$')
          + Math.abs(n).toLocaleString('en-US', {
              minimumFractionDigits: 2, maximumFractionDigits: 2
            });
      default:
        return String(v);
    }
  }
  // Safety-net default for numeric values that arrive without a format
  // annotation. Caps at 2 decimals (stripping trailing zeros) and adds
  // thousands separators. Used by the Highcharts yAxis formatter and the
  // AG Grid numeric column default.
  function formatNumberDefault(n) {
    if (n == null || n === '') return '';
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n);
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  // For the AG Grid safety net: probe up to 25 rows and decide whether to
  // treat the column as numeric. Returns true as soon as a finite numeric
  // sample appears; non-numeric samples (placeholder strings like "N/A"
  // or "—") don't disqualify the column on their own — a footer/header
  // row followed by data rows is a common pattern.
  function inferNumeric(rows, field, valueGetter) {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    for (let i = 0; i < rows.length && i < 25; i++) {
      const row = rows[i];
      let v;
      if (valueGetter) {
        try { v = valueGetter({ data: row }); } catch { v = undefined; }
      } else if (field) {
        v = row && row[field];
      }
      if (v == null || v === '') continue;
      if (typeof v === 'boolean') continue;
      if (typeof v === 'number' && Number.isFinite(v)) return true;
      if (typeof v === 'string' && v.trim() !== ''
          && Number.isFinite(Number(v))) return true;
    }
    return false;
  }
  // HTML-escape for safe interpolation into tooltip innerHTML. Series
  // names can flow from row data (categoryField on funnel/treemap/pie
  // pivots), so they're not author-trusted the way the def's static
  // markup is. Five chars is sufficient — Highcharts tooltips use
  // innerHTML, no attribute-context interpolation.
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // Expose so authors who write a custom Highcharts formatter can call into
  // the same vocabulary without re-implementing it.
  window.canvasDashboard.formatValue = formatValue;
  // Install global Highcharts language defaults once. Default `thousandsSep`
  // is the empty string — that's why raw numeric axis labels render as
  // `1234567.89`. Has to run before any chart is constructed.
  //
  // Note: Highcharts exposes `lang` only at the global level, so this is
  // necessarily a process-global mutation. Inside the tile-extension
  // iframe (the production path) that's scoped to our own Highcharts
  // instance. In the standalone preview, any other Highcharts chart on
  // the same page picks up these en-US separators — acceptable since
  // the standalone host is dev-only.
  if (typeof Highcharts !== 'undefined' && Highcharts.setOptions) {
    Highcharts.setOptions({
      lang: { thousandsSep: ',', decimalPoint: '.' }
    });
  }

  // Resolved lazily: the dashboard def is injected after this script loads
  // (hosts fetch the def, inject it, then custom elements upgrade). The
  // <script id="canvas-data"> block lives inside the def. Read it the first
  // time we need it.
  let _DATA = null;
  function getData() {
    if (_DATA !== null) return _DATA;
    const el = document.getElementById('canvas-data');
    if (!el) return (_DATA = {});
    try { return (_DATA = JSON.parse(el.textContent)); }
    catch (e) { console.error('canvas-data parse', e); return (_DATA = {}); }
  }

  // Highcharts option keys whose value is a callback function.
  // Maintain this list as new Highcharts callbacks are needed —
  // there's no programmatic way to derive it from Highcharts itself.
  const HC_CALLBACK_KEYS = new Set([
    // formatters
    'formatter', 'labelFormatter', 'pointFormatter',
    'pointDescriptionFormatter', 'seriesDescriptionFormatter',
    // chart / generic events
    'load', 'render', 'redraw', 'selection', 'click',
    'addSeries', 'beforePrint', 'afterPrint',
    // series + point events
    'mouseOver', 'mouseOut', 'select', 'unselect',
    'hide', 'show', 'legendItemClick',
    'afterAnimate', 'checkboxClick', 'remove', 'update',
    // axis events
    'setExtremes', 'afterSetExtremes',
    // NOTE: drilldown/drillup/drillupall are intentionally absent — the
    // Highcharts drilldown module isn't loaded by any host, so a def
    // using them would hard-fail at mount. Re-add alongside the module
    // + a drill recipe.
    // misc
    'callback'
  ]);

  // Walk a parsed Highcharts options object. For each value at a known
  // callback key that is a string, resolve it as a dotted identifier path
  // on `window` and replace with the actual function. Unresolved
  // references throw — they must be fixed by the author.
  function resolveCallbacks(node, pathPrefix) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (node[i] && typeof node[i] === 'object') {
          resolveCallbacks(node[i], `${pathPrefix}[${i}]`);
        }
      }
      return node;
    }
    if (!node || typeof node !== 'object') return node;
    for (const k of Object.keys(node)) {
      const v = node[k];
      const here = pathPrefix ? `${pathPrefix}.${k}` : k;
      if (HC_CALLBACK_KEYS.has(k) && typeof v === 'string') {
        const fn = v.split('.').reduce((o, p) => (o == null ? o : o[p]), window);
        if (typeof fn !== 'function') {
          throw new Error(
            `callback "${v}" at "${here}" must resolve to a function on window`
          );
        }
        node[k] = fn;
      } else if (v && typeof v === 'object') {
        resolveCallbacks(v, here);
      }
    }
    return node;
  }

  // HTML sanitizer for <canvas-text>. Allowlist of tags + attrs.
  // Standard HTML event handler attributes (onclick, onchange, …) pass
  // through and the browser handles them natively.
  const ALLOWED_TAGS = new Set([
    // text / structure
    'B','I','EM','STRONG','U','BR','SPAN','DIV','P','H1','H2','H3','H4',
    'UL','OL','LI','SMALL','HR',
    // form elements
    'LABEL','INPUT','SELECT','OPTION','OPTGROUP','TEXTAREA','BUTTON',
    'FIELDSET','LEGEND','FORM'
  ]);
  const ALLOWED_ATTRS = new Set([
    'class','style','id','title','tabindex','role',
    // form attrs
    'type','name','value','checked','selected','disabled','readonly','required',
    'for','placeholder','min','max','step','multiple','size','rows','cols',
    'autocomplete','pattern',
    // a11y
    'aria-label','aria-hidden','aria-checked','aria-selected',
    // event handlers — standard HTML semantics
    'onclick','ondblclick','onchange','oninput','onfocus','onblur',
    'onkeydown','onkeyup','onkeypress',
    'onmouseover','onmouseout','onmousedown','onmouseup','onmousemove',
    'onpointerdown','onpointerup','onpointermove',
    'onsubmit','onreset'
  ]);
  function isAllowedAttr(name) {
    return ALLOWED_ATTRS.has(name) || name.startsWith('data-');
  }
  function sanitize(node) {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 1) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          return;
        }
        [...child.attributes].forEach(a => {
          if (!isAllowedAttr(a.name)) child.removeAttribute(a.name);
        });
        sanitize(child);
      } else if (child.nodeType === 8) {
        child.remove();
      }
    });
  }

  // --- shared id helpers ---------------------------------------------------
  function newId(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }

  // Notify the surrounding dashboard that a chart/grid finished
  // rendering (success or empty). Used to update the "Updated <time>"
  // footer when the dashboard opts in via data-show-refreshed.
  function notifyRefreshed(chartEl) {
    const dash = chartEl.closest && chartEl.closest('canvas-dashboard');
    if (!dash || typeof dash._onChildRefreshed !== 'function') return;
    dash._onChildRefreshed(chartEl);
  }

  // Format a Date as "5s ago" / "12m ago" / "2h ago" / a local time string.
  function formatRelative(ts) {
    if (!ts) return '';
    const delta = (Date.now() - ts) / 1000;
    if (delta < 5) return 'just now';
    if (delta < 60) return Math.floor(delta) + 's ago';
    if (delta < 3600) return Math.floor(delta / 60) + 'm ago';
    if (delta < 86400) return Math.floor(delta / 3600) + 'h ago';
    return new Date(ts).toLocaleString();
  }

  // --- <canvas-dashboard> --------------------------------------------------
  // Holds a name-keyed map of user-facing filters. Each filter has a value
  // that <canvas-listen> blocks read at chart query time.
  class CanvasDashboard extends HTMLElement {
    connectedCallback() {
      const w = parseInt(this.getAttribute('width')) || 1450;
      const h = parseInt(this.getAttribute('height')) || 977;
      this.style.position = 'relative';
      this.style.display = 'block';
      this.style.transformOrigin = 'top left';
      this._intrinsic = { w, h };
      this._initFilters();
      // In tile mode, charts wait for this promise before their first
      // query so they see broadcast filters from the start. The host
      // (tile.js) resolves it by calling setBroadcastFilters() — even
      // with an empty spec if the dashboard config lookup failed.
      // In standalone mode there are no broadcasts; resolve immediately.
      const isTileMode =
        document.body && document.body.dataset && document.body.dataset.context === 'tile';
      if (isTileMode) {
        this._broadcastReadyPromise = new Promise(r => {
          this._broadcastReadyResolve = r;
        });
        // Safety: if the host never calls setBroadcastFilters within 5s,
        // unblock so the dashboard at least renders without broadcasts.
        setTimeout(() => {
          if (this._broadcastReadyResolve) {
            console.warn('[canvas-dashboard] broadcast-ready timed out; rendering without broadcast filters');
            this._broadcastReadyResolve();
            this._broadcastReadyResolve = null;
          }
        }, 5000);
      }
      // Watch the mobile breakpoint. When it changes, swap the dashboard
      // into stacked mode (one tile per row, each scaled to fit the
      // viewport width). CSS handles the show/hide of non-tile elements
      // and the basic flex layout; we compute per-tile scale here because
      // each tile may have a different intrinsic width.
      this._mq = window.matchMedia('(max-width: 600px)');
      // Named handlers so disconnectedCallback can remove them. Anonymous
      // arrows would leak across detach/reattach (hot-reload during
      // authoring, SPA route changes).
      this._mqHandler = () => this._applyViewport();
      this._mq.addEventListener('change', this._mqHandler);
      this._applyViewport();
      // Re-run on the next frame: child <canvas-tile> elements are defined
      // *after* <canvas-dashboard> in this script, so their
      // connectedCallback (which builds the inner wrapper used for mobile
      // scaling) hasn't fired yet on first load. Without this, a refresh
      // while in mobile mode would scale tiles via the no-wrapper fallback
      // (double-applies the transform) and produce a different layout from
      // a manual resize. rAF fires after all synchronous upgrades complete.
      requestAnimationFrame(() => this._applyViewport());
      this._resizeHandler = () => {
        if (this._mq.matches) this._layoutMobile();
        else this._scaleDesktop();
      };
      window.addEventListener('resize', this._resizeHandler);

      // Global 'R' key refreshes every chart/grid in the dashboard.
      // Ignored when the user is typing in an input or contenteditable.
      this._keydownHandler = (e) => {
        if (e.key !== 'r' && e.key !== 'R') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        const tag = t && t.tagName;
        if (t && (t.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
        e.preventDefault();
        this.refreshAll();
      };
      window.addEventListener('keydown', this._keydownHandler);

      // Optional "Updated <relative time>" footer. Opt in via
      // `data-show-refreshed="1"` on <canvas-dashboard>.
      if (this.getAttribute('data-show-refreshed') === '1' ||
          this.getAttribute('data-show-refreshed') === 'true') {
        this._mountRefreshedFooter();
      }
    }

    // Refresh every chart and grid in this dashboard. Triggered by the
    // global 'R' shortcut and by <canvas-refresh> clicks.
    refreshAll() {
      this.querySelectorAll('canvas-chart, canvas-grid').forEach(c => {
        if (typeof c.refresh === 'function') {
          try { c.refresh(); } catch (e) { /* surface via _showError already */ }
        }
      });
    }

    _onChildRefreshed(chartEl) {
      this._lastChildRefreshedAt = Date.now();
      if (this._refreshedFooter) {
        this._refreshedFooter.textContent =
          'Updated ' + formatRelative(this._lastChildRefreshedAt);
      }
    }

    _mountRefreshedFooter() {
      const f = document.createElement('div');
      f.className = 'cd-refreshed-footer';
      // Start blank — "Updated just now" before any child has loaded
      // would mislead viewers during the initial fetch. The footer
      // is populated by _onChildRefreshed once a real success arrives.
      f.textContent = '';
      this.appendChild(f);
      this._refreshedFooter = f;
      // Tick every 15s so the relative time stays current.
      this._refreshedTicker = setInterval(() => {
        if (this._lastChildRefreshedAt && this._refreshedFooter) {
          this._refreshedFooter.textContent =
            'Updated ' + formatRelative(this._lastChildRefreshedAt);
        }
      }, 15000);
    }

    disconnectedCallback() {
      if (this._keydownHandler) {
        window.removeEventListener('keydown', this._keydownHandler);
      }
      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
      }
      if (this._mq && this._mqHandler) {
        this._mq.removeEventListener('change', this._mqHandler);
      }
      if (this._refreshedTicker) {
        clearInterval(this._refreshedTicker);
      }
    }
    _applyViewport() {
      if (this._mq.matches) {
        this.setAttribute('data-viewport', 'mobile');
        this.style.width = '100%';
        this.style.height = 'auto';
        this.style.overflow = 'visible';
        this.style.transform = 'none';
        this._layoutMobile();
      } else {
        this.setAttribute('data-viewport', 'desktop');
        const { w, h } = this._intrinsic;
        this.style.width = w + 'px';
        this.style.height = h + 'px';
        this.style.overflow = 'hidden';
        // Clear per-tile mobile transforms and re-apply desktop box geometry
        // from x/y/width/height attributes. The tile's inner wrapper (if
        // any) is also reset.
        this.querySelectorAll('canvas-tile, :scope > canvas-chart').forEach(t => {
          t.style.transform = '';
          if (t._inner) t._inner.style.transform = '';
          applyBox(t);
        });
        this._scaleDesktop();
      }
    }
    _scaleDesktop() {
      const { w, h } = this._intrinsic;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const s = Math.min(vw / w, vh / h, 1);
      this.style.transform = s < 1 ? `scale(${s})` : 'none';
    }
    // Per-tile scaling for mobile: the outer tile box is sized to the
    // post-scale dimensions (so flex column allocates the right space),
    // and the inner wrapper (created in CanvasTile.connectedCallback)
    // holds the intrinsic-sized content and gets `transform: scale()` —
    // its visual shrinks into the smaller outer box.
    _layoutMobile() {
      const margin = 8;
      const targetW = Math.max(this.clientWidth - margin * 2, 200);
      this.querySelectorAll(':scope > canvas-tile, :scope > canvas-chart').forEach(tile => {
        if (tile.tagName === 'CANVAS-CHART' && tile.closest('canvas-tile')) return;
        const intrinsicW = parseFloat(tile.getAttribute('width')) || targetW;
        const intrinsicH = parseFloat(tile.getAttribute('height')) || 200;
        const scale = targetW / intrinsicW;
        tile.style.width  = (intrinsicW * scale) + 'px';
        tile.style.height = (intrinsicH * scale) + 'px';
        tile.style.transform = '';
        if (tile._inner) {
          tile._inner.style.transform = `scale(${scale})`;
        } else {
          // Orphan chart / no wrapper: scale the element directly. Will
          // still over-allocate flex space (transform doesn't change
          // layout box) but at least renders correctly.
          tile.style.transformOrigin = 'top left';
          tile.style.transform = `scale(${scale})`;
        }
      });
    }
    _initFilters() {
      if (!this._filters) this._filters = new Map();   // name → filter spec
    }
    _registerFilterEl(el, filter) {
      this._initFilters();
      filter._el = el;
      this._filters.set(filter.name, filter);
    }
    addFilter(spec) {
      this._initFilters();
      const f = normalizeFilter(spec || {});
      this._filters.set(f.name, f);
      return f.name;
    }
    removeFilter(name) {
      this._initFilters();
      const f = this._filters.get(name);
      if (!f) return false;
      this._filters.delete(name);
      if (f._el && f._el.parentNode) f._el.parentNode.removeChild(f._el);
      return true;
    }
    setFilter(name, value) {
      this._initFilters();
      const f = this._filters.get(name);
      if (!f) return false;
      f.value = value;
      // If the UI input exists, sync it.
      if (f._input && f._input.value !== String(value)) {
        f._input.value = value;
      }
      // Re-query every chart that listens to this filter.
      this.querySelectorAll('canvas-chart, canvas-grid').forEach(c => {
        if (typeof c.refresh !== 'function' || !c._listens) return;
        for (const l of c._listens.values()) {
          if (l.filter === name) { c.refresh(); break; }
        }
      });
      return true;
    }
    getFilters() {
      this._initFilters();
      return Array.from(this._filters.values()).map(f => {
        const { _el, _input, ...clean } = f;
        return clean;
      });
    }
    getFilter(name) {
      this._initFilters();
      const f = this._filters.get(name);
      if (!f) return null;
      const { _el, _input, ...clean } = f;
      return clean;
    }
    // --- broadcast filters ------------------------------------------------
    // Filters injected by a host (today: the Looker tile-extension host
    // pushing dashboard-level filters via tile.js). Each entry is keyed by
    // the host's own filter name (e.g. the Looker dashboard filter name) and
    // carries the LookML field, value, and the model/explore the filter
    // targets so CanvasChart.getEffectiveFilters() can scope the broadcast
    // to the right charts. Replacing the set with a new spec triggers a
    // refresh on every explore-bound chart/grid.
    setBroadcastFilters(spec) {
      const newMap = new Map();
      for (const [name, f] of Object.entries(spec || {})) {
        if (!f || !f.field) continue;
        newMap.set(name, {
          name,
          field: f.field,
          condition: f.condition || 'equals',
          value: f.value !== undefined ? f.value : '',
          model: f.model || null,
          explore: f.explore || null,
        });
      }
      // Stable signature of (name, field, value) tuples so we can skip
      // refreshing when the host re-pushes the same data (Looker fires
      // tileHostDataChangedCallback on every window-focus, not just on
      // actual filter changes).
      const sig = (m) => JSON.stringify(
        [...m.entries()]
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([k, v]) => [k, v.field, String(v.value)])
      );
      const oldSig = this._broadcastFilters ? sig(this._broadcastFilters) : null;
      const newSig = sig(newMap);
      this._broadcastFilters = newMap;
      // First call unblocks deferred initial queries. Don't refresh —
      // the charts haven't queried yet and will pick up broadcasts on
      // their first query.
      if (this._broadcastReadyResolve) {
        this._broadcastReadyResolve();
        this._broadcastReadyResolve = null;
        return;
      }
      // Subsequent calls: only refresh charts whose effective filters
      // actually changed. The source of a cross-filter doesn't change
      // its own effective filters (broadcasts on a chart's own
      // categoryField are skipped), so it shouldn't re-query.
      if (oldSig === newSig) return;
      this.querySelectorAll('canvas-chart, canvas-grid').forEach(c => {
        if (typeof c.refresh !== 'function') return;
        const nowSig = JSON.stringify(c.getEffectiveFilters());
        if (c._lastEffectiveFiltersSig === nowSig) return;
        c._lastEffectiveFiltersSig = nowSig;
        c.refresh();
      });
    }
    getBroadcastFilters() {
      return Array.from((this._broadcastFilters || new Map()).values());
    }
  }
  customElements.define('canvas-dashboard', CanvasDashboard);

  function normalizeFilter(spec) {
    if (!spec.name) throw new Error('canvas-filter: name is required');
    return {
      name: spec.name,
      label: spec.label || spec.name,
      field: spec.field || '',
      condition: spec.condition || 'equals',
      value: spec.default !== undefined ? spec.default
           : spec.value   !== undefined ? spec.value
           : '',
      ui: spec.ui || 'text',
      values: Array.isArray(spec.values) ? spec.values
            : (typeof spec.values === 'string' && spec.values
                ? spec.values.split(',').map(s => s.trim())
                : []),
      allowMultiple: !!spec.allowMultiple,
      required: !!spec.required
    };
  }

  // Common: absolute positioning from x/y/width/height attrs.
  // If the element is enclosed in a <canvas-tile>, x/y are treated as
  // dashboard-relative and translated into tile-relative left/top so
  // authors can keep one coordinate system across the dashboard.
  function applyBox(el) {
    el.style.position = 'absolute';
    const x = el.getAttribute('x');
    const y = el.getAttribute('y');
    // Walk up to find an enclosing canvas-tile (may be wrapped inside a
    // .cd-tile-inner div that the tile creates at mount time).
    let p = el.parentElement;
    while (p && p.tagName !== 'CANVAS-TILE' && p.tagName !== 'CANVAS-DASHBOARD') {
      p = p.parentElement;
    }
    const inTile = p && p.tagName === 'CANVAS-TILE';
    const tileX = inTile ? parseFloat(p.getAttribute('x') || '0') : 0;
    const tileY = inTile ? parseFloat(p.getAttribute('y') || '0') : 0;
    if (x !== null) el.style.left = (parseFloat(x) - tileX) + 'px';
    if (y !== null) el.style.top  = (parseFloat(y) - tileY) + 'px';
    const w = el.getAttribute('width'); if (w !== null) el.style.width = w + 'px';
    const h = el.getAttribute('height'); if (h !== null) el.style.height = h + 'px';
  }

  // Walk up the tree to find the enclosing <canvas-dashboard>.
  function findDashboard(el) {
    let p = el.parentElement;
    while (p && p.tagName !== 'CANVAS-DASHBOARD') p = p.parentElement;
    return p;
  }

  // --- <canvas-chart> ------------------------------------------------------
  // Holds two lists: constraints (hardcoded predicates) and listens (filter
  // wiring). Both are populated by child <canvas-constraint>/<canvas-listen>
  // elements at connect time, plus the JS API.
  class CanvasChart extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      applyBox(this);
      this.style.display = 'block';
      this._constraints = new Map();   // id → { field, condition, value }
      this._listens     = new Map();   // id → { filter, field? }
      // Two mutually-exclusive binding modes:
      //   query="<id>"     — bind to a saved query (existing prototype path).
      //   explore="<name>" — bind to a Looker explore; the actual query is
      //                      composed at runtime from explore + the chart's
      //                      effective filter context and executed via the
      //                      host-provided queryRunner (Extension SDK in
      //                      tile mode, /api/query proxy in standalone).
      const qid = this.getAttribute('query');
      this._exploreName = this.getAttribute('explore');
      if (qid && this._exploreName) {
        console.warn(
          `canvas-chart#${this.id || '<no id>'}: both query and explore are set; using query`
        );
      }
      // Find inline options JSON.
      const optsScript = this.querySelector('script[type="application/json"]');
      if (!optsScript) { this.textContent = '[canvas-chart: no options]'; return; }
      let opts;
      try { opts = JSON.parse(optsScript.textContent); }
      catch (e) { console.error('canvas-chart options parse', e); this.textContent = '[canvas-chart: bad JSON]'; return; }
      // (Callbacks are resolved per-render inside _render() so the
      // template stays JSON-cloneable — `structuredClone` chokes on
      // function values.)
      // Mount container — set up once, drive content below.
      optsScript.remove();
      const mount = document.createElement('div');
      mount.style.width = '100%';
      mount.style.height = '100%';
      this.appendChild(mount);
      this._mount = mount;
      // Keep the parsed, callback-resolved options as the "template" we
      // re-derive from on every render. refresh() and setCategoryField()
      // mutate this template and re-render.
      this._optsTemplate = opts;
      this._qid = qid;
      this._render();
    }
    // Re-render the chart using the current template. Safe to call any
    // number of times — destroys the prior Highcharts instance first.
    refresh() {
      this._render();
    }
    // Update the xAxis category field (e.g. switching the trend chart
    // from attrited_month → attrited_week) and re-render.
    setCategoryField(field) {
      this._optsTemplate.xAxis = this._optsTemplate.xAxis || {};
      this._optsTemplate.xAxis.categoryField = field;
      // The sort default in _buildLookerQuery follows the categoryField.
      this._render();
    }
    _render() {
      // Deep-clone the template so each render starts fresh — _bindRows
      // consumes categoryField / queryField, and we want those back next
      // time. The template is plain JSON; callbacks are resolved into
      // function values on the cloned copy below.
      const opts = structuredClone(this._optsTemplate);
      try { resolveCallbacks(opts, ''); }
      catch (e) {
        console.error(e);
        this._showError(this._mount, e.message);
        return;
      }
      this._applyDefaults(opts);
      this._destroyVisual();
      // Dispatch on binding mode.
      const data = getData();
      if (this._qid && data[this._qid]) {
        this._mountFromRows(data[this._qid], opts);
      } else if (this._exploreName) {
        this._bindLookerExplore(opts, this._mount);  // async; mounts when done
      } else {
        this._mountFromRows([], opts);
      }
    }
    // --- visual hooks (overridden by CanvasGrid) -----------------------
    // Apply library-specific option defaults (Highcharts here).
    _applyDefaults(opts) {
      opts.chart = Object.assign({
        backgroundColor: 'transparent',
        spacing: [4, 4, 4, 4],
        style: { fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' }
      }, opts.chart || {});
      opts.credits = Object.assign({ enabled: false }, opts.credits || {});
      opts.title = opts.title || { text: null };
      opts.exporting = Object.assign({ enabled: false }, opts.exporting || {});
      this._applyNumberFormatDefaults(opts);
      this._installCrossFilterClick(opts);
    }
    // Safety net: when the author hasn't supplied an axis/tooltip/dataLabel
    // formatter, install one that caps decimals at 2 and adds thousands
    // separators. Authors who DO supply their own win — we only fill in what
    // is missing. Combined with the per-series `valueFormat` injection in
    // _bindRows, this is what fixes "54.923823712" and "1234567.89" for the
    // common un-annotated case.
    _applyNumberFormatDefaults(opts) {
      const safety = function () { return formatNumberDefault(this.value); };
      safety._canvasSafetyNet = true;
      // Only fill in a yAxis when the author didn't write one at all. An
      // explicit `yAxis: null` or `yAxis: []` is the author signaling "no
      // axis" (e.g. nested-pie compositions) — don't fabricate one.
      if (opts.yAxis === undefined) {
        opts.yAxis = { labels: { formatter: safety } };
      } else {
        const axes = Array.isArray(opts.yAxis) ? opts.yAxis : [opts.yAxis];
        axes.forEach(ax => {
          if (!ax) return;
          ax.labels = ax.labels || {};
          if (ax.labels.format == null && ax.labels.formatter == null) {
            ax.labels.formatter = safety;
          }
        });
      }
      // Default tooltip formatter — caps at ≤2 decimals with thousands
      // separators. Highcharts' built-in valueDecimals doesn't carry
      // thousand separators (would emit "1234567.00"), so we install a
      // pointFormatter instead. Author-supplied tooltip configuration
      // wins; we only fill in fully un-annotated charts.
      opts.tooltip = opts.tooltip || {};
      if (opts.tooltip.valueDecimals == null
          && opts.tooltip.formatter == null
          && opts.tooltip.pointFormatter == null
          && opts.tooltip.pointFormat == null) {
        opts.tooltip.pointFormatter = function () {
          // Funnel/treemap/pyramid use `this.value`; XY series use `this.y`.
          const v = this.y != null ? this.y : this.value;
          const color = this.color || 'currentColor';
          const name = escapeHtml(this.series.name);
          return `<span style="color:${color}">●</span> `
            + `${name}: <b>${formatNumberDefault(v)}</b><br/>`;
        };
      }
    }
    // Default point-click handler — dispatches a 'canvas-chart-click'
    // custom event on this <canvas-chart> with the {field, value} that
    // was clicked. The runtime stays library-agnostic; hosts (e.g. the
    // Looker tile extension) wire this event to dashboard filter
    // updates.
    //
    // Resolution of the emitted (field, value) at click time:
    //   1. If the clicked point has a category (column/bar/line), use
    //      (xAxis.categoryField, point.category).
    //   2. Otherwise — typical of pies pinned to a single category via
    //      a <canvas-constraint> — fall back to the chart's first
    //      constraint's (field, value). This lets the dept/gender
    //      donuts emit e.g. department=R&D when clicked.
    //
    // Skips installation if neither hook is wired up (no categoryField
    // AND no constraint child), or if the author has already provided
    // plotOptions.series.events.click (their handler always wins).
    _installCrossFilterClick(opts) {
      const ax = opts.xAxis;
      const fallbackField = (ax && ax.categoryField) || null;
      const hasConstraintChild = !!this.querySelector('canvas-constraint');
      if (!fallbackField && !hasConstraintChild) return;
      opts.plotOptions = opts.plotOptions || {};
      opts.plotOptions.series = opts.plotOptions.series || {};
      opts.plotOptions.series.events = opts.plotOptions.series.events || {};
      const chartEl = this;
      if (!opts.plotOptions.series.events.click) {
        opts.plotOptions.series.events.click = function (event) {
          const point = event && event.point;
          // Build the compound predicate set this click represents.
          // Two sources contribute, in order:
          //   1. The "what was clicked" axis:
          //       - column/bar/line → (categoryField, point.category)
          //       - single-row chart (pie pinned by constraints) → use
          //         ALL the chart's own constraints as the predicates
          //   2. The "which slice" annotation (point.options.crossFilter)
          //      — pie slices declare this in their data spec so a click
          //      on the dark slice can add e.g. is_attrited=No on top of
          //      the chart's dept=R&D pin.
          const predicates = [];
          const cat = point && point.category;
          if (cat != null && fallbackField) {
            predicates.push({ field: fallbackField, value: String(cat) });
          } else if (cat == null) {
            chartEl.getConstraints().forEach(c => {
              if (c.field && c.value != null && c.value !== '') {
                predicates.push({ field: c.field, value: c.value });
              }
            });
          }
          const slice = point && point.options && point.options.crossFilter;
          if (slice && slice.field && slice.value != null) {
            predicates.push({ field: slice.field, value: slice.value });
          }
          if (!predicates.length) return;
          chartEl.dispatchEvent(new CustomEvent('canvas-chart-click', {
            bubbles: true,
            detail: {
              // Compound predicate list — preferred by hosts.
              predicates,
              // Back-compat single-field detail. Hosts that haven't been
              // updated to read `predicates` keep working in the simple
              // (column/bar) case.
              field: predicates[0].field,
              value: String(predicates[0].value),
              chart: chartEl,
              // Highcharts passes the original MouseEvent through as
              // event.point.event or event itself (depending on the
              // series type). Hosts that need it for popup positioning
              // (e.g. Looker's toggleCrossFilter) read it from here.
              mouseEvent: (event && (event.point && event.point.event)) || event
            }
          }));
        };
      }
      // Background click on the chart (anywhere outside a point) clears
      // the cross-filter that originated from this chart. The target
      // check distinguishes point clicks from plot-area clicks — point
      // clicks are handled by the series.events.click above; chart.click
      // also fires for those and we don't want to double-fire.
      opts.chart = opts.chart || {};
      opts.chart.events = opts.chart.events || {};
      if (!opts.chart.events.click) {
        opts.chart.events.click = function (event) {
          const tgt = event && event.target;
          const tgtClass = (tgt && tgt.getAttribute && tgt.getAttribute('class')) || '';
          if (/highcharts-point/.test(tgtClass)) return;
          let field = fallbackField;
          if (!field) {
            const cs = chartEl.getConstraints();
            if (cs.length) field = cs[0].field;
          }
          if (!field) return;
          chartEl.dispatchEvent(new CustomEvent('canvas-chart-background-click', {
            bubbles: true,
            detail: { field, chart: chartEl }
          }));
        };
      }
    }
    _destroyVisual() {
      if (this._hcInstance) {
        try { this._hcInstance.destroy(); } catch {}
        this._hcInstance = null;
      }
    }
    _mountFromRows(rows, opts) {
      this._bindRows(rows, opts);
      this._hcInstance = Highcharts.chart(this._mount, opts);
      this._applyCrossFilterVisual();
      this._lastRefreshedAt = Date.now();
      this._installExportMenu();
      notifyRefreshed(this);
    }
    // Per-tile export menu. A small `…` button overlays the chart;
    // clicking opens PNG / CSV / Copy options. Reuses Highcharts'
    // bundled `exporting`/`offline-exporting` modules for client-side
    // PNG rendering — no Highcharts export server, no upload.
    _installExportMenu() {
      // Skip if the author opted out.
      if (this.hasAttribute('no-export')) return;
      // Re-show the button if it was hidden during loading/error.
      if (this._exportBtn) {
        this._exportBtn.style.display = '';
        return;
      }
      // No actions available (e.g. chart's empty-result render — no
      // _hcInstance to export from). Skip the kebab so clicking it
      // can't open an empty dropdown.
      if (this._exportMenuItems().length === 0) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cd-tile-menu-btn';
      btn.setAttribute('aria-label', 'Tile menu');
      btn.title = 'Tile menu';
      btn.textContent = '⋯';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleExportMenu();
      });
      this._getMenuHost().appendChild(btn);
      this._exportBtn = btn;
    }
    // Where to mount the kebab + dropdown. When this chart/grid is the
    // sole exportable child of a <canvas-tile>, mount on the tile so the
    // kebab sits in the tile's header row (top-right of the card) instead
    // of overlaying the chart's plot area. Multi-chart tiles
    // (e.g. hr_attrition donut clusters) keep per-chart kebabs.
    _getMenuHost() {
      const tile = this.closest('canvas-tile');
      if (!tile) return this;
      const exportable = tile.querySelectorAll('canvas-chart, canvas-grid');
      return exportable.length === 1 ? tile : this;
    }
    _hideExportButton() {
      if (this._exportBtn) this._exportBtn.style.display = 'none';
      if (this._exportMenu) {
        this._exportMenu.remove();
        this._exportMenu = null;
      }
    }
    _toggleExportMenu() {
      if (this._exportMenu) {
        this._exportMenu.remove();
        this._exportMenu = null;
        return;
      }
      const items = this._exportMenuItems();
      if (items.length === 0) return;
      const menu = document.createElement('div');
      menu.className = 'cd-tile-menu';
      items.forEach(it => {
        const li = document.createElement('button');
        li.type = 'button';
        li.className = 'cd-tile-menu-item';
        li.textContent = it.label;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          try { it.action(); } catch (err) { console.error('export:', err); }
          if (this._exportMenu) {
            this._exportMenu.remove();
            this._exportMenu = null;
          }
        });
        menu.appendChild(li);
      });
      this._getMenuHost().appendChild(menu);
      this._exportMenu = menu;
      // Close on outside click.
      const onDocClick = (e) => {
        if (!menu.contains(e.target) && e.target !== this._exportBtn) {
          menu.remove();
          this._exportMenu = null;
          document.removeEventListener('click', onDocClick, true);
        }
      };
      setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
    }
    _exportMenuItems() {
      const items = [];
      if (this._hcInstance && typeof this._hcInstance.exportChartLocal === 'function') {
        items.push({
          label: 'Download',
          action: () => this._hcInstance.exportChartLocal({
            type: 'image/png',
            filename: (this.id || 'canvas-chart'),
          }),
        });
      }
      return items;
    }
    // Set the visual-selection value for this chart. Non-matching points
    // fade to indicate the active cross-filter. Pass null/undefined to
    // clear the selection. The value persists across refreshes — every
    // _mountFromRows re-applies it on the new chart instance.
    //
    // Accepted shapes:
    //   - null               → clear
    //   - string             → legacy single-category value (column/bar)
    //   - { predicates: [{field, value}, ...] }
    //                        → compound (pie slices, and any chart that
    //                          emits the new `predicates` shape)
    setCrossFilterValue(value) {
      if (value == null) {
        this._crossFilterValue = null;
      } else if (typeof value === 'object' && Array.isArray(value.predicates)) {
        this._crossFilterValue = value;
      } else {
        this._crossFilterValue = String(value);
      }
      this._applyCrossFilterVisual();
    }
    _applyCrossFilterVisual() {
      if (!this._hcInstance) return;
      // _crossFilterValue is either:
      //   - null  → no cross-filter active; all points back to opacity 1
      //   - { predicates: [...] }  → compound cross-filter (pie slices, or
      //     any chart that emits via the new predicates path); a point
      //     stays at full opacity if it "represents" one of the predicates
      //   - string (legacy)  → single category value, matches point.category
      const sel = this._crossFilterValue;
      const predicates = sel && sel.predicates;
      this._hcInstance.series.forEach(s => {
        if (s.type === 'pie') {
          // Pies fade by per-slice crossFilter annotation. Slices without
          // an annotation are non-matchable; leave them at full opacity so
          // they don't visually disappear.
          s.points.forEach(p => {
            const cf = p.options && p.options.crossFilter;
            let op = 1;
            if (cf && predicates && predicates.length) {
              const match = predicates.some(pr =>
                pr.field === cf.field && String(pr.value) === String(cf.value));
              op = match ? 1 : 0.2;
            }
            if (p.opacity !== op) p.update({ opacity: op }, false);
          });
          return;
        }
        // Column/bar/line: fade by category match. Resolve the active
        // category value from either the new predicates shape (look for a
        // predicate whose field matches a category-bearing axis) or the
        // legacy string form.
        const catVal = sel == null
          ? null
          : (typeof sel === 'string' ? sel
              : (predicates && predicates.length ? String(predicates[0].value) : null));
        s.points.forEach(p => {
          const op = (catVal == null || String(p.category) === catVal) ? 1 : 0.2;
          if (p.opacity !== op) p.update({ opacity: op }, false);
        });
      });
      this._hcInstance.redraw(false);
    }
    // Consume an author-supplied `valueFormat` on a series. Wires up a
    // tooltip pointFormatter, a dataLabels formatter (if data labels are
    // enabled), and stashes the format on the series so a chart-wide
    // yAxis formatter can read it for axes with exactly one series.
    // Author-supplied tooltip/dataLabel formatters always win.
    _applySeriesValueFormat(s, opts) {
      if (!s || !s.valueFormat) return;
      const fmt = s.valueFormat;
      // Non-XY series (funnel/treemap/pyramid/packedbubble/wordcloud)
      // carry their category on `series.categoryField`; XY series put
      // it on `xAxis.categoryField`. Non-XY points have no x-axis
      // label, so the data label is the only place the category name
      // can appear — prepend it.
      const isNonXY = !!s.categoryField;
      this._seriesFormats = this._seriesFormats || [];
      this._seriesFormats.push(fmt);
      const hasAuthorTooltip = s.tooltip
        && (s.tooltip.pointFormatter || s.tooltip.formatter
            || s.tooltip.pointFormat != null
            || s.tooltip.valueDecimals != null);
      // Funnel/treemap/pyramid series expose the point's value as
      // `this.value`; XY series (column/line/area) expose it as `this.y`.
      // Prefer y, fall back to value, so the same formatter shape works
      // across chart types.
      if (!hasAuthorTooltip) {
        s.tooltip = Object.assign({}, s.tooltip || {}, {
          pointFormatter: function () {
            const raw = this.y != null ? this.y : this.value;
            const v = formatValue(raw, fmt);
            const color = this.color || 'currentColor';
            const name = escapeHtml(this.series.name);
            return `<span style="color:${color}">●</span> ${name}: <b>${v}</b><br/>`;
          }
        });
      }
      // dataLabels can be enabled on the series itself or — more commonly,
      // per the recipe templates — on `plotOptions.<chartType>.dataLabels`.
      // Check both so authors who put styling under plotOptions still get
      // the auto-injected formatter.
      const chartType = s.type || (opts && opts.chart && opts.chart.type);
      const plotDL = chartType && opts && opts.plotOptions
        && opts.plotOptions[chartType] && opts.plotOptions[chartType].dataLabels;
      const seriesDL = s.dataLabels;
      // Highcharts merges series dataLabels over plotOptions per-key.
      // Mirror that: a series `enabled: false` wins; a series with other
      // keys but no `enabled` falls back to plotOptions.
      const enabled = seriesDL && 'enabled' in seriesDL
        ? seriesDL.enabled
        : (plotDL && plotDL.enabled);
      const hasFormatter = (seriesDL && seriesDL.formatter)
        || (plotDL && plotDL.formatter);
      if (enabled && !hasFormatter) {
        // Set the formatter at the series level; Highcharts merges series
        // dataLabels over plotOptions so styling on plotOptions is preserved.
        s.dataLabels = Object.assign({}, seriesDL || {}, {
          formatter: function () {
            const raw = this.y != null ? this.y : this.value;
            const v = formatValue(raw, fmt);
            const name = this.point && this.point.name;
            if (isNonXY && v && name != null && name !== '') {
              return escapeHtml(name) + ': ' + v;
            }
            return v;
          }
        });
      }
      delete s.valueFormat;
    }
    // Map an array of row objects (keyed by view-qualified field names)
    // into Highcharts series.data + xAxis.categories. Shared between the
    // mock data-query path and the live Looker explore path.
    _bindRows(rows, opts) {
      this._seriesFormats = [];
      opts.series = (opts.series || []).map(s => {
        this._applySeriesValueFormat(s, opts);
        if (s.data === undefined && s.queryField && s.categoryField) {
          // Series-level categoryField + queryField → emit per-point
          // {name, y, value} objects. Used by chart types that don't
          // have an xAxis (funnel, pyramid, treemap, packedbubble,
          // wordcloud). Both `y` and `value` are populated so the
          // same shape works for Highcharts series that expect either
          // (treemap uses `value`, funnel uses `y`).
          s.data = rows.map(r => ({
            name: r[s.categoryField],
            y: r[s.queryField],
            value: r[s.queryField],
          }));
          delete s.queryField;
          delete s.categoryField;
        } else if (s.data === undefined && s.queryField) {
          s.data = rows.map(r => r[s.queryField]);
          delete s.queryField;
        } else if (s.data === undefined && s.queryFields) {
          s.data = rows.map(r => s.queryFields.map(f => r[f]));
          delete s.queryFields;
        } else if (s.data === undefined) {
          s.data = rows.map(r => r.value !== undefined ? r.value : r);
        } else if (Array.isArray(s.data) && rows.length > 0) {
          // Per-point queryField: when the author writes explicit data
          // points with a queryField on each, fill in the .y from the
          // (first) row's field. Useful for the one-row-many-slices
          // pattern (e.g. a pie filtered to a single category, with
          // each slice pulled from a different measure).
          const row = rows[0];
          s.data = s.data.map(d => {
            if (d && typeof d === 'object' && typeof d.queryField === 'string') {
              const { queryField, ...rest } = d;
              return { ...rest, y: row[queryField] };
            }
            return d;
          });
        }
        return s;
      });
      const ax = opts.xAxis;
      if (ax && ax.categoryField) {
        ax.categories = rows.map(r => r[ax.categoryField]);
        delete ax.categoryField;
      }
      // If EVERY series on a single-axis chart shares one valueFormat,
      // promote that format to the yAxis label formatter. Beats the
      // safety-net ≤2-decimal formatter for the common single-measure-per-
      // chart case (e.g. a revenue chart wants "$1,234" axis ticks, not
      // "1,234"). Guards:
      //   - skip multi-axis charts (yAxis is an array) — each series
      //     targets a specific axis and we can't tell from here which
      //     format goes where.
      //   - skip when only SOME series carry valueFormat — the un-
      //     annotated series might be a count on the same axis, and a
      //     usd label would be wrong for it.
      const fmts = this._seriesFormats;
      const allSeriesAnnotated =
        fmts && opts.series && fmts.length === opts.series.length;
      if (allSeriesAnnotated
          && fmts.length
          && fmts.every(f => f === fmts[0])
          && !Array.isArray(opts.yAxis)
          && opts.yAxis) {
        const fmt = fmts[0];
        const a = opts.yAxis;
        a.labels = a.labels || {};
        // Replace the safety-net formatter (installed in _applyDefaults)
        // when the author has not provided their own format/formatter.
        const isSafetyNet = a.labels.formatter
          && a.labels.formatter._canvasSafetyNet;
        if (a.labels.format == null
            && (a.labels.formatter == null || isSafetyNet)) {
          a.labels.formatter = function () { return formatValue(this.value, fmt); };
        }
      }
    }
    // explore="<view>": synthesize an inline Looker query from the
    // chart's option fields + effective filter context, POST it to the
    // local proxy at /api/query, then mount Highcharts with the result.
    async _bindLookerExplore(opts, mount) {
      this._showLoading(mount);
      // Custom-element upgrade order: <canvas-chart> is defined before
      // <canvas-constraint> and <canvas-listen>, so our connectedCallback
      // fires while our children are still HTMLUnknownElements. Wait for
      // the next task tick — by then all defines have completed, child
      // elements have run their own connectedCallback, and our filter
      // state is fully populated.
      await new Promise(r => setTimeout(r, 0));
      // In tile mode the host (tile.js) needs a moment to look up the
      // Looker dashboard's filter definitions and push them as broadcast
      // filters. Waiting for that signal here means the FIRST query
      // already includes broadcast values — no doubled queries.
      const dash = findDashboard(this);
      if (dash && !this._initialQueryStarted && dash._broadcastReadyPromise) {
        await dash._broadcastReadyPromise;
      }
      this._initialQueryStarted = true;
      try {
        const query = this._buildLookerQuery(opts);
        // Remember the filter context we're about to query under so
        // subsequent setBroadcastFilters() calls can skip re-querying
        // when the effective context hasn't changed.
        this._lastEffectiveFiltersSig = JSON.stringify(this.getEffectiveFilters());
        const rows = await window.canvasDashboard.queryRunner(query);
        this._clearLoading(mount);
        // Empty-result handling is the explore path's responsibility —
        // the static no-binding path also lands in _mountFromRows with
        // an empty rows array but its options carry literal series
        // data we still want to render. Subclasses (CanvasGrid) may
        // override _renderEmpty to keep their native empty UI.
        if (Array.isArray(rows) && rows.length === 0 && this._renderEmpty(mount, opts)) {
          this._lastRefreshedAt = Date.now();
          this._installExportMenu();
          notifyRefreshed(this);
          return;
        }
        this._mountFromRows(rows, opts);
      } catch (e) {
        console.error('canvas-chart#' + (this.id || '') + ' explore:', e);
        this._showError(mount, e.message || String(e));
      }
    }
    // Render the empty-result UI. Returns true when the subclass
    // handled it and the caller should skip _mountFromRows. Override
    // to do something else (CanvasGrid keeps AG Grid mounted with
    // empty rowData so its column headers stay visible).
    _renderEmpty(mount, opts) {
      this._showEmpty(mount);
      return true;
    }
    _buildLookerQuery(opts) {
      const dashboard = findDashboard(this);
      const model = this.getAttribute('looker-model')
                 || (dashboard && dashboard.getAttribute('looker-model'))
                 || null;
      if (!model) {
        throw new Error('explore mode needs a looker-model attribute (on the chart or dashboard)');
      }
      const fields = this._collectQueryFields(opts);
      // Translate effective filters into Looker's {field: expression} map.
      // For now we pass the value through as-is; conditions like ">10",
      // "in_the_past", etc. are encoded in Looker's filter-expression
      // string syntax that authors place in the filter's `value`.
      const filters = {};
      for (const f of this.getEffectiveFilters()) {
        if (!f.field || f.value === '' || f.value == null) continue;
        const v = String(f.value);
        filters[f.field] = filters[f.field] ? `${filters[f.field]},${v}` : v;
      }
      const sorts = this._collectQuerySorts(opts);
      const query = {
        model,
        view: this._exploreName,
        fields,
        filters,
        limit: this._collectLimit(opts) || '5000'
      };
      if (sorts && sorts.length) query.sorts = sorts;
      return query;
    }
    // Subclasses override to project their option schema (xAxis.categoryField
    // + series.queryField for charts; query.fields for grids).
    _collectQueryFields(opts) {
      const fields = [];
      const seen = new Set();
      const add = f => { if (f && !seen.has(f)) { seen.add(f); fields.push(f); } };
      const ax = opts.xAxis;
      const categoryField = ax && ax.categoryField || null;
      add(categoryField);
      (opts.series || []).forEach(s => {
        // Series-level categoryField (no xAxis) — funnel, treemap, etc.
        if (s.categoryField) add(s.categoryField);
        if (s.queryField) add(s.queryField);
        if (Array.isArray(s.queryFields)) s.queryFields.forEach(add);
        if (Array.isArray(s.data)) {
          s.data.forEach(d => {
            if (d && typeof d === 'object' && typeof d.queryField === 'string') {
              add(d.queryField);
            }
          });
        }
      });
      return fields;
    }
    _collectQuerySorts(opts) {
      // An explicit `query.sorts` wins — this is how a chart asks for a
      // measure-sorted top-N (e.g. "revenue by category, top 8" needs
      // `query: { sorts: ["order_items.total_sale_price desc"], limit: 8 }`).
      // Same contract <canvas-grid> uses. Falls back to sorting by the
      // category field so existing defs are unchanged.
      const q = opts.query || {};
      if (Array.isArray(q.sorts) && q.sorts.length) return q.sorts.slice();
      const ax = opts.xAxis;
      return ax && ax.categoryField ? [ax.categoryField] : null;
    }
    _collectLimit(opts) {
      // Honor an explicit `query.limit`; otherwise null → 5000 default
      // applied in _buildLookerQuery.
      const q = opts.query || {};
      return q.limit || null;
    }
    _showLoading(mount) {
      mount.dataset.cdLoading = '1';
      // Hide the per-tile menu while loading — re-shown by
      // _installExportMenu on the next successful render.
      this._hideExportButton();
      mount.style.cssText = 'width:100%;height:100%;position:relative;';
      mount.innerHTML =
        '<div class="cd-state-overlay cd-loading-skeleton">' +
          '<div class="cd-skeleton-bar"></div>' +
          '<div class="cd-skeleton-bar"></div>' +
          '<div class="cd-skeleton-bar"></div>' +
        '</div>';
    }
    _clearLoading(mount) {
      delete mount.dataset.cdLoading;
      mount.style.cssText = 'width:100%;height:100%';
      mount.textContent = '';
    }
    _showError(mount, msg) {
      delete mount.dataset.cdLoading;
      // Hide any per-tile menu while the error card is up — see
      // _hideExportButton. Reinstalled by _mountFromRows on success.
      this._hideExportButton();
      const safeMsg = String(msg == null ? '' : msg);
      mount.style.cssText = 'width:100%;height:100%;position:relative;';
      mount.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'cd-state-overlay cd-error-card';
      card.innerHTML =
        '<div class="cd-error-icon" aria-hidden="true">!</div>' +
        '<div class="cd-error-message"></div>' +
        '<div class="cd-error-actions">' +
          '<button type="button" class="cd-error-btn cd-error-retry">Retry</button>' +
          '<button type="button" class="cd-error-btn cd-error-copy">Copy details</button>' +
        '</div>';
      card.querySelector('.cd-error-message').textContent = safeMsg;
      const self = this;
      card.querySelector('.cd-error-retry').addEventListener('click', () => {
        // refresh() is async — it kicks off _bindLookerExplore which
        // awaits the query. Both branches of failure (the sync call
        // and the async rejection) need to land back in the error
        // card; otherwise an unhandled-promise-rejection slips out.
        try {
          const p = self.refresh();
          if (p && typeof p.catch === 'function') {
            p.catch(e => self._showError(mount, e.message || String(e)));
          }
        } catch (e) {
          self._showError(mount, e.message || String(e));
        }
      });
      card.querySelector('.cd-error-copy').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const detail = `canvas-chart#${self.id || ''}: ${safeMsg}`;
        const done = () => {
          const orig = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        };
        // Only flip the button to "Copied" on a confirmed-OK copy.
        // navigator.clipboard.writeText rejects on permission-restricted
        // iframes; document.execCommand returns false when it can't copy.
        // Silent failure with a "Copied" lie is worse than no feedback.
        const fail = () => {
          const orig = btn.textContent;
          btn.textContent = 'Copy failed';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(detail).then(done, fail);
        } else {
          // Fallback for permission-restricted iframes.
          const ta = document.createElement('textarea');
          ta.value = detail;
          document.body.appendChild(ta);
          ta.select();
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
          ta.remove();
          ok ? done() : fail();
        }
      });
      mount.appendChild(card);
      // Deliberately do NOT call notifyRefreshed here. A successful
      // refresh updates the dashboard's "Updated <time>" footer; an
      // errored refresh leaves the footer at its prior value (or
      // blank if no chart has ever succeeded), so viewers don't see
      // "Updated just now" when every tile is actually failing.
      this._lastRefreshedAt = Date.now();
    }
    _showEmpty(mount, msg) {
      delete mount.dataset.cdLoading;
      this._hideExportButton();
      mount.style.cssText = 'width:100%;height:100%;position:relative;';
      mount.innerHTML =
        '<div class="cd-state-overlay cd-empty-card">' +
          '<div class="cd-empty-icon" aria-hidden="true">∅</div>' +
          '<div class="cd-empty-message"></div>' +
        '</div>';
      mount.querySelector('.cd-empty-message').textContent =
        msg || 'No data for the current filters.';
    }
    // --- constraints (hardcoded predicates) -------------------------------
    _registerConstraintEl(el, c) {
      c._el = el;
      this._constraints.set(c.id, c);
    }
    addConstraint(spec) {
      const c = {
        id: (spec && spec.id) || newId('cc'),
        field: spec.field || '',
        condition: spec.condition || 'equals',
        value: spec.value !== undefined ? spec.value : ''
      };
      this._constraints.set(c.id, c);
      return c.id;
    }
    removeConstraint(id) {
      const c = this._constraints.get(id);
      if (!c) return false;
      this._constraints.delete(id);
      if (c._el && c._el.parentNode) c._el.parentNode.removeChild(c._el);
      return true;
    }
    getConstraints() {
      return Array.from(this._constraints.values()).map(c => {
        const { _el, ...clean } = c;
        return clean;
      });
    }
    // --- listens (filter wiring) ------------------------------------------
    _registerListenEl(el, l) {
      l._el = el;
      this._listens.set(l.id, l);
    }
    addListen(spec) {
      if (!spec || !spec.filter) throw new Error('canvas-listen: filter is required');
      const l = {
        id: spec.id || newId('cl'),
        filter: spec.filter,            // dashboard filter name
        field: spec.field || ''         // optional override; '' = use filter's field
      };
      this._listens.set(l.id, l);
      return l.id;
    }
    removeListen(id) {
      const l = this._listens.get(id);
      if (!l) return false;
      this._listens.delete(id);
      if (l._el && l._el.parentNode) l._el.parentNode.removeChild(l._el);
      return true;
    }
    getListens() {
      return Array.from(this._listens.values()).map(l => {
        const { _el, ...clean } = l;
        return clean;
      });
    }
    // Effective filter context — last-write-wins resolution at the field level:
    //   1. Own <canvas-constraint>s (hardcoded predicates) populate the map first.
    //   2. <canvas-listen>s of dashboard <canvas-filter>s overwrite the same field
    //      if the listen targets one (this is the "listen overrides constraint"
    //      opt-in mechanism authors use to allow dashboard filters to take effect
    //      on charts that otherwise pin the field).
    //   3. Broadcast filters (Looker dashboard-level filters injected by the
    //      tile host) fill in fields not already covered, but only when the
    //      chart's explore matches. Default behavior: constraint wins over
    //      broadcast; broadcast does NOT override a constraint unless the
    //      author has wired a <canvas-listen> for it.
    // Returns at most one filter per field.
    getEffectiveFilters() {
      const byField = new Map();
      const hasValue = v => v !== '' && v != null;
      for (const c of this.getConstraints()) {
        if (c.field && hasValue(c.value)) byField.set(c.field, {
          field: c.field, condition: c.condition, value: c.value
        });
      }
      const dash = findDashboard(this);
      if (dash) {
        for (const l of this._listens.values()) {
          const f = dash.getFilter(l.filter);
          if (!f) {
            console.warn(
              `canvas-chart#${this.id || '<no id>'}: listens for unknown filter "${l.filter}"`
            );
            continue;
          }
          const field = l.field || f.field;
          if (field && hasValue(f.value)) byField.set(field, {
            field, condition: f.condition, value: f.value
          });
        }
        // Skip broadcasts that target this chart's own categoryField —
        // that's the field shown on the X axis, so filtering on it would
        // collapse the chart to a single bar / point. Useful for the
        // cross-filter UX: clicking a value in this chart should filter
        // OTHER charts, not change this one.
        const exploreName = this._exploreName;
        const ownCategoryField =
          (this._optsTemplate && this._optsTemplate.xAxis && this._optsTemplate.xAxis.categoryField) || null;
        // Same idea for pies: the per-slice `crossFilter` annotation is
        // the chart's own "slice axis". A broadcast on that field would
        // zero out the slices that don't match (e.g. clicking the dark
        // R&D slice broadcasts is_attrited=No, which would otherwise come
        // back and collapse the orange slice's count to 0, making it
        // disappear from the pie entirely).
        const ownSliceFields = new Set();
        const tmpl = this._optsTemplate;
        if (tmpl && Array.isArray(tmpl.series)) {
          tmpl.series.forEach(s => {
            if (Array.isArray(s.data)) {
              s.data.forEach(d => {
                if (d && d.crossFilter && d.crossFilter.field) {
                  ownSliceFields.add(d.crossFilter.field);
                }
              });
            }
          });
        }
        for (const bc of dash.getBroadcastFilters()) {
          if (!bc.field) continue;
          if (!hasValue(bc.value)) continue;
          if (bc.explore && exploreName && bc.explore !== exploreName) continue;
          if (byField.has(bc.field)) continue;
          if (ownCategoryField && ownCategoryField === bc.field) continue;
          if (ownSliceFields.has(bc.field)) continue;
          byField.set(bc.field, {
            field: bc.field, condition: bc.condition || 'equals', value: bc.value
          });
        }
      }
      return Array.from(byField.values());
    }
  }
  customElements.define('canvas-chart', CanvasChart);

  // --- <canvas-kpi> --------------------------------------------------------
  // Two visual variants:
  //   default — boxed icon on the left, big value, label stacked below (OVERVIEW).
  //   inline  — bare icon (e.g. ▼), value and label sit on one row (ATTRITION TREND).
  //
  // Two value sources:
  //   value="…"                              — literal (rendered as-is).
  //   explore="…" query-field="…"            — runs an inline Looker query and
  //                                            shows the resulting cell. The
  //                                            value slot is blank until the
  //                                            query resolves; on failure it
  //                                            stays blank (no stale fallback).
  //   format="percent1"                      — multiply by 100, 1 decimal (ratio in).
  //   format="percent1-signed" | "percent2-signed"
  //                                          — ratio ×100, leading `+`
  //                                            for positive values. Pair
  //                                            with `unit="%"` on delta KPIs.
  //   format="percent"                       — 1 decimal + "%" suffix (pct already).
  //   format="usd" | "usd2"                  — dollars, rounded / with cents.
  //   format="decimal1" | "decimal2"         — 1 / 2 decimal places.
  //   format="int"                           — thousand separators, no decimal.
  class CanvasKpi extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      applyBox(this);
      const exploreName = this.getAttribute('explore');
      const queryField = this.getAttribute('query-field');
      // The literal `value=` path also goes through _formatValue when a
      // `format=` is set — same vocabulary as the query path. Authors who
      // want the raw string through (e.g. a pre-formatted "$1.23M") just
      // omit format.
      const literal = this.getAttribute('value') || '';
      const initial = exploreName && queryField
        ? ''
        : (this.getAttribute('format') ? this._formatValue(literal) : literal);
      this._renderValue(initial);
      if (exploreName && queryField) this._runQuery(exploreName, queryField);
    }
    _renderValue(value) {
      const label = this.getAttribute('label') || '';
      const unit = this.getAttribute('unit') || '';
      const icon = this.getAttribute('icon') || '';
      const variant = this.getAttribute('variant') || 'default';
      const valueHtml = value === ''
        ? '&nbsp;'
        : `${value}<span class="canvas-kpi-unit">${unit}</span>`;
      const wrap = document.createElement('div');
      wrap.className = 'canvas-kpi-wrap variant-' + variant;
      wrap.innerHTML = `
        ${icon ? `<div class="canvas-kpi-icon">${icon}</div>` : ''}
        <div class="canvas-kpi-body">
          <div class="canvas-kpi-value">${valueHtml}</div>
          <div class="canvas-kpi-label">${label}</div>
        </div>`;
      this.innerHTML = '';
      this.appendChild(wrap);
    }
    async _runQuery(exploreName, queryField) {
      // One tick to let any children (future canvas-listen/constraint) upgrade.
      await new Promise(r => setTimeout(r, 0));
      const dash = findDashboard(this);
      if (dash && dash._broadcastReadyPromise) await dash._broadcastReadyPromise;
      const model = this.getAttribute('looker-model')
                 || (dash && dash.getAttribute('looker-model'));
      if (!model) {
        console.error('canvas-kpi#' + (this.id || '') + ': needs a looker-model');
        return;
      }
      try {
        const rows = await window.canvasDashboard.queryRunner({
          model, view: exploreName,
          fields: [queryField], filters: {}, limit: '1'
        });
        const raw = rows && rows[0] && rows[0][queryField];
        if (raw == null) return;
        this._renderValue(this._formatValue(raw));
      } catch (e) {
        console.error('canvas-kpi#' + (this.id || '') + ' query:', e);
      }
    }
    _formatValue(v) {
      return formatValue(v, this.getAttribute('format'));
    }
  }
  customElements.define('canvas-kpi', CanvasKpi);

  // --- <canvas-text> -------------------------------------------------------
  class CanvasText extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      applyBox(this);
      // Parse inner HTML into a temp container, sanitize, re-attach.
      const html = this.innerHTML;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      sanitize(tmp);
      this.innerHTML = '';
      [...tmp.childNodes].forEach(n => this.appendChild(n));
    }
  }
  customElements.define('canvas-text', CanvasText);

  // --- <canvas-shape> ------------------------------------------------------
  class CanvasShape extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      applyBox(this);
      const kind = this.getAttribute('kind') || 'rect';
      const fill = this.getAttribute('fill') || 'transparent';
      const stroke = this.getAttribute('stroke') || 'transparent';
      const strokeWidth = this.getAttribute('stroke-width') || '1';
      const radius = this.getAttribute('radius') || '0';
      this.style.boxSizing = 'border-box';
      if (kind === 'rect') {
        this.style.background = fill;
        this.style.border = `${strokeWidth}px solid ${stroke}`;
        this.style.borderRadius = radius + 'px';
      } else if (kind === 'line-h') {
        this.style.background = stroke;
      } else if (kind === 'line-v') {
        this.style.background = stroke;
      } else if (kind === 'ellipse') {
        this.style.background = fill;
        this.style.border = `${strokeWidth}px solid ${stroke}`;
        this.style.borderRadius = '50%';
      }
    }
  }
  customElements.define('canvas-shape', CanvasShape);

  // --- <canvas-tile> -------------------------------------------------------
  // Logical grouping with positioning. On desktop, behaves like any other
  // absolute-positioned element. On mobile (viewport < 600px), tiles stack
  // vertically as cards via the dashboard's data-viewport="mobile" mode
  // (see CanvasDashboard + the CSS @media block).
  //
  // To make mobile scaling work with flex layout, each tile holds an inner
  // wrapper div sized to the tile's intrinsic dimensions. On mobile we
  // apply transform: scale() to the *wrapper*, and resize the outer tile
  // to the scaled visual dimensions. The wrapper's intrinsic-size box
  // shrinks visually to fit the tile's smaller layout box, so flex
  // allocates the correct space and the rendered content matches.
  class CanvasTile extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      applyBox(this);
      const wrapper = document.createElement('div');
      wrapper.className = 'cd-tile-inner';
      wrapper.style.position = 'relative';
      wrapper.style.transformOrigin = 'top left';
      const w = this.getAttribute('width');
      const h = this.getAttribute('height');
      if (w !== null) wrapper.style.width  = w + 'px';
      if (h !== null) wrapper.style.height = h + 'px';
      // Move all current children into the wrapper. Their positioning
      // (set by their own connectedCallback via applyBox) is preserved,
      // and now resolves against this wrapper as the containing block.
      while (this.firstChild) wrapper.appendChild(this.firstChild);
      this.appendChild(wrapper);
      this._inner = wrapper;
    }
  }
  customElements.define('canvas-tile', CanvasTile);

  // --- <canvas-filter> -----------------------------------------------------
  // Dashboard-only. A user-facing control that other elements can listen to
  // by name. Renders a label + input/select.
  class CanvasFilter extends HTMLElement {
    connectedCallback() {
      applyBox(this);
      const name = this.getAttribute('name');
      if (!name) {
        console.warn('canvas-filter: missing required `name` attribute', this);
        return;
      }
      const dash = findDashboard(this);
      if (!dash || dash !== this.parentElement) {
        console.warn(
          'canvas-filter: must be a direct child of <canvas-dashboard>', this
        );
        return;
      }
      const spec = {
        name,
        label: this.getAttribute('label') || name,
        field: this.getAttribute('field') || '',
        condition: this.getAttribute('condition') || 'equals',
        default: this.getAttribute('default') || '',
        ui: this.getAttribute('ui') || 'text',
        values: this.getAttribute('values') || '',
        allowMultiple: this.hasAttribute('allow-multiple'),
        required: this.hasAttribute('required')
      };
      const filter = normalizeFilter(spec);
      dash._registerFilterEl(this, filter);
      this._renderUI(filter, dash);
    }
    _renderUI(f, dash) {
      const labelEl = document.createElement('label');
      labelEl.className = 'canvas-filter-label';
      const nameEl = document.createElement('span');
      nameEl.className = 'canvas-filter-name';
      nameEl.textContent = f.label + ':';
      labelEl.appendChild(nameEl);

      let input;
      if (f.ui === 'dropdown' || f.ui === 'select') {
        input = document.createElement('select');
        // Always include an "(All)" empty option unless required.
        if (!f.required) {
          const opt = document.createElement('option');
          opt.value = ''; opt.textContent = '(All)';
          input.appendChild(opt);
        }
        for (const v of f.values) {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = v;
          if (String(v) === String(f.value)) opt.selected = true;
          input.appendChild(opt);
        }
        if (f.value === '' && !f.required) input.value = '';
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.value = f.value;
      }
      input.className = 'canvas-filter-input';
      input.addEventListener('change', e => {
        dash.setFilter(f.name, e.target.value);
      });
      f._input = input;
      labelEl.appendChild(input);
      this.appendChild(labelEl);
    }
  }
  customElements.define('canvas-filter', CanvasFilter);

  // --- <canvas-constraint> -------------------------------------------------
  // Chart-only. Hardcoded predicate AND'd into the chart's effective filter
  // context. Renders nothing.
  class CanvasConstraint extends HTMLElement {
    connectedCallback() {
      this.style.display = 'none';
      const chart = this.parentElement;
      if (!chart || (chart.tagName !== 'CANVAS-CHART' && chart.tagName !== 'CANVAS-GRID')) {
        console.warn(
          'canvas-constraint: must be a direct child of <canvas-chart> or <canvas-grid>', this
        );
        return;
      }
      const c = {
        id: this.id || newId('cc'),
        field: this.getAttribute('field') || '',
        condition: this.getAttribute('condition') || 'equals',
        value: this.getAttribute('value') || ''
      };
      if (!this.id) this.id = c.id;
      chart._registerConstraintEl(this, c);
    }
  }
  customElements.define('canvas-constraint', CanvasConstraint);

  // --- <canvas-listen> -----------------------------------------------------
  // Chart-only. Wires a dashboard filter (by name) onto a field on this
  // chart's query. Renders nothing.
  class CanvasListen extends HTMLElement {
    connectedCallback() {
      this.style.display = 'none';
      const chart = this.parentElement;
      if (!chart || (chart.tagName !== 'CANVAS-CHART' && chart.tagName !== 'CANVAS-GRID')) {
        console.warn(
          'canvas-listen: must be a direct child of <canvas-chart> or <canvas-grid>', this
        );
        return;
      }
      const filter = this.getAttribute('filter');
      if (!filter) {
        console.warn('canvas-listen: missing required `filter` attribute', this);
        return;
      }
      const l = {
        id: this.id || newId('cl'),
        filter,
        field: this.getAttribute('field') || ''
      };
      if (!this.id) this.id = l.id;
      chart._registerListenEl(this, l);
    }
  }
  customElements.define('canvas-listen', CanvasListen);

  // --- <canvas-grid> -------------------------------------------------------
  // An AG Grid Community tabular visual. Shares the same query/explore +
  // constraint/listen + filter-projection machinery as <canvas-chart>; the
  // only thing it overrides is the visual itself (AG Grid in place of
  // Highcharts).
  //
  // The inline options JSON has two top-level keys:
  //   { "query": { fields, sorts?, limit? },  // looker query inputs
  //     "grid":  { columnDefs, ... } }        // AG Grid options
  //
  // columnDefs reference row fields by their view-qualified LookML names
  // exactly like canvas-chart series do; cell renderers / cell-class
  // functions can be expressed by global name and the runtime resolves
  // them just like Highcharts callbacks.
  const GRID_CALLBACK_KEYS = new Set([
    'cellRenderer','cellClass','cellClassRules','cellStyle','tooltipValueGetter',
    'valueGetter','valueFormatter','valueParser','rowClassRules','getRowStyle',
    'getRowClass','comparator','filterValueGetter','suppressKeyboardEvent',
    'onCellClicked','onCellDoubleClicked','onRowClicked','onRowDoubleClicked',
    'onGridReady','onFirstDataRendered','onRowDataUpdated','onCellValueChanged',
    'onSelectionChanged','onFilterChanged','onSortChanged'
  ]);
  // Soft resolver: AG Grid accepts both function values and registered
  // component-name strings for cellRenderer/cellClass/etc. We only swap a
  // string for a function if (a) the string looks like an identifier path
  // and (b) that path resolves to a function on `window`. Otherwise we
  // leave the string in place so AG Grid can interpret it (e.g. as a CSS
  // class on `cellClass`).
  const IDENT_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
  function resolveGridCallbacks(node) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (node[i] && typeof node[i] === 'object') resolveGridCallbacks(node[i]);
      }
      return node;
    }
    if (!node || typeof node !== 'object') return node;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (GRID_CALLBACK_KEYS.has(k) && typeof v === 'string' && IDENT_RE.test(v)) {
        const fn = v.split('.').reduce((o, p) => (o == null ? o : o[p]), window);
        if (typeof fn === 'function') node[k] = fn;
      } else if (v && typeof v === 'object') {
        resolveGridCallbacks(v);
      }
    }
    return node;
  }

  class CanvasGrid extends CanvasChart {
    // --- visual hook overrides ---------------------------------------------
    _applyDefaults(opts) {
      opts.grid = opts.grid || {};
      // AG Grid defaults — minimal: assume the author has provided
      // columnDefs. We keep things uncluttered (no header, compact rows)
      // since most canvas-grid uses are compact tabular vizes.
      if (!opts.grid.defaultColDef) {
        opts.grid.defaultColDef = { sortable: false, resizable: false, suppressMovable: true };
      }
      // Resolve callback strings inside the grid options (cellRenderer etc.).
      resolveGridCallbacks(opts.grid);
    }
    _destroyVisual() {
      if (this._gridApi) {
        try { this._gridApi.destroy(); } catch {}
        this._gridApi = null;
      }
    }
    // Grid's empty-state: keep AG Grid mounted with empty rowData so
    // column headers + AG's native "No Rows" overlay remain visible
    // (better UX than wiping the headers). Returning false in
    // _renderEmpty tells _bindLookerExplore to fall through to
    // _mountFromRows([]) which initializes AG Grid normally.
    _renderEmpty(mount, opts) {
      return false;
    }
    _mountFromRows(rows, opts) {
      const ag = window.agGrid;
      if (!ag || typeof ag.createGrid !== 'function') {
        this._showError(this._mount,
          'AG Grid not loaded. Add a <script src=".../ag-grid-community.min.js"> ' +
          'tag before canvas-dashboard.js.');
        return;
      }
      const gridOpts = Object.assign({}, opts.grid, { rowData: rows });
      // AG Grid's `field` treats dots as a nested-object accessor path,
      // but our LookML field names like "employees.job_role" are literal
      // keys in flat row objects. Rewrite any columnDef with a dotted
      // `field` into an equivalent `valueGetter` that looks the key up
      // verbatim. Columns that already have a valueGetter (e.g. the row
      // index column) are left alone.
      if (Array.isArray(gridOpts.columnDefs)) {
        gridOpts.columnDefs = gridOpts.columnDefs.map(cd => {
          if (cd && typeof cd.field === 'string' && cd.field.includes('.') && !cd.valueGetter) {
            const f = cd.field;
            // Strip `field` rather than setting it to undefined — AG Grid
            // uses the field key for colId derivation, CSV export headers,
            // and aria labels, and a property whose value is undefined
            // can still surface as the literal string "undefined" in some
            // of those paths.
            const { field, ...rest } = cd;
            cd = Object.assign({}, rest, {
              valueGetter: (params) => params.data && params.data[f],
            });
          }
          // Author-supplied `valueFormat` (vocabulary shared with KPI and
          // chart series) → AG Grid `valueFormatter`. The literal
          // valueFormatter the author wrote always wins.
          if (cd && cd.valueFormat && !cd.valueFormatter) {
            const fmt = cd.valueFormat;
            cd = Object.assign({}, cd, {
              valueFormatter: (params) => formatValue(params.value, fmt)
            });
            delete cd.valueFormat;
          }
          // Safety net for un-annotated numeric columns: ≤2 decimals +
          // thousands separator. Infer numeric from the first non-null row
          // value (AG Grid does not carry type info). Authors who supply a
          // valueFormatter, valueFormat, or cellRenderer win — we only fill
          // in fully-unannotated numeric columns.
          if (cd && !cd.valueFormatter && !cd.cellRenderer) {
            const fld = (typeof cd.field === 'string' && cd.field) || null;
            const probe = inferNumeric(rows, fld, cd.valueGetter);
            if (probe) {
              cd = Object.assign({}, cd, {
                // Only reformat actual numeric values — leave strings
                // alone even if they parse as numbers. A column of year
                // dimensions arriving as ["2025", "2026"] would otherwise
                // render as "2,025", "2,026".
                valueFormatter: (params) =>
                  typeof params.value === 'number' && Number.isFinite(params.value)
                    ? formatNumberDefault(params.value)
                    : (params.value == null ? '' : String(params.value))
              });
            }
          }
          return cd;
        });
      }
      this._gridApi = ag.createGrid(this._mount, gridOpts);
      this._lastRefreshedAt = Date.now();
      this._installExportMenu();
      notifyRefreshed(this);
    }
    _exportMenuItems() {
      const items = [];
      if (this._gridApi && typeof this._gridApi.exportDataAsCsv === 'function') {
        items.push({
          label: 'Download CSV',
          action: () => this._gridApi.exportDataAsCsv({
            fileName: (this.id || 'canvas-grid') + '.csv',
          }),
        });
      }
      return items;
    }
    // --- query hooks --------------------------------------------------------
    _collectQueryFields(opts) {
      const q = opts.query || {};
      if (Array.isArray(q.fields)) return q.fields.slice();
      // Fallback: harvest any field-looking strings out of grid.columnDefs.
      const out = [];
      const seen = new Set();
      for (const cd of (opts.grid && opts.grid.columnDefs) || []) {
        if (cd && typeof cd.field === 'string' && cd.field.includes('.') && !seen.has(cd.field)) {
          seen.add(cd.field); out.push(cd.field);
        }
      }
      return out;
    }
    _collectQuerySorts(opts) {
      const q = opts.query || {};
      return Array.isArray(q.sorts) && q.sorts.length ? q.sorts.slice() : null;
    }
    _collectLimit(opts) {
      const q = opts.query || {};
      return q.limit || null;
    }
  }
  customElements.define('canvas-grid', CanvasGrid);

  // --- <canvas-refresh> ---------------------------------------------------
  // A small button the author can place anywhere on the canvas (e.g. in the
  // header). Clicking it re-runs every chart's query. Keyboard shortcut
  // 'R' on the dashboard does the same thing.
  class CanvasRefresh extends HTMLElement {
    connectedCallback() {
      applyBox(this);
      this.style.display = this.style.display || 'inline-flex';
      this.style.alignItems = 'center';
      // Idempotency guard — connectedCallback fires on every DOM
      // (re-)insertion; without this, hot-reload during authoring or
      // SPA re-parenting would stack duplicate buttons.
      if (this.querySelector('.cd-refresh-btn')) return;
      const label = this.getAttribute('label') || 'Refresh';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cd-refresh-btn';
      btn.title = label + ' (or press R)';
      btn.setAttribute('aria-label', label);
      btn.innerHTML = '<span class="cd-refresh-icon" aria-hidden="true">⟳</span><span class="cd-refresh-label">' +
        label.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])) + '</span>';
      btn.addEventListener('click', () => {
        const dash = this.closest('canvas-dashboard');
        if (dash && typeof dash.refreshAll === 'function') dash.refreshAll();
      });
      this.appendChild(btn);
    }
  }
  customElements.define('canvas-refresh', CanvasRefresh);
})();
