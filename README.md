# Canvas Dashboards for Looker

A code-first, freeform-layout dashboard format for Looker, plus an
AI authoring skill (`dashboard-creator`) that turns natural-language
prompts into published dashboards in your Looker instance.

## Install

If you reached this directory by running `install.sh`, you're
already on the install path -- `bash scripts/bootstrap.sh` continues
from here.

For a fresh install on a new machine:

```bash
bash <(curl -fsSL https://floribon.github.io/canvas-dashboards-dev/install.sh)
```

Step-by-step walkthrough: [docs/customer-quickstart.md](docs/customer-quickstart.md).

**For AI Agents:**
When asked to create, edit, or publish a dashboard, you must read and follow the strict instructions located in `skills/dashboard-creator/SKILL.md` before taking any action.

## Layout (after install)

```
~/canvas-dashboards/
├── skills/dashboard-creator/   the AI agent skill instructions & scripts
├── runtime/                    canvas-dashboard runtime + standalone host (for local preview)
├── scripts/                    bootstrap, install-manifest, toolbox launcher
├── lookml-template/            templated manifest + stub model
├── examples/public-showcase/   smoke-test dashboard (runs on Looker's basic_ecomm)
├── serve.py                    local preview server
└── looker-config.json          your Looker creds (gitignore-style -- keep local)
```

## Update

Re-run the install one-liner above. Your `looker-config.json` and
the skill's `config.json` are preserved.
