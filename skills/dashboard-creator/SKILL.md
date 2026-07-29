---
name: dashboard-creator
description: |
  Create a new Data App for the user's Looker instance against one of
  their LookML models, then publish it via the Data Apps tile
  extension. Trigger when the user asks to make/build/create a new
  data app or dashboard, especially when they describe what should be
  on it.
  Works in two modes — from a text description, or from a text
  description plus a reference image for visual style.
---

You are creating a single Data App for a Looker customer. The
runtime, the recipes, and the publish wrapper live next to this file;
the customer's Looker connection lives in `looker-config.json` at the
repo root.

## Run order

1. **Read configuration.** Two files may be present; `bootstrap.sh`
   writes both:

   - **`looker-config.json`** (repo root) — the Looker instance URL
     (`base_url`), API credentials (`client_id`/`client_secret`), and
     the default `model` + `explore`. `serve.py` reads it to proxy
     `/api/query` during preview. `publish-dashboard.py` reads
     credentials from it as well.
   - **`skills/dashboard-creator/config.json`** — publish settings:
     `project_name` (used to build the tile's `extension_id` as
     `<project_name>::canvas_dashboard_tile`), `publish_folder_id`,
     `tile_js_url`, and `size_limit_fallback.max_def_bytes` — the def
     size cap; a def over it makes `publish-dashboard.py` exit with a
     structured `def_too_large` envelope (trim inline data / split
     tiles) instead of an unmapped Looker failure.

   `publish-dashboard.py` **merges both files** (skill config wins on
   overlap): credentials come from `looker-config.json`, publish
   settings from the skill config — neither file alone is sufficient
   after a standard bootstrap. A missing `project_name` in the merged
   result makes the script exit with an error rather than silently
   creating a dashboard that 404s in the SPA (pass `--extension-id`
   explicitly to override). `scripts/verify-install.py` resolves
   config the same way and confirms the one manual step publish can't
   check — the IDE "Deploy to Production" — so point the user at it
   when publish fails with an extension/404-shaped error.

   Stop and point the user at `scripts/bootstrap.sh` if
   `looker-config.json` is missing. (`config.example.json` /
   `examples/_internal/hr_attrition/looker-config.example.json` are
   templates, not live config — don't read them as config.)

   The `model`/`explore` in `looker-config.json` are **defaults, not a
   constraint**: a def may target any model the API user can access.
   The `/api/query` proxy forwards whatever `model`/`view` each query
   names (`serve.py:run_inline_query`) — it does not pin queries to the
   config's model.

2. **Resolve the target model.** The user's prompt usually names a
   model or an explore. Use the Looker MCP to verify it exists and
   to pull the available fields:
   - `get_model(model_name)`
   - `get_lookml_models_explore(model_name, explore_name)`
   Capture field names, types, and the explore label for every chart
   you plan to build. Do *not* invent field names — every queryField,
   every constraint, every listen must reference a real LookML field.

3. **Build a layout sketch first (mental model only — don't write code
   yet).** From the user's prose, decide:
   - One row, two rows, or grid layout?
   - Sections: KPIs across the top? Donuts on the left? A big chart in
     the middle?
   - Cross-filter intent: which charts should drive filtering of the
     others?
   Sketch this as a brief bullet list in your reply BEFORE writing
   HTML, so the user can redirect cheaply.

4. **Use the recipe library.** `recipes/` has one short markdown file
   per chart pattern. Current set:
   - `kpi-strip.md` — top-of-dashboard summary numbers.
   - `kpi-with-delta.md` — headline number with period-over-period
     change indicator. **Default choice for executive summary KPIs.**
   - `filter-dropdown.md` — dashboard-level dropdown wired to
     listening charts via `<canvas-listen>`. Changing it re-queries
     the listeners live. **Include one on any dashboard with a
     natural slicing dimension (department, region, category…)** —
     it's the cheapest way to make a dashboard interactive.
   - `line-trend.md` — line/area of a measure over a date dimension.
     **Default choice for "X over time."**
   - `stacked-bar.md` — multi-measure stacked or grouped columns.
   - `column-with-cross-filter.md` — narrative bar/column that drives
     cross-filter.
   - `column-conditional-format.md` — bar/column with per-bar coloring
     by threshold. Use when "above/below target" is the story.
   - `donut-with-constraint.md` — donut for two stacked measures on a
     pinned category.
   - `gauge.md` — solid-gauge dial for "x% of goal".
   - `funnel.md` — stage-by-stage drop-off.
   - `treemap.md` — relative size across many categories.
   - `canvas-grid-card-list.md` — row-card list.
   - `canvas-grid-heatmap.md` — category × score heatmap.

   Prefer pulling from a recipe over configuring Highcharts options
   from scratch. If the user asks for a chart type a recipe doesn't
   cover, write minimal options and note "adding a recipe for this
   type would be a good follow-up."

5. **Style.** If the user attached a reference image, run:
   ```
   python3 skills/dashboard-creator/tools/extract-palette.py <image> > palette.json
   ```
   Use the named roles (accent, accent_strong, ink, ink_strong,
   ink_muted, bg, frame, card) as CSS variables at the top of the
   def. Never eyeball a color — sample from `palette.json`. If no
   image is provided, use the default palette baked into the runtime
   CSS.

6. **Write the def.** Output to the `apps/` directory as
   `apps/<dashboard-name>.canvasdashboard.html`. The file is a fragment
   in the Data App format described in
   `docs/canvas-dashboard-spec.md` — start with the existing example
   at `examples/_internal/hr_attrition/hr_attrition.canvasdashboard.html`
   as a structural reference.

   **Number formatting.** Every numeric `<canvas-kpi>` (`format=`),
   every `<canvas-chart>` series (`"valueFormat"`), and every numeric
   `<canvas-grid>` column (`"valueFormat"`) MUST carry a format from
   the vocabulary in `docs/canvas-dashboard-spec.md` § Number
   formatting. The runtime has a safety net (≤2 decimals + thousands
   separators) for un-annotated numbers but it cannot guess `$` or
   `%` — currency without `$` and ratios without `%` look broken to
   the viewer.

7. **Preview locally.** Spin up the dev server and open the standalone
   preview:
   ```
   bash skills/dashboard-creator/tools/start-preview.sh \
     apps/<dashboard-name>.canvasdashboard.html
   ```
   This wraps `python3 serve.py` and opens the right URL in the user's
   browser. Iterate conversationally — the user will ask for layout
   tweaks, color changes, etc. Edit the def in place; the page
   hot-reloads.

8. **Publish only when the user says so.** When they're happy, run:
   ```
   python3 skills/dashboard-creator/publish/publish-dashboard.py \
     --def apps/<dashboard-name>.canvasdashboard.html \
     --title "<Dashboard Title>"
   ```
   This calls Looker's REST API directly (via urllib — no MCP, no
   SDK) to create the dashboard, add a Canvas Dashboard tile, write
   the canvas-def HTML into the tile's `body_text` field, and return
   the dashboard URL. Hand the URL back to the user.

   **Filters in published dashboards.** A Data App owns its entire
   surface, filters included. The `<canvas-filter>` controls you place
   in the def render identically in the local preview and inside the
   published Looker tile — the app's own dropdown IS the filter UI.
   Publish does not create Looker-native dashboard filters; don't add
   them by hand either (the app's controls would be duplicated by
   host-chrome chips). Wire every filter to at least one
   `<canvas-listen>` so changing it actually drives a chart.

## Forbidden moves

- Inventing LookML field names. Always cross-check against the model
  via Looker MCP before writing a `queryField=` or `field=` reference.
- Publishing before the user has confirmed they're happy with the
  local preview.
- Eyeballing colors. Sample from `palette.json`.
- Configuring Highcharts options from scratch when a recipe exists.
- Modifying the runtime (anything under `runtime/`) — that's the
  shared bundle, not per-dashboard customizable.

## Iteration scope (v1)

v1 is a one-shot generator plus conversational refinement. It does
*not* attempt to match a reference image pixel-for-pixel. The image
is for palette + general visual feel only; layout is driven by the
prose.

The fuller image-to-canvas migrator (decomposition, critic loop,
convergence metrics) is sketched in
`docs/archive/DASHBOARD-MIGRATOR-SKILL.md` for the v2 cycle. Don't
try to build it on top of v1.

## When the user is stuck

- If they ask for a chart type a recipe doesn't cover, write the
  Highcharts options from scratch but keep them minimal (the runtime
  applies sane defaults) and note that adding a recipe for this type
  would be a good follow-up.
- If they want to add LookML fields that don't exist, redirect them
  to Develop mode in Looker — this skill creates dashboards against
  existing models, it doesn't author LookML.
- If publish fails (Looker API error, network, permissions), surface
  the error verbatim. Don't retry blindly.

## Reading error envelopes

Both `serve.py /api/query` and `publish-dashboard.py` return errors in
a structured envelope so you can self-correct without bouncing back
to the user every time. The shape:

```json
{
  "error_type": "field_not_found",
  "message": "Looker rejected the query (HTTP 422): ...",
  "hint": "One of the LookML fields referenced in this query doesn't exist...",
  "suggested_action": "Re-run get_explore_fields, swap the bad field..."
}
```

`publish-dashboard.py` also prints `ERROR_ENVELOPE_JSON: <json>` on
stderr; grep for that line to parse the envelope programmatically.

When you see one of these:
1. **Read `hint` first.** It names the most likely fix without you
   having to re-derive it from the raw HTTP body.
2. **Take `suggested_action` literally** when it's concrete (e.g.
   "re-run get_explore_fields"). If it's a customer-action ("ask your
   Looker admin to add `develop`"), surface that to the user verbatim
   — don't try to work around permission errors.
3. **Only escalate to the user** when the envelope says you can't
   self-correct. A typo in a field name → fix and retry silently. A
   missing permission → tell the user.
