# Funnel

## Use when

Stage-by-stage drop-off visualization — sign-up flow, sales pipeline,
conversion funnel, support-ticket lifecycle. Each stage's bar
narrows; the width is proportional to the value.

## Snippet

```html
<canvas-chart id="chart-funnel" x="95" y="200" width="510" height="320"
              explore="<EXPLORE>">
  <canvas-listen filter="<DASHBOARD_FILTER_NAME>"></canvas-listen>
  <script type="application/json">
  {
    "chart": { "type": "funnel", "spacing": [10, 10, 10, 10] },
    "tooltip": { "enabled": true,
                 "backgroundColor": "#ffffff", "borderColor": "#ececec",
                 "borderRadius": 6, "shadow": false,
                 "style": { "color": "#444", "fontSize": "11px" } },
    "legend": { "enabled": false },
    "plotOptions": {
      "funnel": {
        "borderWidth": 0,
        "neckWidth": "30%",
        "neckHeight": "20%",
        "width": "70%",
        "dataLabels": {
          "enabled": true,
          "softConnector": true,
          "style": { "color": "#444", "fontSize": "11px", "textOutline": "none", "fontWeight": "500" }
        }
      }
    },
    "series": [{
      "name": "<SERIES_NAME>",
      "categoryField": "<VIEW>.<STAGE_FIELD>",
      "queryField": "<VIEW>.<MEASURE>",
      "valueFormat": "<VALUE_FORMAT>",
      "colors": ["#f8c094", "#ec9f78", "#cd7b54", "#a35a36", "#7a3f22"]
    }]
  }
  </script>
</canvas-chart>
```

## Fields to swap

- `<EXPLORE>` — explore.
- `<VIEW>.<STAGE_FIELD>` — the dimension that names each stage (e.g.
  `orders.funnel_stage`). Often a `CASE WHEN` dimension in LookML.
- `<VIEW>.<MEASURE>` — count or value per stage.
- `<SERIES_NAME>` — funnel label.
- `<VALUE_FORMAT>` — vocabulary from
  `docs/canvas-dashboard-spec.md` § Number formatting. Stages are
  usually counts, so `int` is the typical pick; switch to `usd` /
  `usd2` if the measure is a dollar amount per stage.
- `colors` — palette walked in row order. Add more colors if you have
  more than 5 stages.

## Notes

- **Required module:** `modules/funnel.js`. The runtime bundles this
  automatically; no extra script tags needed.
- The data must arrive **sorted in funnel order** (largest first).
  If your LookML doesn't sort the stages naturally, add a sort to the
  chart's query via a numeric helper dimension and the
  `<canvas-constraint>` or explicit query sorts mechanism.
- For a horizontal "pyramid" version, set `"type": "pyramid"` and
  flip the order. `modules/funnel.js` ships both.
- The runtime turns series-level `categoryField` + `queryField` into
  `{name, y, value}` per-point objects — same mechanism used by
  `treemap.md`. No `<script>` block or load callback needed.
- Data labels auto-prefix the stage name, so each slice reads
  `Stage: value` (e.g. `Complete: 22,213`). To suppress the prefix,
  set your own `dataLabels.formatter`.
