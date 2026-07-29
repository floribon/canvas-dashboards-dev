# dashboard-creator skill

A Claude Code skill for creating new Data Apps against a Looker
customer's LookML models, previewing locally, and publishing to
their Looker instance.

This directory is symlinked into `~/.claude/skills/dashboard-creator`
by `scripts/bootstrap.sh`. See `SKILL.md` for the trigger prompt
Claude reads.

## Layout

```
SKILL.md              Trigger + run-order Claude follows
config.example.json   Template for the customer's local config
config.json           Customer-specific config (gitignored — created by bootstrap)
recipes/              Chart-options snippets for common patterns
tools/
  extract-palette.py  Sample a palette from a reference image
  start-preview.sh    Spin up serve.py and open the standalone preview
publish/
  publish-dashboard.py  Push a finished def to Looker via the REST API (urllib)
```

## v1 scope

Two modes, both single-pass + conversational iteration:

1. **From prose** — user describes what they want, skill writes a
   canvas-def HTML against an existing LookML model, opens a local
   preview, user iterates by chatting.
2. **From prose + style image** — same as above, but a reference
   image provides the color palette via `tools/extract-palette.py`.

What v1 does NOT do (deferred to v2):
- Pixel-matching layout to a reference image.
- A render→VLM-critic→re-implement convergence loop.
- Block-Match IoU / SSIM convergence metrics.

The fuller "migrator" design is sketched in
`docs/archive/DASHBOARD-MIGRATOR-SKILL.md`.

## Configuration

Run `scripts/bootstrap.sh` once per machine. It creates `config.json`
with the customer's Looker instance URL, default LookML model, target
publish folder, runtime bundle URL, and `project_name` (the LookML
project whose extension the published tiles reference). Credentials
live separately in the repo-root `looker-config.json`; publish merges
the two.

If you need to edit it directly, see `config.example.json` for the
schema.
