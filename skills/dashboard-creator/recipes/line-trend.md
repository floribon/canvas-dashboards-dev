# Line / area trend over time

## Use when

A measure over a date dimension where the *shape* of the change is
the story — revenue by month, signups by week, error rate by day.
Default to `line` for a single clean series; switch `"type": "area"`
for a filled look when the chart is large and alone in its tile.
(For discrete period-vs-period comparison where individual values
matter, prefer `column-with-cross-filter.md`.)

## Snippet

```html
<canvas-chart id="chart-trend" x="105" y="410" width="780" height="450"
              explore="<EXPLORE>">
  <!-- Optional: respond to a dashboard dropdown. Delete if none. -->
  <canvas-listen filter="<DASHBOARD_FILTER_NAME>"></canvas-listen>
  <script type="application/json">
  {
    "chart": { "type": "line", "spacing": [10, 6, 6, 6] },
    "xAxis": {
      "categoryField": "<VIEW>.<DATE_DIMENSION>",
      "lineColor": "#dcdcdc",
      "tickColor": "#dcdcdc",
      "labels": { "style": { "color": "#909090", "fontSize": "10px" }, "rotation": -45 }
    },
    "yAxis": {
      "title": { "text": null },
      "gridLineColor": "#f0f0f0",
      "labels": { "style": { "color": "#909090", "fontSize": "10px" } }
    },
    "tooltip": { "enabled": true, "backgroundColor": "#ffffff",
                 "borderColor": "#ececec", "borderRadius": 6,
                 "shadow": false, "useHTML": true,
                 "style": { "color": "#444444", "fontSize": "11px" } },
    "legend": { "enabled": false },
    "plotOptions": {
      "line": { "color": "#f8c094", "lineWidth": 2.5,
                "marker": { "enabled": false, "radius": 3,
                            "states": { "hover": { "enabled": true } } } },
      "area": { "color": "#f8c094", "lineWidth": 2,
                "fillOpacity": 0.18,
                "marker": { "enabled": false } }
    },
    "series": [{ "name": "<SERIES_NAME>",
                 "queryField": "<VIEW>.<MEASURE>",
                 "valueFormat": "<FORMAT>" }]
  }
  </script>
</canvas-chart>
```

## Fields to swap

- `<EXPLORE>` — the explore name.
- `<VIEW>.<DATE_DIMENSION>` — a time-grouped dimension
  (`*_month`, `*_week`, `*_date`). Monthly is the safe default; weekly
  or daily only when the range is short enough that labels stay
  readable (~≤ 60 points).
- `<VIEW>.<MEASURE>` — the measure to plot.
- `<FORMAT>` — from the number-formatting vocabulary (`usd`, `int`,
  `percent`, …). Required, as always.
- `<SERIES_NAME>` — tooltip label, e.g. `Revenue`.

## Sorting and range

- The runtime sorts by the `categoryField` by default, which is what
  a time axis wants — no `query` block needed.
- To limit the window, add a `<canvas-constraint>` with a Looker
  relative-date expression rather than a `limit`:

  ```html
  <canvas-constraint field="<VIEW>.<DATE_DIMENSION_RAW>"
                     condition="in_the_past" value="12 months"></canvas-constraint>
  ```

  (`limit` truncates from the *start* of the sorted rows — the oldest
  months — which is almost never what a trend wants.)

## Cross-filter behavior

Same as any category chart: clicking a point emits
`(dateDimension, category)` to other charts on the explore, clicking
again (or on the background) clears it. Markers are hover-only by
default to keep the line clean; clicks on the line still register.
