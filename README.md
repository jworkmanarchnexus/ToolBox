# Toolbox: starter kit for Claude Code

This folder becomes the Toolbox repo. Claude Code reads `CLAUDE.md` automatically every time it starts here, so the decisions, rules and plan carry over between sessions without you repeating them.

## What's in it

| | |
|---|---|
| `CLAUDE.md` | Standing instructions for Claude Code: goals, decisions, architecture, rules |
| `docs/PLAN.md` | The five phases, and what "done" means for each |
| `docs/CONTRACT.md` | The backend contract for Kent, with your answers so far |
| `docs/AUDIT.md` | What each current app does with data, sign-in and projects |
| `design-system/` | Tokens, component CSS, icons, fonts, logo, and the check scripts |
| `reference/published/` | The three apps as currently published (read-only reference) |
| `reference/source-zips/` | **Put your source zips here** (see the README in that folder) |

## One-time setup

1. **Claude Code.**
   - The Claude desktop app includes it: open the Code tab.
   - Or install the command-line version: https://code.claude.com/docs/en/setup
   - It needs a paid Claude plan (Pro, Max, Team or Enterprise).
2. **Node.js** (LTS version) from https://nodejs.org. This runs the app and the local server.
3. **Git.**
   - Windows: https://git-scm.com/downloads/win. Claude Code also uses it for its command shell.
   - Mac: run `git --version` in Terminal and accept the prompt to install the developer tools.
4. **A private GitHub repository.**
   - Ideally create it in an Archnexus organization rather than your personal account, so the firm owns the code.
   - Leave it empty: no README or license.
   - Copy its URL.
5. **This folder.**
   - Unzip it somewhere permanent, such as `Documents/toolbox`. Avoid a synced folder like OneDrive or Dropbox: the database file and the many small files don't sync well.
   - Then copy your source zips into `reference/source-zips/`.

## Start

Open Claude Code in this folder:
- **Desktop app:** pick the folder.
- **Terminal:** `cd` into the folder, then run `claude`.

Then paste:

> Read CLAUDE.md, docs/PLAN.md, docs/CONTRACT.md and docs/AUDIT.md. Then do Phase 0. The GitHub repository is `<paste the repo URL>`. Check first that Node.js and Git are installed, and tell me exactly what to install if anything is missing. Stop at the end of Phase 0 and tell me how to try it.

Each phase ends with Claude Code stopping to show you what works and how to try it. Start the next one with "Go ahead with Phase 1" and so on.

## Day to day

- **Run the Toolbox:** `npm start` in this folder, then open http://localhost:5280. Only your computer can reach it.
- **Changes:** describe them to Claude Code here, not in a chat. It works in the repo, runs the tests and commits.
- **Design changes:** say what should change ("primary buttons should be Nexus Blue"). Claude Code edits `design-system/` first, then every module.
- **Backups:** `npm run backup` writes everything to a JSON file in `backups/`.
