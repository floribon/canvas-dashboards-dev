# Customer LookML manifest template

Two files install the Canvas Dashboards extension into a Looker
instance:

- `manifest.lkml.template` — the application block that registers the
  tile extension and declares the per-tile config block that holds the
  canvas-def HTML.
- `canvas_dashboards.model.lkml.template` — a minimal stub model the
  LookML project needs for the manifest to deploy. It has no explores.

## Install (automated)

Run `scripts/bootstrap.sh` — it asks for the customer's Looker URL +
API creds, then uses Looker MCP to:

1. Create a LookML project named `canvas_dashboards` (or attach the
   manifest to an existing project of the customer's choice).
2. Push these two files with `{{TILE_JS_URL}}`, `{{TILE_JS_ORIGIN}}`,
   and `{{CONNECTION_NAME}}` interpolated.
3. Deploy to production.
4. Confirm the "Canvas Dashboard" tile appears in the dashboard tile
   gallery.

## Install (manual fallback)

If MCP-driven install fails for any reason:

1. Open the Looker UI → Develop → Create a new LookML project named
   `canvas_dashboards`.
2. Paste `manifest.lkml.template` into a new `manifest.lkml`.
   Replace `{{TILE_JS_URL}}` with the bundle URL and
   `{{TILE_JS_ORIGIN}}` with its origin (everything up to the host).
3. Paste `canvas_dashboards.model.lkml.template` into a new
   `canvas_dashboards.model.lkml`. Replace `{{CONNECTION_NAME}}` with
   any connection (the model is a stub, the value doesn't matter
   beyond passing validation).
4. Validate and deploy.

## Self-hosting the runtime bundle

The default `{{TILE_JS_URL}}` points at Adam's shared bucket
(`canvas-dashboards-shared`). To self-host (e.g. for data-sovereignty
reasons):

1. `BUCKET=<your-bucket> scripts/deploy-to-my-bucket.sh`
2. Rerun bootstrap with the new bundle URL, or re-edit the manifest.

The tile uploads the canvas-def HTML inline into the dashboard's tile
config — no other customer-side storage is needed regardless of where
the bundle is hosted.
