# Gauge (solid-gauge)

## Use when

A single-metric progress dial — "75% of quarterly goal", "62°F",
"4.3/5 customer satisfaction". One ring; one big number in the
middle. Use sparingly; usually a `<canvas-kpi>` is enough. Reach for
this when the *amount of fill* on the dial communicates progress
faster than reading the number.

## Snippet

```html
<canvas-chart id="chart-goal-gauge" x="100" y="200" width="240" height="200"
              explore="<EXPLORE>">
  <canvas-listen filter="<DASHBOARD_FILTER_NAME>"></canvas-listen>
  <script type="application/json">
  {
    "chart": { "type": "solidgauge", "spacing": [0, 0, 0, 0], "margin": [0, 0, 0, 0] },
    "pane": {
      "size": "100%",
      "startAngle": -120,
      "endAngle": 120,
      "background": [{
        "outerRadius": "100%",
        "innerRadius": "82%",
        "backgroundColor": "#ececec",
        "borderWidth": 0,
        "shape": "arc"
      }]
    },
    "yAxis": {
      "min": 0,
      "max": <MAX>,
      "lineWidth": 0,
      "tickPositions": [],
      "labels": { "enabled": false }
    },
    "tooltip": { "enabled": false },
    "plotOptions": {
      "solidgauge": {
        "innerRadius": "82%",
        "radius": "100%",
        "dataLabels": {
          "enabled": true,
          "y": -20,
          "borderWidth": 0,
          "useHTML": true,
          "formatter": "gaugeCenterLabel",
          "style": { "fontSize": "22px", "color": "#444", "textOutline": "none" }
        }
      }
    },
    "series": [{
      "name": "<SERIES_NAME>",
      "queryField": "<VIEW>.<MEASURE>",
      "color": "#f8c094"
    }]
  }
  </script>
</canvas-chart>

<script>
  window.gaugeCenterLabel = function () {
    // `this.y` is the measure value; `this.series.yAxis.max` is the gauge max.
    var pct = (this.y / this.series.yAxis.max) * 100;
    return '<div style="text-align:center">'
         + '<div style="font-size:24px;font-weight:600;color:#444">' + Math.round(this.y) + '</div>'
         + '<div style="font-size:11px;color:#888;letter-spacing:.05em;text-transform:uppercase">' + Math.round(pct) + '%</div>'
         + '</div>';
  };
</script>
```

## Fields to swap

- `<EXPLORE>` / `<VIEW>.<MEASURE>` — explore + the single
  measure the gauge shows.
- `<MAX>` — the upper bound (e.g. `100` for a percent gauge, the
  goal amount for an "actual vs goal" gauge).
- `<SERIES_NAME>` — series label (mostly irrelevant since legend +
  tooltip are off).
- Color — single accent color for the ring. Use `--cd-accent` to
  match dashboard theme.

## Notes

- **Required modules:** `highcharts-more.js` + `solid-gauge.js`. The
  runtime bundles these automatically; no extra script tags needed.
- For thresholded gauges (green ≥ goal, amber 80–100%, red < 80%),
  swap `series[0].color` with a `colorStops` config and use
  Highcharts' `gauge`-with-bands pattern.
- Keep the gauge small (≤ 240×200) — at large sizes the empty space
  inside the ring becomes awkward; use a column chart instead.
