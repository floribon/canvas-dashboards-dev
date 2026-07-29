# Canvas grid — heatmap

## Use when

A category × discrete-bucket heatmap (e.g. survey-category × score
1–4). Each cell shows two stacked numbers — orange (top) for one
measure series, dark (bottom) for the other — with per-row alpha
normalization (max value in row = full opacity, others scale down to
floor 0.10).

Drives the SURVEY SCORE tile on HR Attrition. Use whenever you have
~5 categories and ~4 buckets with two paired measures.

## Snippet

```html
<canvas-grid class="cd-heatmap" explore="<EXPLORE>"
             x="665" y="500" width="360" height="380">
  <script type="application/json">
  {
    "query": {
      "fields": [
        "<VIEW>.<CATEGORY_FIELD>",
        "<VIEW>.<TOP_1>", "<VIEW>.<TOP_2>", "<VIEW>.<TOP_3>", "<VIEW>.<TOP_4>",
        "<VIEW>.<BOT_1>", "<VIEW>.<BOT_2>", "<VIEW>.<BOT_3>", "<VIEW>.<BOT_4>"
      ],
      "sorts": ["<VIEW>.<CATEGORY_FIELD>"],
      "limit": "5"
    },
    "grid": {
      "headerHeight": 22,
      "rowHeight": 71,
      "suppressCellFocus": true,
      "suppressRowHoverHighlight": true,
      "domLayout": "normal",
      "columnDefs": [
        { "field": "<VIEW>.<CATEGORY_FIELD>", "headerName": "Score >>",
          "width": 110, "cellRenderer": "surveyCategoryCell",
          "cellClass": "cg-survey-label",
          "headerClass": "cg-survey-score-header" },
        { "headerName": "1", "flex": 1, "cellRenderer": "surveyHeatCell",
          "cellRendererParams": { "score": 1 },
          "cellClass": "cg-survey-heat",
          "headerClass": "cg-survey-col-header" },
        { "headerName": "2", "flex": 1, "cellRenderer": "surveyHeatCell",
          "cellRendererParams": { "score": 2 },
          "cellClass": "cg-survey-heat",
          "headerClass": "cg-survey-col-header" },
        { "headerName": "3", "flex": 1, "cellRenderer": "surveyHeatCell",
          "cellRendererParams": { "score": 3 },
          "cellClass": "cg-survey-heat",
          "headerClass": "cg-survey-col-header" },
        { "headerName": "4", "flex": 1, "cellRenderer": "surveyHeatCell",
          "cellRendererParams": { "score": 4 },
          "cellClass": "cg-survey-heat",
          "headerClass": "cg-survey-col-header" }
      ]
    }
  }
  </script>
</canvas-grid>
```

Cell renderers in the dashboard's `<script>` block:

```js
function surveyCategoryCell(params) {
  const v = String(params.value == null ? '' : params.value);
  const i = v.lastIndexOf(' ');
  return i < 0 ? v : (v.slice(0, i) + '<br>' + v.slice(i + 1));
}

function surveyHeatCell(params) {
  const score = params.colDef.cellRendererParams.score;
  const d = params.data || {};
  const P = '<VIEW>.';
  const tops = [d[P+'<TOP_1>'], d[P+'<TOP_2>'], d[P+'<TOP_3>'], d[P+'<TOP_4>']];
  const bots = [d[P+'<BOT_1>'], d[P+'<BOT_2>'], d[P+'<BOT_3>'], d[P+'<BOT_4>']];
  const maxT = Math.max.apply(null, tops);
  const maxB = Math.max.apply(null, bots);
  const vT = d[P+'<TOP_' + score + '>'];
  const vB = d[P+'<BOT_' + score + '>'];
  const aT = (0.10 + 0.9 * (vT / maxT)).toFixed(2);
  const aB = (0.10 + 0.9 * (vB / maxB)).toFixed(2);
  return '<div class="survey-cell">'
    +   '<div class="top" style="background:rgba(248,192,148,' + aT + ');">' + vT + '</div>'
    +   '<div class="bot" style="background:rgba(74,74,74,' + aB + ');">' + vB + '</div>'
    + '</div>';
}
```

## Fields to swap

- `<VIEW>.<CATEGORY_FIELD>` — the 5-ish row dimension.
- `<TOP_1..4>` — the four top-row (orange) measure values, one per
  bucket. Often produced by a derived-table view that pivots the
  source data (see HR Attrition's `survey_score.view.lkml` for the
  pattern).
- `<BOT_1..4>` — same for the bottom-row (dark) measures.

## Notes

- Heatmap shape requires the data to be pre-pivoted to (category,
  top_1..4, bot_1..4). If your LookML model doesn't have a view
  shaped like that yet, you'll need to add one — point the user at
  `examples/_internal/hr_attrition/lookml/survey_score.view.lkml` as
  the reference.
- The `survey-*` / `cg-survey-*` CSS lives in
  `runtime/canvas-dashboard.css`, scoped to `canvas-grid.cd-heatmap`.
  **`class="cd-heatmap"` on the `<canvas-grid>` is load-bearing** —
  it restores the (globally hidden) AG Grid header and stretches the
  cells. Keep it, and keep the `cg-survey-*` / `survey-cell` class
  names in the columnDefs and renderer.
