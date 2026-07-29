# Public showcase — Ecommerce

A simple Canvas Dashboard that runs against Looker's built-in sample
LookML — the `basic_ecomm` model with the `basic_order_items` explore
that ships preinstalled on every Looker instance.

**No LookML to deploy.** Drop the canvas def into a tile (or open the
local preview) and it just works.

The dashboard exercises the canvas features customers care most about:

- A KPI strip (total order items, total revenue, average sale price).
- A column chart that drives cross-filter (order items by month).
- A canvas-grid card list (top users by total spend, listens to the
  cross-filter via the basic_users join).

## Run it locally

From the repo root, with `looker-config.json` set up against any
Looker instance (the sample model is available on all of them):

```bash
python3 serve.py
open http://localhost:8765/runtime/standalone.html?example=public-showcase
```

The local preview hits `/api/query`, which `serve.py` proxies to
Looker.

## Publish into a Looker dashboard

Once the Canvas Dashboards tile extension is installed in your Looker
instance (see the top-level README's quickstart), publish this canvas
def as a tile using the dashboard-creator skill's publisher:

```bash
python3 skills/dashboard-creator/publish/publish-dashboard.py \
  --def examples/public-showcase/ecommerce.canvasdashboard.html \
  --title "Ecommerce Showcase"
```

The publish step writes the canvas def into the Looker tile's own
config inline. No external storage.

## Schema this is built against

Looker's built-in sample LookML (`basic_ecomm` model):

- `basic_order_items` — order-item fact table, one row per order item.
  Dimensions used here: `created_at_month`. Measures used here:
  `count` (# of order items), `total_sale_price`,
  `average_sale_price`.
- `basic_users` — joined via `basic_users.id = basic_order_items.user_id`.
  Dimensions used here: `first_name`, `last_name`, `email`, `state`.

Both views sit on top of `bigquery-public-data.thelook_ecommerce`,
which is world-readable from any GCP project.

If your Looker instance is missing the sample LookML for any reason,
follow the standard Looker docs to re-enable the sample project
(it's bundled with the product).
