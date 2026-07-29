# Donut with constraint

## Use when

A small donut showing two stacked measures (e.g. attrition_count +
current_count) for one fixed category (one department, one gender,
etc.). Each slice cross-filters by the chart's constraint AND the
slice's annotated field.

## Snippet

```html
<canvas-chart id="donut-<KEY>" x="165" y="382" width="100" height="70"
              explore="<EXPLORE>">
  <canvas-constraint field="<VIEW>.<PINNED_FIELD>"
                     condition="equals" value="<PINNED_VALUE>"></canvas-constraint>
  <script type="application/json">
  {
    "chart": { "type": "pie", "backgroundColor": "transparent",
               "spacing": [0,0,0,0], "margin": [0,0,0,0] },
    "title": { "text": null },
    "credits": { "enabled": false },
    "tooltip": { "enabled": false },
    "xAxis": { "categoryField": "<VIEW>.<PINNED_FIELD>" },
    "plotOptions": { "pie": {
      "innerSize": "56%", "size": 44, "center": ["50%","50%"],
      "borderWidth": 0, "borderRadius": 0,
      "dataLabels": {
        "enabled": true, "defer": false, "format": "{y}",
        "distance": 3, "padding": 1, "connectorWidth": 0,
        "allowOverlap": true, "crop": false, "overflow": "allow",
        "style": { "fontSize": "11px", "fontWeight": "600", "textOutline": "none" }
      },
      "states": { "hover": { "enabled": false }, "inactive": { "enabled": false } }
    } },
    "series": [{ "type": "pie", "data": [
      { "queryField": "<VIEW>.<TOP_MEASURE>", "color": "#f8c094",
        "crossFilter": { "field": "<VIEW>.<TOP_FILTER_FIELD>", "value": "<TOP_FILTER_VALUE>" },
        "dataLabels": { "style": { "color": "#ec9f78" } } },
      { "queryField": "<VIEW>.<BOTTOM_MEASURE>", "color": "#555555",
        "crossFilter": { "field": "<VIEW>.<TOP_FILTER_FIELD>", "value": "<BOTTOM_FILTER_VALUE>" },
        "dataLabels": { "style": { "color": "#444444" } } }
    ] }]
  }
  </script>
</canvas-chart>
```

## Fields to swap

- `<KEY>` — short id used in the canvas-chart id, e.g. `dept-rd`,
  `gender-male`.
- `<PINNED_FIELD>` + `<PINNED_VALUE>` — the constraint that pins this
  donut to a single category (e.g. `department = "R & D"`).
- `<TOP_MEASURE>` / `<BOTTOM_MEASURE>` — two measures the slices
  represent (e.g. `attrition_count` and `current_count`).
- `<TOP_FILTER_FIELD>` — the field the slice-level cross-filter
  emits (e.g. `is_attrited`). Same field on both slices.
- `<TOP_FILTER_VALUE>` / `<BOTTOM_FILTER_VALUE>` — what each slice's
  click should set that field to (e.g. `"Yes"` / `"No"`).

## Cross-filter behavior

- Clicking the orange slice broadcasts
  `<PINNED_FIELD>=<PINNED_VALUE>` AND `<TOP_FILTER_FIELD>=<TOP_FILTER_VALUE>`.
- Clicking the dark slice swaps the second predicate to
  `<BOTTOM_FILTER_VALUE>`.
- Clicking the same slice again clears both predicates.
- The clicked slice stays at full opacity; the other fades to 0.2.
- The runtime automatically skips the broadcast on this chart's own
  pinned field (constraint wins) and on the slice's own annotated
  field, so the donut keeps both slices visible after its own click.

## Notes

- `innerSize: "56%"` is the donut hole; smaller = thinner ring.
- Don't set `enableMouseTracking: false` — that blocks slice clicks.
