# Dropdown filter (dashboard-level, interactive)

## Use when

The user should be able to narrow several charts at once from one
control — "filter by department", "pick a region", "only show one
product category". This is the flagship interactive-BI feature:
changing the dropdown re-queries every chart/grid that listens to it,
live against Looker. Prefer adding one of these over publishing a
static dashboard whenever a natural slicing dimension exists.

## How the trio fits together

1. `<canvas-filter>` — the visible control. Direct child of
   `<canvas-dashboard>`. Has a `name` other elements reference.
2. `<canvas-listen filter="...">` — placed inside each
   `<canvas-chart>`/`<canvas-grid>` that should respond. Charts
   without a listen ignore the filter (no auto-broadcast).
3. Changing the control calls `setFilter(name, value)` under the
   hood; every listening chart re-runs its Looker query with the
   filter projected onto the listened field. Selecting "(All)" clears
   it.

## Snippet

```html
<canvas-dashboard width="1450" height="977" looker-model="<MODEL>">

  <!-- The control. Position it in the header row or a filter bar. -->
  <canvas-filter name="<FILTER_NAME>" label="<LABEL>"
                 field="<VIEW>.<DIMENSION>"
                 ui="dropdown" values="<VAL1>,<VAL2>,<VAL3>"
                 default=""
                 x="1100" y="105" width="260" height="24"></canvas-filter>

  <!-- A chart that responds. Repeat the <canvas-listen> child in every
       chart/grid that should narrow with the dropdown. -->
  <canvas-chart id="chart-example" x="105" y="410" width="780" height="450"
                explore="<EXPLORE>">
    <canvas-listen filter="<FILTER_NAME>"></canvas-listen>
    <script type="application/json">
    { "...": "chart options as usual" }
    </script>
  </canvas-chart>

</canvas-dashboard>
```

## Fields to swap

- `<FILTER_NAME>` — the handle listens reference (e.g. `dept`,
  `region`). Not shown to users.
- `<LABEL>` — the visible label (e.g. `Department`).
- `<VIEW>.<DIMENSION>` — the LookML dimension the filter applies to.
  Must be a real field on the listening charts' explore — verify via
  MCP. Listens may override per-chart with their own `field=` when a
  chart's explore names the dimension differently.
- `values="..."` — comma-separated dropdown options. **Populate from
  real data**: run a quick MCP/explore query for the dimension's
  distinct values (top N by frequency) rather than guessing. Keep the
  list short (≤ 10) — this is a static list, not a live suggestion
  endpoint.
- `default=""` — empty string = "(All)". Set a concrete value to
  start narrowed.

## Placement conventions

- Must be a **direct child of `<canvas-dashboard>`** — a filter nested
  in a tile logs a warning and is ignored.
- Filters render as plain label+select; put them in the header strip
  (right-aligned) or a slim filter bar above the charts. Height ~24 px.
- Note for mobile: direct children that aren't tiles are hidden in the
  stacked mobile layout, so the dropdown is desktop-only today.

## What NOT to do

- Don't wire a listen for the chart whose x-axis *is* the filtered
  dimension (a dropdown on `department` pointed at a
  "count by department" column chart collapses it to one bar). Let
  that chart be the cross-filter *driver* instead.
- Don't combine with a `<canvas-constraint>` on the same field unless
  you intend the listen to override the pin when the user picks a
  value (listen wins over constraint at the field level).
- `ui="dropdown"` and `ui="text"` are the implemented controls; don't
  author `tag_list` / `slider` / `date_picker` — they silently fall
  back to a text input.

## In published Looker dashboards

The control renders inside the Looker tile exactly as it does in the
local preview — same position, same styling. A Data App owns its
entire surface, filters included; there is no separate "Looker filter"
step at publish time.

Consequences for authoring:

- The `x/y/width/height` placement is the real, shipped layout —
  position the control deliberately (header bars and top-right
  corners work well).
- A `<canvas-filter>` with **no** `<canvas-listen>` anywhere renders
  but drives nothing. Always wire at least one listener.
- Don't hand-create native Looker dashboard filters for fields a
  `<canvas-filter>` already covers — the user would see two controls
  for one field. (If someone does add one, the tile host still
  broadcasts its value onto the charts; that's a compatibility path,
  not the design.)

## Reference

`examples/_internal/hr_attrition/hr_attrition.canvasdashboard.html`
wires one `dept` dropdown to three listening tiles — the working
end-to-end example of this pattern.
`examples/public-showcase/ecommerce.canvasdashboard.html` has the
`state` dropdown in its header bar wired to the orders-trend chart
and the top-users grid.
