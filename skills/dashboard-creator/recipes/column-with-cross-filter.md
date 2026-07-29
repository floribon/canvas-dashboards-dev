# Column with cross-filter

## Use when

A narrative bar/column showing one measure over a category dimension
(e.g. attrition by month, revenue by quarter). Clicking a column
cross-filters every other chart on the same explore that doesn't pin
that field.

## Snippet

```html
<canvas-chart id="chart-trend" x="95" y="678" width="510" height="200"
              explore="<EXPLORE>">
  <canvas-constraint field="<VIEW>.<HARD_FILTER_FIELD>"
                     condition="equals" value="<VALUE>"></canvas-constraint>
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
                 "shadow": false, "useHTML": true,
                 "style": { "color": "#444444", "fontSize": "11px" } },
    "legend": { "enabled": false },
    "plotOptions": {
      "column": {
        "color": "#f8c094",
        "borderWidth": 0,
        "pointPadding": 0.02,
        "groupPadding": 0.04
      }
    },
    "series": [{ "name": "<SERIES_NAME>", "queryField": "<VIEW>.<MEASURE>" }]
  }
  </script>
</canvas-chart>
```

## Fields to swap

- `<EXPLORE>` — the explore.
- `<VIEW>.<CATEGORY_FIELD>` — typically a time dimension
  (e.g. `attrited_month`) or any categorical dimension.
- `<VIEW>.<MEASURE>` — what you're plotting.
- Optional `<canvas-constraint>` — pins a hardcoded filter
  (e.g. `is_attrited=Yes`). Delete if not needed.
- Optional `<canvas-listen>` — wire to a dashboard-level filter.
  Delete if no such filter exists.

## Cross-filter behavior

- Clicking a column emits `<categoryField, point.category>` as the
  cross-filter predicate to all other charts on the same explore.
- Clicking the same column again clears it.
- Clicking the plot background also clears it.
- The clicked column stays at full opacity; siblings fade to 0.2.

If you have multiple cross-filter sources on different fields, they
coexist (e.g. attrited_month=2022-05 AND department=Sales applied
together).
