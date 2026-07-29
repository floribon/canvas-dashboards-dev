# Canvas grid — card list

## Use when

A scrollable list of rich row cards (e.g. recent attritions, top
orders, latest tickets). Each row is one record rendered as a single
card with multi-column inner layout — emp id + role on the left,
metrics on the right.

## Snippet

```html
<canvas-grid class="cd-cards" explore="<EXPLORE>"
             x="1060" y="572" width="315" height="312">
  <canvas-constraint field="<VIEW>.<HARD_FILTER_FIELD>"
                     condition="equals" value="<VALUE>"></canvas-constraint>
  <script type="application/json">
  {
    "query": {
      "fields": [
        "<VIEW>.<ID_FIELD>",
        "<VIEW>.<ROLE_FIELD>",
        "<VIEW>.<DEPT_FIELD>",
        "<VIEW>.<DATE_FIELD>",
        "<VIEW>.<METRIC_1>",
        "<VIEW>.<METRIC_2>"
      ],
      "sorts": ["<VIEW>.<DATE_FIELD> desc"],
      "limit": "3"
    },
    "grid": {
      "headerHeight": 0,
      "rowHeight": 104,
      "suppressCellFocus": true,
      "suppressRowHoverHighlight": true,
      "domLayout": "normal",
      "columnDefs": [
        { "headerName": "", "flex": 1,
          "cellRenderer": "recentAttritionCell",
          "cellClass": "cg-recent-card" }
      ]
    }
  }
  </script>
</canvas-grid>
```

The cell renderer (`recentAttritionCell`) is a named function in the
dashboard's `<script>` block at the top of the file:

```js
function recentAttritionCell(params) {
  const d = params.data || {};
  return '<div class="recent-row">'
    +   '<div>'
    +     '<div class="recent-emp">'  + (d['<VIEW>.<ID_FIELD>'] || '') + '</div>'
    +     '<div class="recent-role">' + (d['<VIEW>.<ROLE_FIELD>'] || '') + '</div>'
    +     '<div class="recent-dept">' + (d['<VIEW>.<DEPT_FIELD>'] || '') + '</div>'
    +   '</div>'
    +   '<div>'
    +     '<div class="recent-date">' + d['<VIEW>.<DATE_FIELD>'] + '</div>'
    +     '<div><strong>' + d['<VIEW>.<METRIC_1>'] + '</strong></div>'
    +     '<div><strong>' + d['<VIEW>.<METRIC_2>'] + '</strong></div>'
    +   '</div>'
    + '</div>';
}
```

## Fields to swap

- The view-qualified field names in `query.fields` (all of them).
- The cellRenderer to match your row schema. Keep the
  `.recent-row / .recent-emp / .recent-role / .recent-dept /
  .recent-date` classes — they're styled in `runtime/canvas-dashboard.css`,
  and **`class="cd-cards"` on the `<canvas-grid>` is load-bearing**
  (the card-stretch CSS is scoped to it).
- `rowHeight: 104` and `limit: "3"` are tuned to fit ~3 cards in a
  312px-tall grid. Adjust both together.

## Notes

- The grid runs a regular Looker query; it participates in the
  broadcast cross-filter like any other chart.
- The `.recent-row` CSS gives each card an orange left-rule.
