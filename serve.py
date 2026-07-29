#!/usr/bin/env python3
"""
Local development server + Looker query proxy.

Used during dashboard authoring (the dashboard-creator skill spins this
up, then opens runtime/standalone.html in the user's browser) and as a
local preview for the example dashboards.

Responsibilities:
  - Serve static files out of the project root so runtime/standalone.html
    can fetch the runtime bundle (runtime/canvas-dashboard.js etc.) and
    any def under examples/ or a user-chosen draft path.
  - Expose `POST /api/query` — the runtime posts a Looker inline-query
    body; this proxy authenticates against Looker and forwards it.

Why the proxy exists: a Looker API client_secret can't safely live in
the browser, and looker.app won't set CORS for localhost anyway. This
keeps credentials server-side and gives the dashboard a clean
same-origin endpoint to hit.

Credentials: looker-config.json at the repo root (gitignored).
Template: examples/_internal/hr_attrition/looker-config.example.json.

Run:  python3 serve.py
URLs:
  http://localhost:8765/runtime/standalone.html?example=hr-attrition
  http://localhost:8765/runtime/standalone.html?path=<draft.canvasdashboard.html>
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
CONFIG = json.loads((ROOT / "looker-config.json").read_text())
BASE_URL = CONFIG["base_url"].rstrip("/")
PORT = int(os.environ.get("PORT", 8765))
# Bind to localhost by default. The preview server holds Looker API
# credentials in memory and proxies queries on the customer's behalf;
# we don't want it reachable from anyone else on the LAN. Pass
# `--host 0.0.0.0` if you genuinely need cross-device preview.
DEFAULT_HOST = os.environ.get("HOST", "127.0.0.1")

# Cap on /api/query POST body size. Inline Looker query JSON is tiny
# (typically <100 KB); 5 MB is ~50× the largest realistic payload and
# stops a malformed Content-Length from triggering a huge allocation.
MAX_BODY = 5 * 1024 * 1024

# Access-token cache. Looker tokens are typically valid for an hour;
# refresh ~60s before expiry to dodge clock skew.
_token = {"access_token": None, "expires_at": 0.0}


def login():
    now = time.time()
    if _token["access_token"] and now < _token["expires_at"] - 60:
        return _token["access_token"]
    body = urllib.parse.urlencode(
        {"client_id": CONFIG["client_id"], "client_secret": CONFIG["client_secret"]}
    ).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/4.0/login", data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    _token["access_token"] = data["access_token"]
    _token["expires_at"] = now + float(data["expires_in"])
    return _token["access_token"]


def run_inline_query(query):
    """POST a Looker inline query, return parsed JSON rows."""
    token = login()
    body = json.dumps(query).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/4.0/queries/run/json",
        data=body, method="POST",
        headers={
            "Authorization": f"token {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


# Structured error envelope. Returned to the runtime (and surfaced in the
# tile error card) AND read by AI-agent authoring loops — the `hint` field
# is the agent's chance to self-correct without a round trip to the user.
# We deliberately do NOT include the raw query in the response: serve.py
# is a server-side proxy with credentials, and echoing the query (model,
# view, fields, filters) back to the browser would surface LookML field
# names into network responses that a developer-tools observer can read.
# The agent reading errors does so via publish-dashboard.py's stderr
# ERROR_ENVELOPE_JSON line, not via /api/query.
def _error_envelope(error_type, message, hint, suggested_action):
    return {
        "error_type": error_type,
        "message": message,
        "hint": hint,
        "suggested_action": suggested_action,
    }


def _shape_looker_error(code, raw_body):
    """Map a Looker API HTTP error into the envelope shape, with hints
    tuned to the most common authoring mistakes."""
    body_text = raw_body or ""
    lowered = body_text.lower()

    # Field-not-found in an explore. Match Looker's specific phrasings
    # only — "Could not find field X" / "Field X not found in explore" —
    # which are unambiguous. We deliberately do NOT match the generic
    # "X does not exist" because that wording also appears on sort,
    # filter, and connection errors.
    if ("could not find field" in lowered or
        "field not found" in lowered):
        return _error_envelope(
            error_type="field_not_found",
            message=f"Looker rejected the query (HTTP {code}): {body_text[:1500]}",
            hint="One of the LookML fields referenced in this query "
                 "doesn't exist on the explore. Common causes: a typo, a "
                 "field that's on a different view, or a measure that's "
                 "been renamed. Validate field names via the Looker MCP "
                 "(`get_explore_fields`) before re-publishing.",
            suggested_action="Re-run get_explore_fields, swap the bad "
                             "field for an existing one, and retry.",
        )
    if code == 422:
        return _error_envelope(
            error_type="query_validation",
            message=f"Looker rejected the query (HTTP 422): {body_text[:1500]}",
            hint="The query is structurally invalid — usually a bad sort "
                 "expression, an unknown filter operator, or a measure "
                 "without a value_format. Check the body for the specific "
                 "field name.",
            suggested_action="Inspect the `message` text for the field, "
                             "fix the chart's JSON options or LookML "
                             "measure, and retry.",
        )
    if code == 403:
        return _error_envelope(
            error_type="permission_denied",
            message=f"Looker denied the query (HTTP 403): {body_text[:1500]}",
            hint="The API user can authenticate but cannot run this "
                 "query — usually a model access permission or a "
                 "row-level filter rule. Authoring with an admin user is "
                 "the fastest unblock; for production the customer needs "
                 "to grant the API user model access.",
            suggested_action="Have the customer add the API user to the "
                             "model's access set, or use admin credentials.",
        )
    if code in (502, 503, 504):
        return _error_envelope(
            error_type="upstream_timeout",
            message=f"Looker timed out (HTTP {code}): {body_text[:200]}",
            hint="The query took too long for Looker's edge or the "
                 "warehouse to return. Often happens on un-aggregated "
                 "full-table scans during authoring.",
            suggested_action="Add a constraint to narrow the date range, "
                             "or add a sort+limit, and retry.",
        )
    return _error_envelope(
        error_type="looker_http_error",
        message=f"Looker returned HTTP {code}: {body_text[:1500]}",
        hint="Unmapped Looker API error. Read the full `message` for "
             "context; rerun with --verbose if available.",
        suggested_action="Open the Looker API docs for this endpoint and "
                         "match the error against the documented shape.",
    )


class Handler(SimpleHTTPRequestHandler):
    # Quieter log line — only path + status.
    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.command} {self.path}  {fmt % args}\n")

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/query":
            self.send_error(404, "unknown endpoint")
            return
        length = int(self.headers.get("Content-Length") or 0)
        # Reject negative lengths too — int() accepts "-1", which would
        # slip past the cap check and turn `rfile.read(-1)` into a
        # read-until-EOF that blocks the handler on the open socket.
        if length < 0 or length > MAX_BODY:
            self._send_json(413, _error_envelope(
                error_type="payload_too_large",
                message=f"Request body length {length} is invalid "
                        f"(cap {MAX_BODY} bytes).",
                hint="Inline Looker query JSON shouldn't approach this "
                     "limit; a runaway payload or malformed "
                     "Content-Length usually means a recipe bug.",
                suggested_action="Reload the preview page.",
            ))
            return
        try:
            query = json.loads(self.rfile.read(length))
        except Exception as e:
            self._send_json(400, _error_envelope(
                error_type="bad_request_body",
                message=str(e),
                hint="The runtime sent a non-JSON body to /api/query. "
                     "Re-check the request payload.",
                suggested_action="Reload the preview page.",
            ))
            return
        try:
            rows = run_inline_query(query)
            self._send_json(200, rows)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            self._send_json(e.code, _shape_looker_error(e.code, err_body))
        except Exception as e:
            self._send_json(500, _error_envelope(
                error_type="unexpected",
                message=str(e),
                hint="An unhandled exception escaped serve.py. Re-run "
                     "with the same query and capture the traceback "
                     "from the terminal where serve.py is running.",
                suggested_action="Restart serve.py if errors persist.",
            ))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--host", default=DEFAULT_HOST,
        help="Interface to bind. Default 127.0.0.1 (localhost only). "
             "Pass 0.0.0.0 to expose on the LAN (rare; not recommended "
             "while looker-config.json holds API credentials).")
    p.add_argument("--port", type=int, default=PORT)
    args = p.parse_args()

    visible_host = "localhost" if args.host in ("127.0.0.1", "::1", "") else args.host
    print(f"serving http://{visible_host}:{args.port}  →  {ROOT}")
    print(f"  proxy /api/query  →  {BASE_URL}/api/4.0/queries/run/json")
    print(f"  bind: {args.host}:{args.port}")
    with ThreadingHTTPServer((args.host, args.port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nshutting down")


if __name__ == "__main__":
    main()
