# KPI with delta

## Use when

A headline number with a period-over-period change indicator —
"$1.23M, +12% vs prior quarter". The standard executive-summary KPI.
Use this in place of the plain `kpi-strip` recipe whenever the
customer's data model has a "change vs prior period" measure
available.

## Snippet

```html
<canvas-tile order="1" x="80" y="160" width="340" height="120">
  <canvas-text x="80" y="160" width="340" height="22">
    <div class="section-h">REVENUE</div>
  </canvas-text>

  <!-- Headline number. -->
  <canvas-kpi x="90" y="190" width="200" height="80"
              explore="<EXPLORE>"
              query-field="<VIEW>.<MEASURE_VALUE>"
              format="usd"
              label="This quarter"></canvas-kpi>

  <!-- Delta. percent1-signed renders the +/- sign; supply the color
       yourself (defs are HTML — inline style or a class you define
       in the def's own <style> block). -->
  <canvas-kpi x="290" y="200" width="120" height="60"
              explore="<EXPLORE>"
              query-field="<VIEW>.<MEASURE_DELTA_PCT>"
              format="percent1-signed"
              unit="%"
              style="color: var(--cd-accent); font-size: 0.8em"
              label="vs prior quarter"></canvas-kpi>
</canvas-tile>
```

## Fields to swap

- `<EXPLORE>` — explore both measures live on.
- `<VIEW>.<MEASURE_VALUE>` — the current-period measure
  (e.g. `orders.revenue_this_quarter`).
- `<VIEW>.<MEASURE_DELTA_PCT>` — the period-over-period change as a
  signed number. If the customer's LookML doesn't already have one,
  add it once:
  ```lookml
  measure: revenue_delta_pct {
    type: number
    sql: ( ${revenue_this_period} - ${revenue_prior_period} )
       / NULLIF( ${revenue_prior_period}, 0 ) ;;
    value_format_name: percent_1
  }
  ```
- `format`:
  - Headline: `int`, `usd`, `percent1`, etc.
  - Delta: `percent1-signed` renders the leading `+`/`-` sign.
    Fall back to plain `percent1` if you want unsigned.

## Notes

- The runtime renders the signed number only — it does NOT color the
  delta by sign or add ↑/↓ arrows. If you want sign-driven styling,
  do it in the def: a small `<script>` that reads the mounted KPI's
  text and toggles a class, or two conditionally-authored variants.
  Keep "lower is better" metrics (cost, latency) in mind before
  reaching for red/green at all.
- KPIs run independent one-row queries and do NOT participate in
  filters or cross-filtering — no `<canvas-listen>` support (see the
  participation table in `docs/canvas-dashboard-spec.md`). If the
  headline must respond to a dashboard filter, restate it as a
  single-value `<canvas-chart>` instead.
- If your LookML only exposes the prior-period value (not a delta),
  build a `<canvas-text>` instead and compute the delta in a small
  `<script>` block using both KPI mounts' rendered values. Heavier;
  prefer adding the LookML measure first.
