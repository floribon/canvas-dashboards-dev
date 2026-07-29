#!/usr/bin/env python3
"""
Publish a Data App to the customer's Looker instance.

Creates a new Looker dashboard, adds a Data Apps extension tile,
stashes the app-def HTML in the tile's `body_text` field, and lays
the tile out so it actually shows up.

The runtime (tile.js) reads the def back via the SDK's
`dashboard_element(elementId)` call on mount. No external def
storage; no GCS bucket per customer; just Looker's own
dashboard_element row.

Talks to Looker via urllib — no looker-sdk dependency. Config search
order: --config <path>, skills/dashboard-creator/config.json, then
looker-config.json at the repo root. The chosen file must contain
client_id + client_secret + project_name plus either base_url or
looker_instance_url.

Usage:
    python3 publish-dashboard.py --def <path.html> --title "<title>"
                                 [--folder-id <id>]
                                 [--extension-id <project_name>::canvas_dashboard_tile]

If --extension-id is omitted, it's derived from the skill config's
`project_name` field, producing `{project_name}::canvas_dashboard_tile`.
`project_name` is required in the skill config (bootstrap.sh writes
it) — if it's missing the script exits with an error rather than
falling back to a stale default that produces 404 dashboards.
"""

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _install_https_opener() -> None:
    """Install a global urllib opener with a usable CA bundle.

    Mirrors scripts/install-manifest.py — macOS Python.org installs
    ship without CA roots wired into OpenSSL.
    """
    candidates = [
        "/etc/ssl/cert.pem",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/certs/ca-certificates.crt",
        "/opt/homebrew/etc/openssl@3/cert.pem",
        "/usr/local/etc/openssl@3/cert.pem",
    ]
    cafile = next((p for p in candidates if os.path.exists(p)), None)
    if cafile is None:
        try:
            import certifi  # type: ignore
            cafile = certifi.where()
        except ImportError:
            return
    ctx = ssl.create_default_context(cafile=cafile)
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
    urllib.request.install_opener(opener)


_install_https_opener()


def load_config(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"error: config file not found at {path}. "
                 "Run scripts/bootstrap.sh to create it.")
    return json.loads(path.read_text())


# Guard against defs too large for Looker's dashboard_element.body_text.
# Looker doesn't document a hard cap; defs in the tens of KB store fine
# (HR Attrition ~40 KB is the canary) and the practical API-body ceiling
# is around 1 MB. Default to ~90% of that so the failure is a structured
# envelope with a fix, not an unmapped Looker 500/413 mid-publish.
# Override per-customer via `size_limit_fallback.max_def_bytes` in the
# skill config.
DEFAULT_MAX_DEF_BYTES = 900_000


def _die_with_envelope(env: dict) -> None:
    """Emit a structured error envelope on stderr (human lines + the
    machine-parseable ERROR_ENVELOPE_JSON) and exit non-zero."""
    sys.stderr.write("error: " + env["message"] + "\n")
    sys.stderr.write("  hint: " + env["hint"] + "\n")
    sys.stderr.write("  suggested_action: " + env["suggested_action"] + "\n")
    sys.stderr.write("ERROR_ENVELOPE_JSON: " + json.dumps(env) + "\n")
    sys.exit(1)


def check_def_size(html: str, cfg: dict) -> None:
    fallback = cfg.get("size_limit_fallback")
    if not isinstance(fallback, dict):
        # Tolerate a malformed value (string, number, null) — the guard
        # should never be the thing that breaks a publish.
        fallback = {}
    limit = int(fallback.get("max_def_bytes") or DEFAULT_MAX_DEF_BYTES)
    size = len(html.encode("utf-8"))
    if size <= limit:
        return
    _die_with_envelope({
        "error_type": "def_too_large",
        "message": (f"canvas def is {size:,} bytes; the configured "
                    f"body_text size limit is {limit:,} bytes."),
        "hint": ("Looker stores the def in dashboard_element.body_text; "
                 "very large defs are almost always inline mock data or "
                 "base64 assets that shouldn't ship in the published def."),
        "suggested_action": ("Trim the <script id=\"canvas-data\"> mock-data "
                             "block and any embedded images, or split the "
                             "dashboard into multiple tiles. If the def is "
                             "irreducible, host it externally and publish a "
                             "{\"def_url\": ...} pointer via "
                             "rich_content_json (see docs/architecture.md), "
                             "or raise size_limit_fallback.max_def_bytes in "
                             "the skill config if your instance verifiably "
                             "accepts more."),
    })


def login(base_url, client_id, client_secret):
    body = urllib.parse.urlencode(
        {"client_id": client_id, "client_secret": client_secret}
    ).encode()
    req = urllib.request.Request(
        f"{base_url}/api/4.0/login", data=body, method="POST"
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())["access_token"]


def _hint_for_publish_error(method, path, code, body_text, base_url):
    """Build a hint + suggested action tuned to the most common publish failures."""
    lowered = (body_text or "").lower()
    if code == 401:
        return ("Your Looker API key is invalid or expired. Regenerate "
                "the key in the Looker admin UI and update looker-config.json.",
                "Re-run scripts/bootstrap.sh to re-prompt for credentials.")
    if code == 403:
        return (f"The API user is authenticated but lacks permission for "
                f"{method} {path}. For dashboard publishing the user needs "
                f"`develop` (or at minimum `manage_models` + dashboard write).",
                f"Add the missing role in {base_url}/admin/roles, or use "
                f"admin credentials.")
    if code == 404 and "folder" in lowered:
        return ("The configured publish_folder_id doesn't exist or the API "
                "user can't see it.",
                "Open the customer's looker-config.json / skill config, set "
                "publish_folder_id to a valid folder, and retry.")
    if code == 404:
        return (f"{method} {path} returned 404. Most likely a stale id "
                "(dashboard, element, or layout was deleted between "
                "calls), or the path is wrong.",
                "Re-run publish-dashboard.py to recreate the dashboard "
                "from scratch.")
    if code == 422 and "extension_id" in lowered:
        return ("Looker doesn't recognize the extension_id — the LookML "
                "manifest probably hasn't been deployed to production "
                "yet, or the extension_id has a typo.",
                f"Open {base_url}/projects -> pick the project whose "
                "name matches the prefix before `::` in your "
                "extension_id -> open manifest.lkml -> click Validate "
                "-> Commit -> Deploy to Production, then retry.")
    if code == 422:
        return ("Looker rejected the request body as invalid. The HTTP "
                "body has the specific field that's wrong.",
                "Inspect `message` for the field name and fix the publish "
                "script's payload, or update the canvas def.")
    return ("Unmapped Looker API error. The full response body is in `message`.",
            "Open Looker's API docs for this endpoint and match the error "
            "against the documented shape.")


def _publish_error_envelope(method, path, code, body_text, base_url):
    """Structured error envelope, shape-compatible with serve.py."""
    hint, action = _hint_for_publish_error(method, path, code, body_text, base_url)
    return {
        "error_type": f"looker_http_{code}",
        "message": f"{method} {path} -> HTTP {code}: {body_text[:1500]}",
        "hint": hint,
        "suggested_action": action,
    }


def call(base, token, method, path, body=None, raise_on_err=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{base}/api/4.0{path}", data=data, method=method,
        headers={"Authorization": f"token {token}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        if raise_on_err:
            # Emitted as both human-readable lines AND a JSON envelope on
            # stderr — the AI agent driving this script can parse the
            # envelope to self-correct without needing to scrape stdout.
            _die_with_envelope(
                _publish_error_envelope(method, path, e.code, raw, base))
        return e.code, raw


def publish(args):
    # Locate config.json. The skill ships symlinked into
    # ~/.claude/skills/dashboard-creator, so __file__ usually points
    # through that symlink. Path.resolve() walks the symlink to the
    # real on-disk install location before we navigate parents, so
    # skill_root / repo_root land in the actual install dir (not
    # ~/.claude).
    script = Path(__file__).resolve()
    skill_root = script.parent.parent              # .../skills/dashboard-creator
    install_root = script.parent.parent.parent.parent  # .../<install dir>

    if args.config:
        cfg_path = Path(args.config)
        cfg = load_config(cfg_path)
    else:
        # A standard bootstrap splits the config across two files:
        # looker-config.json holds the API credentials; the skill's
        # config.json holds publish settings (project_name, folder,
        # model defaults). Merge them — skill config wins on overlap —
        # so a canonically bootstrapped machine publishes with no
        # flags. scripts/verify-install.py resolves identically so it
        # validates the exact config this script will read; keep the
        # two in sync.
        candidates = [install_root / "looker-config.json",
                      skill_root / "config.json"]
        found = [p for p in candidates if p.exists()]
        if not found:
            sys.exit(
                "error: no config file found. Looked at:\n"
                + "\n".join(f"  {p}" for p in candidates)
                + "\nRun scripts/bootstrap.sh to create them, or pass "
                "--config <path> explicitly."
            )
        cfg = {}
        for p in found:
            cfg.update(load_config(p))
        cfg_path = " + ".join(str(p) for p in found)

    base = (cfg.get("base_url") or cfg.get("looker_instance_url") or "").rstrip("/")
    cid = cfg.get("client_id")
    sec = cfg.get("client_secret")
    if not (base and cid and sec):
        sys.exit(
            f"error: config at {cfg_path} is missing "
            "base_url/client_id/client_secret. "
            "Populate it (or re-run scripts/bootstrap.sh)."
        )
    folder_id = args.folder_id or cfg.get("publish_folder_id") or "1"
    if not args.extension_id:
        project_name = cfg.get("project_name")
        if not project_name:
            sys.exit(
                f"error: config at {cfg_path} is missing 'project_name'. "
                "Re-run scripts/bootstrap.sh, or pass --extension-id explicitly."
            )
        args.extension_id = f"{project_name}::canvas_dashboard_tile"

    html = Path(args.def_path).read_text()
    check_def_size(html, cfg)
    print(f"def: {args.def_path} ({len(html):,} bytes)")
    print(f"target: {base}")
    print(f"folder: {folder_id}")
    print()

    token = login(base, cid, sec)

    # 1. Create the dashboard.
    code, dash = call(base, token, "POST", "/dashboards", {
        "title": args.title, "folder_id": str(folder_id),
    })
    dash_id = dash["id"]
    print(f"[1/5] dashboard created: id={dash_id}")

    # 2. Add an extension dashboard_element.
    code, el = call(base, token, "POST", "/dashboard_elements", {
        "dashboard_id": str(dash_id),
        "type": "extension",
        "extension_id": args.extension_id,
        "title": args.title,
    })
    el_id = el["id"]
    print(f"[2/5] dashboard_element created: id={el_id}")

    # 3. Stash the canvas def in body_text.
    code, _ = call(base, token, "PATCH", f"/dashboard_elements/{el_id}", {
        "body_text": html,
    })
    print(f"[3/5] body_text set ({len(html):,} bytes)")

    # 4. Place the element in the dashboard's active layout.
    code, ddash = call(base, token, "GET", f"/dashboards/{dash_id}")
    layouts = ddash.get("dashboard_layouts") or []
    active = next((l for l in layouts if l.get("active")), layouts[0] if layouts else None)
    if not active:
        sys.exit("error: dashboard has no layout after creation")
    layout_id = active["id"]
    # The component for this element usually exists already (Looker
    # auto-adds one per element); PATCH it into place if so, POST a
    # fresh one otherwise. Either call exits with a structured error
    # envelope on a non-2xx (call() raises by default), so the success
    # line below is only reached when the placement actually landed.
    component = next((c for c in (active.get("dashboard_layout_components") or [])
                      if str(c.get("dashboard_element_id")) == str(el_id)), None)
    if component:
        call(base, token, "PATCH",
             f"/dashboard_layout_components/{component['id']}",
             {"row": 0, "column": 0, "width": 24, "height": 16})
    else:
        call(base, token, "POST", "/dashboard_layout_components", {
            "dashboard_layout_id": str(layout_id),
            "dashboard_element_id": str(el_id),
            "row": 0, "column": 0, "width": 24, "height": 16,
        })
    print(f"[4/5] tile placed in layout id={layout_id}")

    # 5. Print the dashboard URL.
    print(f"[5/5] done")
    print()
    print(f"{base}/dashboards/{dash_id}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--def", dest="def_path", required=True,
                   help="Path to the canvas def HTML")
    p.add_argument("--title", required=True, help="Dashboard title")
    p.add_argument("--folder-id", help="Looker folder id (overrides config)")
    p.add_argument("--config", help="Path to looker-config.json or skill config.json")
    p.add_argument("--extension-id",
                   default=None,
                   help="LookML extension id from the manifest. Defaults "
                        "to '<project_name>::canvas_dashboard_tile' using "
                        "the skill config's project_name. If the config is "
                        "missing project_name the script exits — pass this "
                        "flag explicitly to override.")
    publish(p.parse_args())


if __name__ == "__main__":
    main()
