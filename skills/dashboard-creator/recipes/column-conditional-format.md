# Column with conditional formatting

## Use when

A bar/column chart where each bar is colored by its value relative
to a threshold — e.g. green when above target, red when below.
Variant of `column-with-cross-filter.md` for the "did we hit goal"
class of question.

## Snippet

```html
<script>
  // Globally-available formatter for cell color. Lives in a <script>
  // block at the top of the dashboard so the JSON below can reference
  // it by name. Threshold is hard-coded here for clarity; pass it
  // through inline state if it needs to be data-driven.
  window.colorByTarget = function (y, target) {
    if (y == null || isNaN(y)) return 'var(--cd-ink-muted, #b8b8b8)';
    if (y >= target) return 'var(--cd-accent, #4a9d6a)';
    return 'var(--cd-warn, #d9534f)';
  };
  window.pointColorAgainst = function (target) {
    // Returned formatter receives Highcharts point context as `this`.
    return function () { return window.colorByTarget(this.y, target); };
  };
</script>

<canvas-chart id="chart-goal-progress" x="95" y="200" width="510" height="220"
              explore="<EXPLORE>">
  <canvas-listen filter="<DASHBOARD_FILTER_NAME>"></canvas-listen>
  <script type="application/json">
  {
    "chart": { "type": "column", "spacing": [10, 6, 6, 6] },
    "xAxis": {
      "categoryField": "<VIEW>.<CATEGORY_FIELD>",
      "lineColor": "#dcdcdc",
      "labels": { "style": { "color": "#909090", "fontSize": "10px" } }
    },
    "yAxis": {
      "title": { "text": null },
      "gridLineColor": "#f0f0f0",
      "plotLines": [{
        "value": <TARGET>,
        "color": "#999999",
        "dashStyle": "Dash",
        "width": 1,
        "label": { "text": "Target", "style": { "color": "#888", "fontSize": "10px" } }
      }]
    },
    "tooltip": { "enabled": true, "useHTML": true,
                 "backgroundColor": "#ffffff", "borderColor": "#ececec",
                 "borderRadius": 6, "shadow": false,
                 "style": { "color": "#444", "fontSize": "11px" } },
    "legend": { "enabled": false },
    "plotOptions": {
      "column": {
        "borderWidth": 0,
        "pointPadding": 0.02,
        "groupPadding": 0.04,
        "colorByPoint": false
      },
      "series": {
        "events": { "load": null }
      }
    },
    "series": [{
      "name": "<SERIES_NAME>",
      "queryField": "<VIEW>.<MEASURE>",
      "color": "#cccccc",
      "valueFormat": "<VALUE_FORMAT>",
      "dataLabels": {
        "enabled": true,
        "style": { "fontSize": "10px", "color": "#444", "textOutline": "none" }
      },
      "_pointColorTarget": <TARGET>
    }]
  }
  </script>
</canvas-chart>
```

Then, in a `<script>` block elsewhere on the page, wire the per-point
color after the chart loads (the runtime resolves `events.load` from
the function-name allowlist):

```html
<script>
  window.applyColumnConditionalColors = function () {
    var target = this.userOptions.series[0]._pointColorTarget;
    var series = this.series[0];
    if (!series) return;
    series.points.forEach(function (pt) {
      pt.update({ color: window.colorByTarget(pt.y, target) }, false);
    });
    this.redraw(false);
  };
</script>
```

And reference it in the chart options: replace
`"events": { "load": null }` with
`"events": { "load": "applyColumnConditionalColors" }`.

## Fields to swap

- `<EXPLORE>` / `<VIEW>.<CATEGORY_FIELD>` / `<VIEW>.<MEASURE>` —
  as in `column-with-cross-filter.md`.
- `<TARGET>` — numeric target value (e.g. `100000`). Compared to each
  bar's measure value to pick green vs red.
- `<SERIES_NAME>` — label shown in tooltip.
- `<VALUE_FORMAT>` — vocabulary from
  `docs/canvas-dashboard-spec.md` § Number formatting. The runtime
  applies this to the tooltip, the data labels, and (since this chart
  has one series) the yAxis ticks. Pick `usd` / `usd2` for revenue,
  `percent` for "% of goal", `int` for counts.

## Notes

- Add a LookML measure if "target" is dynamic per row
  (`target_revenue_for_period`) and adjust `colorByTarget` to read it
  from `this.options.<your-field>`.
- The dashed `plotLines` entry draws the horizontal target line.
- Cross-filtering still works — clicking a bar broadcasts
  `<categoryField, point.category>` to other charts on the same
  explore.
