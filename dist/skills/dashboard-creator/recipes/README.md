# Chart recipes

One short file per chart pattern. Each recipe contains:

- A one-line "use when" guide.
- A canonical HTML snippet — the canvas element with its inline
  Highcharts options ready to paste into a `*.canvasdashboard.html`.
- A "fields to swap" checklist of the LookML field names and labels
  the author replaces.

When in doubt, copy the recipe verbatim and only edit the fields the
checklist names. Don't reconfigure Highcharts options on top of these
— they're tuned to match the canvas-dashboard look and the runtime's
cross-filter expectations.

If a chart type isn't in the library yet, write the options from
scratch but keep them minimal (the runtime applies sane defaults).
Adding a new recipe is a good follow-up after that dashboard ships.

## Available recipes

| File | Use when |
| --- | --- |
| `kpi-strip.md`                  | Top-of-dashboard summary numbers (rates, totals, counts). |
| `kpi-with-delta.md`             | Headline number with a period-over-period change indicator (↑ 12% vs prior quarter). |
| `filter-dropdown.md`            | Dashboard-level dropdown that live re-queries every listening chart. **Add one whenever a natural slicing dimension exists.** |
| `line-trend.md`                 | Line/area of a measure over a date dimension — the default "trend over time" chart. |
| `stacked-bar.md`                | Two or more measures stacked (or grouped) over one category dimension. |
| `column-with-cross-filter.md`   | Single-series narrative bar/column chart that drives cross-filter on its category. |
| `column-conditional-format.md`  | Bar/column where each bar is colored by value vs a threshold (green ≥ target, red < target). |
| `donut-with-constraint.md`      | Small donut showing two stacked measures (e.g. attrition vs current) for one fixed category. Slice clicks cross-filter. |
| `gauge.md`                      | Single-metric progress dial — % of goal, score out of n. |
| `funnel.md`                     | Stage-by-stage drop-off — sign-up flow, sales pipeline, conversion funnel. |
| `treemap.md`                    | Relative-size view across many categories — products by revenue, customers by spend. |
| `canvas-grid-card-list.md`      | Row-card list (e.g. recent items), one card per row with multi-column cell renderer. |
| `canvas-grid-heatmap.md`        | Category × score heatmap (top half = orange, bottom half = dark) with per-row alpha normalization. |
