# KPI strip

## Use when

A row of summary numbers across the top of the dashboard — e.g.
"16.1% attrition rate · 237 total · 1,233 current". One
`<canvas-kpi>` per number.

## Snippet

```html
<canvas-tile order="1" x="85" y="170" width="540" height="140">
  <canvas-text x="95" y="178" width="510" height="22">
    <div class="section-h">OVERVIEW</div>
  </canvas-text>

  <canvas-kpi x="95"  y="220" width="170" height="80"
              explore="<EXPLORE>"
              query-field="<VIEW>.<MEASURE_PERCENT>"
              format="percent1"
              unit="%" label="<LINE1>&lt;br&gt;<LINE2>"
              icon='<div style="background:#ececec;width:32px;height:32px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#7a7a7a;font-size:18px;">&#9698;</div>'></canvas-kpi>

  <canvas-kpi x="275" y="220" width="160" height="80"
              explore="<EXPLORE>"
              query-field="<VIEW>.<MEASURE_COUNT>"
              format="int"
              label="<LINE1>&lt;br&gt;<LINE2>"
              icon='<div style="background:#ececec;width:32px;height:32px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#7a7a7a;font-size:17px;">&#10148;</div>'></canvas-kpi>
</canvas-tile>
```

## Fields to swap

- `<EXPLORE>` — the explore from Looker MCP.
- `<VIEW>.<MEASURE_PERCENT>` — a measure with `value_format: "0.0%"`.
- `<VIEW>.<MEASURE_COUNT>` — any integer measure.
- `<LINE1>`, `<LINE2>` — two-line label. Use `&lt;br&gt;` for the
  break.
- `format` — `percent1` (multiplies by 100 + one decimal),
  `int` (thousands separators), or omit for raw.
- Icon — a small inline SVG/HTML entity; the example uses Unicode
  glyphs (◢ for rate, ➤ for total, 👥 for current). Replace with any
  icon you like.

## Notes

- KPIs run their own one-row query (`limit: '1'`); they don't
  participate in the cross-filter broadcast.
- Width 170 fits a 3-digit number comfortably; bump to 200 for
  larger numbers.
