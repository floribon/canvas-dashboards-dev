#!/usr/bin/env python3
"""
Install the Data Apps LookML manifest into a Looker instance.

Pushes lookml-template/manifest.lkml.template (and the stub model)
into the customer's LookML project (name from --project, default
`canvas_dashboards`) so the Data Apps tile extension shows up in
their dashboard tile gallery.

Uses Looker's API directly via urllib — no looker-sdk dependency, no
MCP dependency, no toolbox dependency. The SDK's file-write methods
don't exist for the 4.0 generated client; we go straight to the raw
PUT /api/4.0/projects/{p}/files endpoint with the {path, content}
body shape the toolbox source confirmed.

Credentials & target instance come from looker-config.json at the
repo root (or --config <path>).

Usage:
    python3 scripts/install-manifest.py \\
        [--project canvas_dashboards] \\
        [--tile-js-url https://.../tile.js] \\
        [--connection my_bq_conn]

Notes:
- This script does NOT commit + deploy to production. Bare-repo
  projects can't be deployed via the 4.0 API (the documented
  deploy_to_production endpoint 404s in practice). The customer
  finishes by clicking "Commit & Push" + "Deploy to Production" in
  the Looker IDE after this script runs. We surface a clear pointer
  at the end.
"""

import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_TILE_JS_URL = (
    "https://storage.googleapis.com/canvas-dashboards-shared/hosts/tile.js"
)


def _install_https_opener() -> None:
    """Install a global urllib opener with a usable CA bundle.

    macOS Python.org installs ship without CA roots wired into OpenSSL,
    so a stock `urllib.request.urlopen("https://...")` fails with
    CERTIFICATE_VERIFY_FAILED. We probe a few well-known system bundle
    locations (and certifi if present) and pass one explicitly.
    """
    candidates = [
        "/etc/ssl/cert.pem",                       # macOS
        "/etc/pki/tls/certs/ca-bundle.crt",        # RHEL/CentOS
        "/etc/ssl/certs/ca-certificates.crt",      # Debian/Ubuntu
        "/opt/homebrew/etc/openssl@3/cert.pem",    # Homebrew (Apple Silicon)
        "/usr/local/etc/openssl@3/cert.pem",       # Homebrew (Intel)
    ]
    cafile = next((p for p in candidates if os.path.exists(p)), None)
    if cafile is None:
        try:
            import certifi  # type: ignore
            cafile = certifi.where()
        except ImportError:
            return  # let the default context fail loudly
    ctx = ssl.create_default_context(cafile=cafile)
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
    urllib.request.install_opener(opener)


_install_https_opener()


def _friendly_login_error(code: int, base_url: str) -> str:
    """One-line guidance for the common login-failure HTTP codes."""
    if code == 401:
        return (
            f"login to {base_url} failed: HTTP 401. Your Looker API "
            "client_id or client_secret is wrong. Generate a fresh API "
            f"key at {base_url}/admin/users (pick a user → Edit API "
            "keys) and re-run bootstrap."
        )
    if code == 403:
        return (
            f"login to {base_url} succeeded but Looker denied the call "
            f"(HTTP 403). Check that the API user has the `develop` "
            f"permission — open {base_url}/admin/roles, find the role "
            f"attached to your API user, and add it."
        )
    if code == 404:
        return (
            f"login to {base_url} returned HTTP 404. Most likely the "
            "base URL is wrong or missing the `.looker.app` suffix. "
            "Open looker-config.json and double-check `base_url`."
        )
    return f"login to {base_url} failed: HTTP {code}."


def login(base_url: str, client_id: str, client_secret: str) -> str:
    body = urllib.parse.urlencode(
        {"client_id": client_id, "client_secret": client_secret}
    ).encode()
    req = urllib.request.Request(
        f"{base_url}/api/4.0/login", data=body, method="POST"
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"error: {_friendly_login_error(e.code, base_url)}")
    except urllib.error.URLError as e:
        sys.exit(
            f"error: couldn't reach {base_url}: {e.reason}. "
            "Check the URL in looker-config.json and your network."
        )


def call(base_url, token, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{base_url}/api/4.0{path}",
        data=data, method=method,
        headers={
            "Authorization": f"token {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return e.code, raw


def render(template_path, replacements):
    text = template_path.read_text()
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text


def main():
    repo_root = Path(__file__).resolve().parent.parent

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", default=str(repo_root / "looker-config.json"))
    p.add_argument("--project", default="canvas_dashboards")
    p.add_argument("--tile-js-url")
    p.add_argument("--connection",
                   help="Looker connection name for the stub model. If "
                        "omitted, auto-picks the first connection on the "
                        "instance (the stub model has no explores, so any "
                        "valid connection works).")
    args = p.parse_args()

    cfg = json.loads(Path(args.config).read_text())
    tile_js_url = args.tile_js_url or cfg.get("tile_js_url") or DEFAULT_TILE_JS_URL
    tile_js_origin = re.match(r"^(https?://[^/]+)", tile_js_url).group(1)
    base = cfg["base_url"].rstrip("/")
    target = cfg.get("target_url", base)

    if target != base:
        print(f"target: {target} (via SSO proxy {base})")
    else:
        print(f"target: {base}")
    print(f"project: {args.project}")
    print(f"tile.js: {tile_js_url}")
    print()

    token = login(base, cfg["client_id"], cfg["client_secret"])

    # Resolve connection name (auto-pick first if not specified).
    connection = args.connection
    if not connection:
        code_mod, mod_info = call(base, token, "GET", f"/lookml_models/{args.project}")
        allowed = []
        if code_mod == 200 and isinstance(mod_info, dict) and not mod_info.get("unlimited_db_connections", True):
            allowed = mod_info.get("allowed_db_connection_names") or []

        if allowed:
            connection = allowed[0]
            print(f"using connection: {connection} "
                  f"({len(allowed)} allowed for model '{args.project}'; auto-picked first)")
        else:
            code, conns = call(base, token, "GET", "/connections")
            if code != 200 or not isinstance(conns, list) or not conns:
                sys.exit(f"error: couldn't list connections (HTTP {code}). "
                         "Pass --connection <name> explicitly.")
            connection = conns[0]["name"]
            print(f"using connection: {connection} "
                  f"({len(conns)} available; auto-picked first)")

    # 1. Enter dev mode.
    code, _ = call(base, token, "PATCH", "/session", {"workspace_id": "dev"})
    if code != 200:
        if code == 403:
            sys.exit(
                "[1/4] dev mode failed: HTTP 403. Your Looker API user is "
                "missing the `develop` permission. Open "
                f"{base}/admin/roles, find the role attached to the API "
                "user, and add the `develop` permission. Then re-run."
            )
        sys.exit(f"[1/4] dev mode failed: HTTP {code}")
    print("[1/4] dev mode: ok")

    # 2. Ensure project exists with bare-repo git initialized, and prime
    # a dev workspace for this user. Without the PUT git_branch call,
    # file writes fail with "No developer copy found for requested
    # project."
    code, _ = call(base, token, "GET", f"/projects/{args.project}")
    if code == 200:
        print(f"[2/4] project '{args.project}' exists")
    else:
        code, body = call(base, token, "POST", "/projects",
                          {"name": args.project})
        if code == 200:
            print(f"[2/4] project '{args.project}' created")
            # Bare-repo init. PUT git_branch below 404s without this. Needs
            # `configure_git` on the API user's role (admin role by default).
            code, body = call(base, token, "PATCH", f"/projects/{args.project}",
                              {"git_remote_url": None, "git_service_name": "bare"})
            if code != 200:
                sys.exit(f"[2/4] failed to initialize bare git: HTTP {code} {body}")
        elif code == 422 and isinstance(body, str) and "already exists" in body:
            print(f"[2/4] project '{args.project}' already exists (POST 422), continuing...")
        else:
            sys.exit(f"[2/4] failed to create project: HTTP {code} {body}")

    # Check if we already have an active git branch in dev mode.
    code, body = call(base, token, "GET", f"/projects/{args.project}/git_branch")
    if code == 200 and isinstance(body, dict) and body.get("name"):
        print(f"[2/4] dev workspace ready (on branch '{body['name']}')")
    else:
        # PUT can race ahead of Looker's bare-repo creation (500 or 404 on
        # the first try right after PATCH bare-init); retry briefly.
        for branch_name in ["master", "main"]:
            for _ in range(5):
                code, body = call(base, token, "PUT",
                                  f"/projects/{args.project}/git_branch",
                                  {"name": branch_name})
                if code == 200 or code not in (404, 500):
                    break
                time.sleep(1)
            if code == 200:
                break

        if code != 200:
            # Check once more if a branch became active despite PUT error
            check_code, check_body = call(base, token, "GET", f"/projects/{args.project}/git_branch")
            if check_code == 200 and isinstance(check_body, dict) and check_body.get("name"):
                print(f"[2/4] dev workspace ready (on branch '{check_body['name']}')")
            else:
                sys.exit(f"[2/4] failed to initialize dev workspace: HTTP {code} {body}")
        else:
            print(f"[2/4] dev workspace ready")

    # 3. Write the two files.
    manifest = render(
        repo_root / "lookml-template" / "manifest.lkml.template",
        {"{{TILE_JS_URL}}": tile_js_url,
         "{{TILE_JS_ORIGIN}}": tile_js_origin,
         "{{PROJECT_NAME}}": args.project})
    model = render(
        repo_root / "lookml-template" / "canvas_dashboards.model.lkml.template",
        {"{{CONNECTION_NAME}}": connection})

    model_paths = []
    code, existing_files = call(base, token, "GET", f"/projects/{args.project}/files")
    if code == 200 and isinstance(existing_files, list):
        for f in existing_files:
            if isinstance(f, dict) and f.get("path") and f["path"].endswith(f"{args.project}.model.lkml"):
                model_paths.append(f["path"])
    if not model_paths:
        model_paths = [f"models/{args.project}.model.lkml"]

    primary_model_path = next((p for p in model_paths if p.startswith("models/")), model_paths[0])

    for p in model_paths:
        if p != primary_model_path:
            enc_path = urllib.parse.quote(p, safe="")
            call(base, token, "DELETE", f"/projects/{args.project}/files?file_path={enc_path}")

    for path, content in [("manifest.lkml", manifest), (primary_model_path, model)]:
        code, _ = call(base, token, "PUT",
                       f"/projects/{args.project}/files",
                       {"path": path, "content": content})
        if code != 200:
            # File may not exist yet — try POST (create).
            code, body = call(base, token, "POST",
                              f"/projects/{args.project}/files",
                              {"path": path, "content": content})
            if code != 200:
                sys.exit(f"[3/4] failed to write {path}: HTTP {code} {body}")
            print(f"[3/4] {path}: created")
        else:
            print(f"[3/4] {path}: updated")

    # 4. Validate. A validation problem here means the manifest that
    # just landed in the dev workspace is broken — continuing would
    # leave the customer with an IDE "Deploy" step that can't succeed.
    # Fail loudly instead of print-and-continue.
    code, body = call(base, token, "POST",
                      f"/projects/{args.project}/validate")
    manifest_ide = f"{base}/projects/{args.project}/files/manifest.lkml"
    if code == 200:
        errs = body.get("errors") if isinstance(body, dict) else None
        if errs:
            print(f"[4/4] validation errors:")
            for err in errs:
                print(f"    - {err}")
            sys.exit(
                "error: LookML validation failed for the files just "
                "written. Fix: usually a stale manifest from a previous "
                f"install — open {manifest_ide}, compare against "
                "lookml-template/manifest.lkml.template, then re-run "
                "this script."
            )
        print("[4/4] validate: ok")
    else:
        sys.exit(
            f"[4/4] error: LookML validation call failed: HTTP {code}\n"
            f"{body}\n"
            "The manifest files were written to the dev workspace but "
            "could not be validated. Common causes: the API user lost "
            "`develop` mid-run, or the project id changed. Re-run this "
            f"script; if it persists, open {manifest_ide} in the Looker "
            "IDE and click 'Validate LookML' to see the error."
        )

    print()
    print("Manifest is in dev workspace. To deploy:")
    print(f"  1. Open {manifest_ide}")
    print(f"  2. Click 'Validate LookML', then 'Commit Changes & Push'")
    print(f"  3. Click 'Deploy to Production'")
    print()
    print("(Bare-repo projects can't be deployed via the API; this is the "
          "documented Looker workflow for them. Subsequent re-runs of this "
          "script edit the dev workspace; you re-deploy via the IDE.)")


if __name__ == "__main__":
    main()
