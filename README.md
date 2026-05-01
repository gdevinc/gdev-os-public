# gdev-os-public

Public façade for the [GDEV Claude Code](https://www.anthropic.com/claude-code) plugin bootstrap.

## What this repo is

A **single-file public mirror** of `public-bootstrap.js` — the generic dispatcher that runs at the start of every Claude Code session for GDEV employees. Its only job is to:

1. Detect whether GitHub CLI (`gh`) is installed and authenticated.
2. **If not** — show a clear install tutorial to the user via a Claude Code session banner, and ping ops in our internal Slack channel so they can help proactively.
3. **If yes** — pull the actual session-start logic from our private repo (`gdevinc/shared-gdev-os`) and run it.

## What this repo is NOT

- This is **not** the source of truth. Edits here are wiped by the sync workflow.
- It contains **no** company-internal information beyond the public fact that GDEV uses Claude Code with private internal plugins.
- It contains **no** secrets — Slack webhook URLs, plugin distribution rules, group membership, and tier definitions live elsewhere (in private settings delivered per-machine via Anthropic Console managed settings, and in the private `gdevinc/shared-gdev-os` repo).

## Source of truth

- Canonical file: [`gdevinc/shared-gdev-os/scripts/public-bootstrap.js`](https://github.com/gdevinc/shared-gdev-os/blob/main/scripts/public-bootstrap.js) (private)
- Auto-synced to this repo via GitHub Action on every push to `main`.

## Why this is public

Our per-machine bootstrap (delivered via Anthropic Console managed settings) needs to fetch this script over plain HTTPS without requiring any CLI tool to be pre-installed on a brand-new GDEV laptop — including for non-engineers who never set up `gh`. That way every session can at least display an install tutorial and call out problems to ops.

The alternative — requiring every employee to install `gh` before Claude Code can do anything useful — was a worse user experience.

---

Maintained by GDEV IT/Engineering. Issues: open in private `gdevinc/shared-gdev-os`.
