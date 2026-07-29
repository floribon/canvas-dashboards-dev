# Customer quickstart

End-to-end: from zero to a Canvas Dashboard tile rendering in your
Looker. About 10 minutes the first time.

## Prerequisites

- A **Looker instance** with the Extension Framework enabled.
- A **Looker API client_id + client_secret** with the `develop`
  permission (used to push the LookML manifest into a dev workspace).
  Find or create one at `<your-looker>/admin/users` → pick a user →
  **Edit API keys**.
- An **AI Agent** (Claude Code, Antigravity, or Cursor) installed and authenticated.
- **Python 3.10+**.
- macOS or Linux on amd64/arm64.

## Step 1 — Install

```bash
bash <(curl -fsSL https://floribon.github.io/canvas-dashboards-dev/install.sh)
```

This downloads the latest curated payload into `~/canvas-dashboards`
(prompts if you want a different location), verifies its SHA-256
checksum against the one published next to it, and immediately runs
the bootstrap walkthrough.

Re-running the installer later is the upgrade path: your
`looker-config.json` and skill `config.json` are preserved, and
bootstrap shows each existing config with a keep/re-enter prompt
instead of asking everything again.

You'll be prompted for:

1. **Looker instance URL** — e.g. `https://yourco.looker.app`.
2. **Looker API client_id and client_secret** — written to
   `looker-config.json` at the repo root (gitignored).
3. **Default LookML model + explore** — what the dashboard-creator
   skill defaults to. The Looker sample LookML ships `basic_ecomm` /
   `basic_order_items` on every instance and is a safe answer.
4. **Looker folder ID** — where new dashboards land when you publish.
   `1` is the default Shared folder.
5. **LookML project name** — the project bootstrap creates in your
   Looker instance. `canvas_dashboards` is the safe default; override
   it only if that name is already taken on your instance (e.g. by an
   earlier partial install).

What it does:

- Downloads `scripts/toolbox` (Google's `mcp-toolbox` binary).
- Writes `skills/dashboard-creator/config.json`.
- Pushes the manifest + stub model into your Looker's LookML
  project — the name you chose at prompt 5 (`canvas_dashboards` by
  default), dev workspace.

## Step 2 — Deploy the manifest in the Looker IDE (manual)

Looker's 4.0 API can't deploy bare-repo LookML projects automatically,
so this last step is a one-time click-through. Bootstrap prints the
URL when it finishes; it's roughly:

```
<your-looker>/projects/<your-project-name>/files/manifest.lkml
```

(Bootstrap prints the exact URL — the project name is whatever you
picked at prompt 5, `canvas_dashboards` by default.)

In the IDE:

1. **Validate LookML** (top toolbar) — should report no errors.
2. **Commit Changes & Push** — the dev-mode workspace becomes a real
   commit on the project's master branch.
3. **Deploy to Production** — pushes that commit to master and
   activates the extension.

The Canvas Dashboard tile now appears in your dashboard tile gallery
under **Add Tile → Extension**.

Confirm the deploy actually landed (this is the step people miss, and
skipping it makes every publish fail with an extension_id error):

```bash
cd ~/canvas-dashboards
python3 scripts/verify-install.py
```

It probes your production instance (read-only) and prints either
"OK — the manifest is live" or the exact IDE steps still outstanding.

## Step 3 — Sanity check with the showcase

Quickest end-to-end verification — no LookML to deploy because the
showcase runs against Looker's preinstalled `basic_ecomm` sample
model:

```bash
cd ~/canvas-dashboards
python3 skills/dashboard-creator/publish/publish-dashboard.py \
  --def examples/public-showcase/ecommerce.canvasdashboard.html \
  --title "Ecommerce Showcase"
```

The script:

1. Creates a new dashboard in your configured folder.
2. Adds a Canvas Dashboard extension tile.
3. Writes the canvas-def HTML into the tile's `body_text` field
   (Looker's native dashboard_element storage).
4. Places the tile in the dashboard's active layout.
5. Prints the dashboard URL.

Open the URL. You should see a Canvas Dashboard tile rendering the
ecommerce showcase — three tiles (KPI strip, monthly trend, top
users) querying `bigquery-public-data.thelook_ecommerce` live via
Looker. Click a bar on the trend chart; the top-users grid re-queries
to that month. Pick a state in the **State** dropdown in the app's
header bar; the trend chart and the top-users grid re-query to that
state. (The app renders its own filter controls — you won't see, and
shouldn't add, Looker filter chips above the tile.)

If this works, the runtime + manifest + extension wiring are all
correct end-to-end. You're ready to author your own dashboards.

## Step 4 — Author your first dashboard

Open your AI agent in `~/canvas-dashboards`. Ask:

> Use the dashboard-creator skill to create a sales dashboard against
> the basic_ecomm model with a monthly trend, top users by spend, and
> total revenue.

The agent reads `skills/dashboard-creator/config.json` for your defaults,
queries the Looker MCP toolbox to verify field names in your model,
drafts a canvas-def into a local file, opens
`http://localhost:8765/runtime/standalone.html?path=…` in your
browser for preview, iterates with you in conversation, and finally
runs `publish-dashboard.py` when you say it's ready.

## Troubleshooting

- **`bootstrap.sh` says "no canvas_dashboards project to deploy
  into"** — the API user lacks `develop`. Open
  `<your-looker>/admin/roles`, find the role attached to the API
  user, add the `develop` permission.
- **`install-manifest.py` says "project name '…' is already taken but
  not accessible"** — the name is registered on the instance but your
  API user can't see it, usually because a project with that name was
  deleted but Looker kept its name/git registration server-side. No
  API call can recover it. Re-run `bootstrap.sh`, answer `n` at the
  `Keep these settings?` prompt, and enter a different LookML project
  name (e.g. append `_2`).
- **`Validate LookML` fails** with "Invalid property…" — most likely
  you have an old manifest from a previous install that doesn't have
  the latest entitlements. Delete the file contents and paste from
  `lookml-template/manifest.lkml.template` (replace `{{PROJECT_NAME}}`,
  `{{TILE_JS_URL}}`, and `{{TILE_JS_ORIGIN}}`).
- **Tile says "Extension not entitled to use api method X"** — the
  installed manifest predates the latest entitlements list. Re-run
  `install-manifest.py` and redeploy in the IDE.
- **Tile says "this tile has no canvas def configured"** — the
  publish step didn't write `body_text`. Verify the dashboard
  element exists (`<your-looker>/api/docs#!/Dashboard/dashboard`),
  check that its `body_text` field is populated. Re-run
  `publish-dashboard.py` if it's empty.
- **MCP server isn't connected** — Most agents read `.mcp.json` on
  session start. If you ran bootstrap mid-session, restart your agent.
  (For Claude Code, `claude mcp list` is the ground truth to check connections).
- **`looker-config.json` has wrong creds and I can't get past the
  install step** — re-run `bootstrap.sh`; it shows the stored values
  and asks whether to keep or re-enter them.
- **Publishing fails with an `extension_id` error** — the IDE deploy
  step (Step 2) hasn't completed. Run
  `python3 scripts/verify-install.py` for a definitive check and the
  exact remaining steps.

## Updating the runtime

Adam pushes runtime updates to the shared bucket. Customers get them
automatically on next tile view — `tile.js`'s cache-control is 60 s,
asset cache is 5 min. No customer action needed unless you self-host
the runtime bundle (see `scripts/deploy-to-my-bucket.sh`).

**Pinning instead of rolling.** Every release is also deployed to an
immutable versioned path, `…/hosts/v<version>/tile.js`. If your change
policy requires opting into runtime updates explicitly, set
`tile_js_url` in the skill config to a versioned URL, re-run
`install-manifest.py`, and redeploy the manifest in the IDE — your
tiles then stay on that runtime until you repoint. The rolling
`hosts/tile.js` stays the default.

## Going deeper

- `docs/architecture.md` — how the pieces fit (tile.js, body_text
  persistence, MCP authoring channel).
- `skills/dashboard-creator/README.md` — what the skill does, what
  it doesn't, where the v2 migrator design lives.
- `examples/public-showcase/README.md` — what the showcase
  demonstrates.
