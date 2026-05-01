// GDEV Claude Code Plugin Bootstrap — PUBLIC façade.
//
// This file is intentionally public. Its sole job is to:
//   1) Detect whether GitHub CLI (`gh`) is installed and authenticated on the user's machine.
//   2a) If NOT — show a clear install tutorial to the user via a SessionStart banner,
//       and ping ops in Slack so they can help proactively.
//   2b) If YES — pull the private `session-start.js` from gdevinc/shared-gdev-os and run it.
//       That private script contains all the internal logic (plugin tiers, group membership,
//       distribution rules, etc.) and is intentionally NOT exposed in this public file.
//
// What this file does NOT contain (intentionally):
//   - Any list of plugin tiers, groups, or distribution rules.
//   - Any Slack webhook URL — that comes from the outer-scope variable `W`,
//     defined in the per-machine managed-settings.json (which is delivered to each
//     user privately via Anthropic Console managed settings, not through this repo).
//   - Any company-internal information beyond the public fact that we use a private
//     repo at gdevinc/shared-gdev-os and a private Slack channel for alerts.
//
// Source of truth: gdevinc/shared-gdev-os/scripts/public-bootstrap.js
// This file is auto-mirrored to gdevinc/gdev-os-public/public-bootstrap.js on each
// push to main, and the per-machine managed-settings.json fetches the mirrored copy
// over plain HTTPS (no auth required for this façade).

const { execSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const https = require("https");

// Webhook is provided by outer-scope `W` from the bootstrap that eval()d this file.
// When run standalone (no eval context), W is undefined and Slack POSTs are silently skipped.
const SLACK_WEBHOOK_URL = (typeof W !== "undefined" && typeof W === "string") ? W : "";

function tx(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Best-effort identity for ops to find the user in Slack — only generic local sources.
// Detailed identity gathering (Chromium, Apple ID, mac RealName, etc) lives in the
// private session-start.js and gets cached into ~/.claude/gdev-os-hook-state.json
// for use by future bootstrap invocations even when the private script can't be fetched.
function gatherBasicIdentity() {
  const id = {};
  try { id.osUser = os.userInfo().username; } catch {}
  id.hostname = os.hostname();
  id.platform = process.platform;
  if (process.platform === "darwin") {
    const lhn = tx("scutil --get LocalHostName");
    if (lhn) id.localHostName = lhn;
  }
  id.gitEmail = tx("git config --global user.email") || tx("git config user.email");
  id.gitName = tx("git config --global user.name") || tx("git config user.name");

  // Read whatever the private script left in the cache from prior successful sessions.
  // This lets us include richer identity (Chromium corp email, etc) even when the
  // private script itself is unreachable on this run.
  try {
    const statePath = path.join(os.homedir(), ".claude", "gdev-os-hook-state.json");
    if (fs.existsSync(statePath)) {
      const cached = JSON.parse(fs.readFileSync(statePath, "utf8")).lastIdentity || {};
      // Cached values win over inline only when inline didn't find anything (richer signal).
      if (!id.gitEmail && cached.gitEmail) id.gitEmail = cached.gitEmail;
      if (!id.gitName && cached.gitName) id.gitName = cached.gitName;
      id.cached = {
        chromiumCorpEmail: cached.chromiumCorpEmail || "",
        chromiumCorpName: cached.chromiumCorpName || "",
        macRealName: cached.macRealName || "",
        appleId: cached.appleId || "",
        clientLabel: cached.clientLabel || "",
      };
    }
  } catch {}

  // Claude Code client surface — set by Claude Code itself in env.
  const ent = process.env.CLAUDE_CODE_ENTRYPOINT || "";
  const cb = process.env.__CFBundleIdentifier || "";
  let client = "unknown";
  if (ent === "claude-vscode" || cb === "com.microsoft.VSCode") client = "VS Code";
  else if (ent === "claude-desktop" || (cb || "").toLowerCase().includes("anthropic")) client = "Desktop app";
  else if (ent === "claude-cli" || cb === "com.apple.Terminal" || cb === "com.googlecode.iterm2") client = "Terminal (CLI)";
  else if (ent === "claude-jetbrains" || (cb || "").toLowerCase().includes("jetbrains")) client = "JetBrains";
  else if (ent) client = ent;
  id.clientLabel = client;
  return id;
}

function postSlack(textLines) {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    const u = new URL(SLACK_WEBHOOK_URL);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: 3000,
      },
      (r) => { r.on("data", () => {}); r.on("end", () => {}); }
    );
    req.on("error", () => {});
    req.on("timeout", () => { try { req.destroy(); } catch {} });
    req.write(JSON.stringify({ text: textLines.filter(Boolean).join("\n") }));
    req.end();
  } catch {}
}

function emitBanner(text) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
    }) + "\n");
  } catch {}
}

function whoLines(id, kind) {
  const cce = id.cached && id.cached.chromiumCorpEmail;
  const ccn = id.cached && id.cached.chromiumCorpName;
  return [
    `🚨 *gdev-os-bootstrap: ${kind}*`,
    id.cached ? "_(includes cached identity from previous successful session)_" : "_(no prior cache — minimal identity from local sources)_",
    "",
    "*Who:*",
    cce ? `  🏢 email (Chromium): ${cce}` : null,
    id.gitEmail && id.gitEmail !== cce ? `  email (git): ${id.gitEmail}` : null,
    ccn ? `  full-name: ${ccn}` : null,
    id.gitName && id.gitName !== ccn ? `  full-name (git): ${id.gitName}` : null,
    id.osUser ? `  os-user: ${id.osUser}` : null,
    id.hostname ? `  hostname: ${id.hostname}` : null,
    id.localHostName && id.localHostName !== id.hostname ? `  local-hostname: ${id.localHostName}` : null,
    `  Claude Code client: ${id.clientLabel}`,
    `  platform: ${id.platform}`,
  ];
}

// === Main flow ===
// Wrapped in IIFE so we can early-return cleanly. (Top-level `return` is illegal when this
// file is eval'd inside the managed-settings.json bootstrap one-liner — eval inherits the
// enclosing scope, which is `node -e` module top-level.)
(function main() {

const ghPath = tx("command -v gh");
const id = gatherBasicIdentity();

if (!ghPath) {
  // No gh CLI on this machine — show install tutorial + alert ops.
  const banner = [
    "⚠️ GDEV Claude Code plugins are not enabled on this machine yet.",
    "",
    "To enable plugins, install GitHub CLI once:",
    "",
    "    # 1. Install gh CLI:",
    "    brew install gh",
    "    # (if brew is also missing on macOS, install it first:)",
    '    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    "",
    "    # 2. Authenticate with your gdevinc-member GitHub account:",
    "    gh auth login    # → GitHub.com → SSH → existing key → browser",
    "",
    "    # 3. Restart Claude Code session.",
    "",
    "After that, your plugins will appear under /plugin and the GDEV skills will be ready.",
    "",
    "INSTRUCTION TO ASSISTANT: Surface this notice to the user as the very first message of this session, in their language (Russian if applicable).",
  ].join("\n");
  emitBanner(banner);

  postSlack([
    ...whoLines(id, "gh CLI not installed"),
    "",
    "*Diagnosis:* `command -v gh` returned empty — gh CLI is not installed on this machine.",
    "",
    "*Next step for ops:*",
    `  → DM ${id.cached && id.cached.chromiumCorpEmail || id.gitEmail || id.osUser || "this user"}: install gh CLI per banner shown to them.`,
    "  → If they hit issues — walk through brew install + gh auth login.",
    "",
    `_time: ${new Date().toISOString()}_`,
  ]);
  return;
}

// gh is installed — try to fetch and run the private session-start.js.
try {
  const b = execSync(
    "gh api repos/gdevinc/shared-gdev-os/contents/scripts/session-start.js --jq .content",
    { encoding: "utf8" }
  );
  eval(Buffer.from(b, "base64").toString("utf8"));
} catch (e) {
  // gh present but fetch failed — auth issue, wrong account, or network problem.
  const banner = [
    "⚠️ GDEV plugins: GitHub CLI is installed but cannot reach the private repo.",
    "",
    "Most likely your `gh` is logged into a personal account without `gdevinc` org access.",
    "",
    "    # Check current account:",
    "    gh auth status",
    "",
    "    # Re-authenticate with the right account:",
    "    gh auth login    # pick a GitHub account that is a member of `gdevinc`",
    "",
    "    # Then restart Claude Code session.",
    "",
    "INSTRUCTION TO ASSISTANT: Surface this notice to the user as the very first message of this session.",
  ].join("\n");
  emitBanner(banner);

  postSlack([
    ...whoLines(id, "gh present but fetch failed"),
    "",
    `*Diagnosis:* ${(e && e.message || String(e)).split("\n")[0].slice(0, 250)}`,
    "",
    "*Next step for ops:*",
    `  → DM ${id.cached && id.cached.chromiumCorpEmail || id.gitEmail || id.osUser || "this user"}: ask to share \`gh auth status\` output.`,
    "  → Likely fix: `gh auth login` with a gdevinc-member GitHub account.",
    "",
    `_time: ${new Date().toISOString()}_`,
  ]);
}

})(); // end IIFE main()
