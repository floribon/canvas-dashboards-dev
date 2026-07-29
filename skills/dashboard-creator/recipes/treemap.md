# Treemap

## Use when

Showing relative size across many categories where a bar chart would
be too tall — products by revenue, customers by spend, regions by
order count. Each rectangle's area is proportional to its value.
Cheap stand-in for a geographic map when the customer doesn't have
geo data wired up; reach for a real map only after the LookML has
lat/lon or region codes.

## Snippet

```html
<canvas-chart id="chart-treemap" x="95" y="200" width="510" height="320"
              explore="<EXPLORE>">
  <canvas-listen filter="<DASHBOARD_FILTER_NAME>"></canvas-listen>
  <script type="application/json">
  {
    "chart": { "type": "treemap", "spacing": [4, 4, 4, 4] },
    "tooltip": { "enabled": true, "useHTML": true,
                 "backgroundColor": "#ffffff", "borderColor": "#ececec",
                 "borderRadius": 6, "shadow": false,
                 "style": { "color": "#444", "fontSize": "11px" } },
    "legend": { "enabled": false },
    "plotOptions": {
      "treemap": {
        "borderColor": "#ffffff",
        "borderWidth": 2,
        "layoutAlgorithm": "squarified",
        "dataLabels": {
          "enabled": true,
          "style": { "color": "#ffffff", "fontSize": "11px", "textOutline": "none", "fontWeight": "500" }
        }
      }
    },
    "series": [{
      "name": "<SERIES_NAME>",
      "categoryField": "<VIEW>.<CATEGORY_FIELD>",
      "queryField": "<VIEW>.<MEASURE>",
      "valueFormat": "<VALUE_FORMAT>",
      "colors": ["#cd7b54", "#d99272", "#e8b08e", "#f4c8a9", "#fadcc4"]
    }]
  }
  </script>
</canvas-chart>
```

## Fields to swap

- `<EXPLORE>` — explore.
- `<VIEW>.<CATEGORY_FIELD>` — the dimension shown on each rectangle
  (e.g. `products.category`).
- `<VIEW>.<MEASURE>` — the measure that sets each rectangle's area
  (e.g. `orders.revenue`).
- `<SERIES_NAME>` — series label.
- `<VALUE_FORMAT>` — vocabulary from
  `docs/canvas-dashboard-spec.md` § Number formatting. Use `usd`
  for revenue treemaps, `int` for counts.
- `colors` — palette cycled in row order.

## Notes

- **Required module:** `modules/treemap.js`. The runtime bundles this
  automatically; no extra script tags needed.
- The runtime turns series-level `categoryField` + `queryField` into
  per-point `{name, value}` objects, which is the shape Highcharts
  treemap expects. No `<script>` block or load callback needed.
- Tile data labels auto-prefix the category name, so each rectangle
  reads `Category: value` (e.g. `Search: $3,083,169`). To suppress
  the prefix, set your own `dataLabels.formatter`.
- Treemap legibility falls off above ~25 rectangles. If the explore
  could return more categories than that, pin the treemap to the
  biggest ones with a top-level `query` block (charts honor
  `query.sorts` + `query.limit`, same as `<canvas-grid>`):
  ```json
  "series": [{ "categoryField": "products.category",
               "queryField": "order_items.total_sale_price", "valueFormat": "usd" }],
  "query": { "sorts": ["order_items.total_sale_price desc"], "limit": 20 }
  ```
  Without a `query` block the chart sorts by the category field and
  returns up to 5000 rows.
- For a hierarchical treemap (groups + leaves), make each leaf row
  carry a `parent` field referencing the group's `id`, and emit
  group rows too. See Highcharts'
  [hierarchical-treemap docs](https://api.highcharts.com/highcharts/series.treemap.data.parent).
- Treemaps don't currently participate in click-to-cross-filter.
  To wire it by hand, add a `plotOptions.series.events.click`
  callback (in the def's `<script>` block) that dispatches the
  `canvas-chart-click` CustomEvent itself — there is no runtime
  helper for this; see `column-with-cross-filter.md` for the event
  shape.
