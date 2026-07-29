#!/usr/bin/env python3
"""
Verify the Data Apps install end-to-end — specifically that the manual
"Deploy to Production" step in the Looker IDE actually happened.

`install-manifest.py` can only write the manifest into a *dev*
workspace (bare-repo projects can't be deployed via the 4.0 API), so
the one thing bootstrap can't confirm is the production deploy. This
script probes it read-only: a fresh API session sees the production
workspace, where `GET /projects/{p}/manifest` returns 200 only after
the project has been deployed (verified: a dev-only project 404s
there). If production says no, a second look at the dev workspace
distinguishes "deploy step missed" from "install never ran".

(We deliberately do NOT probe by creating an extension dashboard
tile — Looker accepts unknown extension_ids at element-creation time,
so that check false-positives.)

Exit 0: manifest is live in production; publishing will work.
Exit 1: not deployed / not installed / config problem — the output
        says which and what to do.

Usage:
    python3 scripts/verify-install.py [--config <path>]

Config resolution matches publish-dashboard.py exactly: merge
looker-config.json (credentials) with the skill's config.json
(publish settings; wins on overlap). Bootstrap splits the config
across those two files, so neither alone is sufficient. (Identical
policy matters: this script exists to predict whether publish will
work, so it must read the same effective config publish reads.) The
Looker API plumbing (HTTPS opener, login, call) is imported from
install-manifest.py, which ships alongside this script.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

# install-manifest.py has a hyphen in its name, so import it by path.
# Importing it also installs the HTTPS opener with a usable CA bundle
# (module-level side effect there, wanted here too).
_im_path = Path(__file__).resolve().parent / "install-manifest.py"
_spec = importlib.util.spec_from_file_location("install_manifest", _im_path)
_im = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_im)
login, call = _im.login, _im.call


def resolve_config(explicit_path):
    """Resolve config exactly like publish-dashboard.py: merge
    looker-config.json (credentials) with the skill's config.json
    (publish settings; wins on overlap). With --config, read just
    that file."""
    repo_root = Path(__file__).resolve().parent.parent
    if explicit_path:
        return json.loads(Path(explicit_path).read_text())
    candidates = [repo_root / "looker-config.json",
                  repo_root / "skills" / "dashboard-creator" / "config.json"]
    found = [p for p in candidates if p.exists()]
    if not found:
        sys.exit("error: no config found. Looked at:\n"
                 + "\n".join(f"  {p}" for p in candidates)
                 + "\nRun scripts/bootstrap.sh first.")
    merged = {}
    for p in found:
        merged.update(json.loads(p.read_text()))
    return merged


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", help="explicit config path (optional)")
    args = p.parse_args()

    cfg = resolve_config(args.config)
    base = (cfg.get("base_url") or cfg.get("looker_instance_url") or "").rstrip("/")
    cid, sec = cfg.get("client_id"), cfg.get("client_secret")
    if not (base and cid and sec):
        sys.exit("error: config is missing base_url/client_id/client_secret. "
                 "Re-run scripts/bootstrap.sh.")
    # Same policy as publish-dashboard.py: a missing project_name is a
    # config error, not a silent fallback — otherwise this script can
    # probe the wrong project and contradict what publish would do.
    project = cfg.get("project_name")
    if not project:
        sys.exit("error: config is missing 'project_name' (the LookML "
                 "project bootstrap created). Re-run scripts/bootstrap.sh, "
                 "or add project_name to "
                 "skills/dashboard-creator/config.json.")

    print(f"target:       {base}")
    print(f"extension_id: {project}::canvas_dashboard_tile")
    print()

    token = login(base, cid, sec)

    # A fresh session looks at the production workspace. The manifest
    # endpoint 200s only for deployed projects.
    code, _ = call(base, token, "GET", f"/projects/{project}/manifest")
    if code == 200:
        print("OK — the Data Apps manifest is live in production.")
        print("Publishing will work. Next: author a dashboard with the")
        print("dashboard-creator skill, or sanity-check with the showcase:")
        print("  python3 skills/dashboard-creator/publish/publish-dashboard.py \\")
        print("    --def examples/public-showcase/ecommerce.canvasdashboard.html \\")
        print("    --title \"Ecommerce Showcase\"")
        return
    if code != 404:
        sys.exit(f"error: unexpected response probing production "
                 f"(HTTP {code}). Check the API user's permissions and "
                 "re-run.")

    # Production says no. Look at the dev workspace to tell "deploy
    # step missed" apart from "install never ran".
    code, _ = call(base, token, "PATCH", "/session",
                   {"workspace_id": "dev"})
    if code == 403:
        # Can't see dev at all — don't misreport that as NOT INSTALLED.
        sys.exit(
            "error: the API user can't switch to the dev workspace "
            "(HTTP 403 — it lacks the `develop` permission), so this "
            "script can't tell whether the project is installed but "
            "undeployed. Grant `develop` to the API user's role and "
            "re-run."
        )
    if code != 200:
        # Transient 5xx/429 etc. — likewise not a NOT INSTALLED verdict.
        sys.exit(f"error: unexpected HTTP {code} switching to the dev "
                 "workspace. Likely transient — re-run; if it persists, "
                 "check the API user's permissions.")
    # The guards above guarantee we're in the dev workspace here.
    code, _ = call(base, token, "GET", f"/projects/{project}")
    if code not in (200, 404):
        # Don't misdiagnose a transient API error as NOT INSTALLED.
        sys.exit(f"error: unexpected HTTP {code} probing the dev "
                 f"workspace for project '{project}'. Check the API "
                 "user's permissions and re-run.")
    dev_visible = (code == 200)

    if dev_visible:
        sys.exit(
            "NOT DEPLOYED — the manifest is in your dev workspace but the\n"
            "one-time IDE deploy step hasn't completed. Finish it now\n"
            "(30 seconds):\n"
            f"  1. Open {base}/projects/{project}/files/manifest.lkml\n"
            "  2. Click 'Validate LookML' -> 'Commit Changes & Push'\n"
            "  3. Click 'Deploy to Production'\n"
            "Then re-run this script to confirm."
        )
    sys.exit(
        f"NOT INSTALLED — no LookML project named '{project}' is visible\n"
        "to this API user (dev or production). Either bootstrap hasn't\n"
        "run its manifest step yet, or the skill config's project_name\n"
        "doesn't match what was installed. Run scripts/bootstrap.sh, or\n"
        "fix project_name in skills/dashboard-creator/config.json."
    )


if __name__ == "__main__":
    main()
