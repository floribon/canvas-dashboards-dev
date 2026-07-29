# Stacked / grouped multi-series column

## Use when

Two or more measures over one category dimension — revenue vs cost by
month, attrited vs current headcount by department. Use
`"stacking": "normal"` when the sum is meaningful (parts of a whole),
`"stacking": "percent"` for composition, or delete the `stacking` key
for side-by-side grouped columns when the measures are compared, not
summed.

## Snippet

```html
<canvas-chart id="chart-stacked" x="105" y="410" width="780" height="450"
              explore="<EXPLORE>">
  <canvas-listen filter="<DASHBOARD_FILTER_NAME>"></canvas-listen>
  <script type="application/json">
  {
    "chart": { "type": "column", "spacing": [10, 6, 6, 6] },
    "xAxis": {
      "categoryField": "<VIEW>.<CATEGORY_FIELD>",
      "lineColor": "#dcdcdc",
      "tickColor": "#dcdcdc",
      "labels": { "style": { "color": "#909090", "fontSize": "10px" } }
    },
    "yAxis": {
      "title": { "text": null },
      "gridLineColor": "#f0f0f0",
      "labels": { "style": { "color": "#909090", "fontSize": "10px" } }
    },
    "tooltip": { "enabled": true, "backgroundColor": "#ffffff",
                 "borderColor": "#ececec", "borderRadius": 6,
                 "shadow": false, "useHTML": true, "shared": true,
                 "style": { "color": "#444444", "fontSize": "11px" } },
    "legend": { "enabled": true, "align": "right", "verticalAlign": "top",
                "itemStyle": { "color": "#7a7a7a", "fontSize": "10px",
                                "fontWeight": "normal" } },
    "plotOptions": {
      "column": { "stacking": "normal", "borderWidth": 0,
                  "pointPadding": 0.02, "groupPadding": 0.06 }
    },
    "series": [
      { "name": "<SERIES_1_NAME>", "color": "#f8c094",
        "queryField": "<VIEW>.<MEASURE_1>", "valueFormat": "<FORMAT>" },
      { "name": "<SERIES_2_NAME>", "color": "#4a4a4a",
        "queryField": "<VIEW>.<MEASURE_2>", "valueFormat": "<FORMAT>" }
    ]
  }
  </script>
</canvas-chart>
```

## Fields to swap

- `<EXPLORE>` / `<VIEW>.<CATEGORY_FIELD>` / `<VIEW>.<MEASURE_N>` — the
  usual verified LookML names. Each series is its own measure on the
  same rows (one query, N measures — not a pivot).
- `<FORMAT>` — annotate **every** series. When all series share one
  format the yAxis ticks inherit it automatically.
- Series colors: first series `#f8c094` (accent), second `#4a4a4a`
  (dark) is the default theme pairing; pull further colors from the
  palette, not invented hexes.

## Variants

- **Grouped (side-by-side):** delete `"stacking": "normal"`.
- **Percent composition:** `"stacking": "percent"` and switch each
  series `valueFormat` appropriately (`int` counts still read fine in
  tooltips; the axis shows 0–100%).
- **Stacked bar (horizontal):** `"chart": { "type": "bar" }` — same
  everything else; use when category labels are long.

## Limits

- This recipe covers *multiple measures*. A "stack by dimension value"
  breakdown (one measure pivoted by a second dimension) needs a Looker
  pivot, which the explore binding doesn't synthesize today — restate
  the design as N explicit measures, or use a saved query
  (`query="<id>"`) that carries the pivot.
- Cross-filter: clicking any segment emits the category (x-axis)
  predicate, same as the single-series column recipe.
