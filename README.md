# RDAP-Q: Research-Driven Adaptive Planning with Quality Gates

[![CI](https://github.com/coldcanuk/rdapq/actions/workflows/ci.yml/badge.svg)](https://github.com/coldcanuk/rdapq/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Protocol Version](https://img.shields.io/badge/Protocol-v2.0.0-emerald.svg)](https://github.com/coldcanuk/rdapq)
[![npm](https://img.shields.io/npm/v/rdap-q.svg)](https://www.npmjs.com/package/rdap-q)

Harnesses: Cursor, OpenAI Codex, Claude Code, GitHub Copilot, Grok Build, Google Antigravity, Block Goose, Cline, and Nous Research Hermes Agent. Framework: NVIDIA NeMo Agent Toolkit. See [Harness install](#in-harness-marketplace-installation).

---

## <a id="description"></a> Description

> **RDAP-Q: Research-Driven Adaptive Planning with Quality Gates** — an evidence-first protocol and skill for AI coding agents in **Codex, Grok, Copilot, Antigravity, Goose, Claude, Cline, Cursor, and Hermes Agent**. A bundled tool runs the checks and names the result, so the model never grades its own work.

This GitHub tree is protocol **2.0.0**. It is on `main` and is not published to npm: the 2.0 eval ship gate did not pass, so there is no `rdap-q@2.0.0` registry package and no `v2.0.0` git tag. The npm package [`rdap-q`](https://www.npmjs.com/package/rdap-q) `latest` is **1.4.0** (the 1.x protocol). Confirm with `npm view rdap-q version`. <!-- keep-version -->

---

## <a id="overview"></a> Overview

Coding agents often say "done" when they are not. They grade their own work, and a self-grade is an opinion. RDAP-Q moves that decision into code: **the model proposes, the tool decides.**

The agent reads `SKILL.md` (about 1.2k tokens), plans the change, and then drives `tool/rdapq.js`, a zero-dependency Node script that ships inside the skill:

| Step | Command | What the tool does |
| :--- | :--- | :--- |
| Plan | `start --risk LOW --files a,b --run "npm test"` | Records what "done" means: risk, planned files, required commands, optional repro. |
| Prove the bug | `check --before` | Runs the repro so the fix can be shown to change it from failing to passing. |
| Measure | `check` | Runs the commands and scores five oracles. Appends one line to the task log. |
| Decide | `gate` | Names the terminal state from the log. COMPLETE only when every required oracle passes. |

| Problem in typical agents | What RDAP-Q does |
| :--- | :--- |
| "Done" with failing or missing tests | `gate` refuses COMPLETE unless the required commands ran and passed. No command at all is `MISSING_TEST`. |
| Tests pass but never touch the change | runtime only passes when a test that ran changed, or imports a changed module. |
| Scope creep and stray edits | repo passes only when the diff matches the planned files; changing the plan needs a logged reason. |
| Fixes that never proved the bug | HIGH and CRITICAL need a repro that failed before and passes after. |
| Endless retry loops | At most 3 rounds, and the same failure twice ends as `STALLED`. |
| Token-heavy state files | One append-only task log written by the tool. Memory is one record per line, searched rather than read. |

---

## <a id="table-of-contents"></a> Table of Contents

- [Description](#description)
- [Overview](#overview)
- [How it works](#system-architecture)
- [Harness install](#in-harness-marketplace-installation)
- [Install](#npm-npx-installation)
- [Local clone](#universal-install-scripts)
- [Update](#update)
- [Weekly harness audit](#harness-audit)
- [Commands](#canonical-commands)
- [Oracles and gates](#oracles)
- [Task log and memory](#storage-and-persistence-model)
- [Eval](#eval)
- [Directory Structure](#directory-structure)
- [FAQ](#faq)
- [License](#license)
- [Contributing](#contributing)

---

## <a id="system-architecture"></a> How it works

The host model is the control plane; RDAP-Q runs no server. `bin/rdapq.js` is the only installer, and it also forwards task commands to the engine. `install.sh` and `install.ps1` refuse a piped launch and then exec that CLI. Personal harness files are created when missing and are not replaced unless you pass `--force` (the previous file is kept as `*.rdapq-backup`). Skill trees are staged and renamed into place, so a failed copy cannot delete a working install.

```mermaid
flowchart TD
    A["/rdapq &lt;task&gt;"] --> B["Read SKILL.md<br/>look at the code, search memory"]
    B --> C["start: risk, planned files,<br/>required commands, repro"]
    C --> D["Implement the smallest change<br/>plus a test that exercises it"]
    D --> E["check: run commands,<br/>score the oracles"]
    E --> F{"gate"}
    F -- "CONTINUE (new failure, rounds &lt; 3)" --> D
    F -- "same failure twice / round cap" --> G["STALLED"]
    F -- "no command" --> H["MISSING_TEST"]
    F -- "blocker noted" --> I["BLOCKED"]
    F -- "required oracles pass" --> J["COMPLETE"]
```

With `init --hook`, Claude Code also gets a Stop hook: while an RDAP-Q task's gate says CONTINUE, or files changed since the last check, the agent cannot end its turn.

---

## <a id="in-harness-marketplace-installation"></a> Harness install

This package is not in the Anthropic, xAI, or GitHub Copilot catalogs. Do not use `gh extension install`, a VS Code extension search, or `goose toolkit add`. Those commands do not install RDAP-Q.

`install --<harness>` writes that harness's user files. `init` writes the project files. A harness slash command is `/rdap-q` when the client loads `SKILL.md`. `/rdapq` works where a project bridge or Claude command file is present.

`npx --yes rdap-q` and `npx --yes rdap-q@latest` install npm `latest`, which is **1.4.0**. To install **this** 2.0.0 tree, clone the repo or use the GitHub specifier below. <!-- keep-version -->

| Harness | User install | What it writes | Project install (`init`) | Invoke |
| :--- | :--- | :--- | :--- | :--- |
| **Cursor** | `--cursor` | `~/.cursor/skills/rdap-q/` | `AGENTS.md`, `.agents/skills/rdap-q/` | `/rdap-q`, or `/rdapq` after `init` |
| **Codex** | `--codex` | `~/.agents/skills/rdap-q/` | `AGENTS.md`, `.agents/skills/rdap-q/` | `/rdap-q` |
| **Claude Code** | `--claude` | `~/.claude/skills/rdap-q/`, `~/.claude/commands/rdapq.md` | `CLAUDE.md`, `.claude/skills/rdap-q/`, `.claude/commands/rdapq.md` | `/rdap-q` or `/rdapq` |
| **Copilot** | `--copilot` | `~/.copilot/skills/rdap-q/` | `.github/copilot-instructions.md`, `.agents/skills/rdap-q/` | `/rdap-q` where skills load; project instructions are always on after `init` |
| **Grok Build** | `--grok` | `~/.grok/skills/rdap-q/` | `.grok/rules.md` | `/rdap-q` |
| **Antigravity** | `--antigravity` | `~/.gemini/antigravity-cli/skills/rdap-q/`, `~/.gemini/config/skills/rdap-q/` | `GEMINI.md`, `AGENTS.md`, `.agents/skills/rdap-q/` | `/rdap-q` |
| **Goose** | `--goose` | `~/.config/goose/.goosehints` | `.goosehints` | no slash command; hints load when the Developer extension is on |
| **Cline** | `--cline` | `~/.cline/rules/rdapq.md` | `.clinerules/rdapq.md` | rules load with the workspace; there is no marketplace entry |
| **Hermes Agent** | `--hermes` | `~/.hermes/skills/software-development/rdap-q/` | none; see below | `/rdap-q`, or when the request matches the skill's description |

`CURSOR_HOME`, `CLAUDE_HOME`, `COPILOT_HOME`, `GROK_HOME`, `GEMINI_HOME`, `GOOSE_HOME`, `CLINE_HOME`, `AGENTS_HOME`, and `HERMES_HOME` override those directories. Hermes on Windows defaults to `%LOCALAPPDATA%\hermes`, as Hermes itself does.

**Hermes Agent notes.** Hermes skills are user-wide, so `--hermes` writes only the skill tree, with a Hermes frontmatter (`description` that opens with the trigger sentence, `platforms`, `metadata.hermes.tags`, and `requires_toolsets: [terminal]` because the engine runs through the terminal tool). The body names the engine as `${HERMES_SKILL_DIR}/tool/rdapq.js`, which Hermes expands to the installed path. Hermes registers the skill as `/rdap-q`. To type `/rdapq` as in other harnesses, add an alias once:

```bash
hermes config set quick_commands.rdapq.type alias
hermes config set quick_commands.rdapq.target /rdap-q
```

Hermes can also install the skill straight from this repository, without Node.js for the installer (the engine still needs Node 22 to run):

```bash
hermes skills install https://raw.githubusercontent.com/coldcanuk/rdapq/main/integrations/hermes/SKILL.md --category software-development
```

That copy is `integrations/hermes/`: the same SKILL.md body with the engine at `scripts/rdapq.js` and the playbooks under `references/`, because a URL install copies only files SKILL.md names under those directories. It is generated from `rdap-q-skill/` by `npm run sync`, and `npm test` fails if it drifts. Hermes installs it with `community` trust after its security scan; `hermes skills update rdap-q` re-fetches it.

`init` writes no Hermes file. Hermes already reads a repository's `AGENTS.md` (which `init` writes) and, after `hermes skills trust`, the repo's `.agents/skills/rdap-q/`. For a Hermes profile, point `HERMES_HOME` at it: `HERMES_HOME=~/.hermes/profiles/<name> npx --yes github:coldcanuk/rdapq install --hermes`.

User installs never add always-on global rules for harnesses that load skills on demand, so RDAP-Q stays out of sessions that do not invoke it. Global bridges (the Claude command, Cline rules, Goose hints) point at the installed core under `$RDAPQ_HOME`. Earlier releases wrote `~/.codex/AGENTS.md` and `~/.copilot/copilot-instructions.md`; the installer never deletes your files, so remove those by hand if they only contain the RDAP-Q bridge.

```bash
# This GitHub tree (2.0.0, not on npm):
npx --yes github:coldcanuk/rdapq install --cursor
npx --yes github:coldcanuk/rdapq install --codex --claude
npx --yes github:coldcanuk/rdapq install --hermes
npx --yes github:coldcanuk/rdapq init

# Released npm package (pin; latest is 1.4.0): <!-- keep-version -->
npx --yes rdap-q@$(npm view rdap-q version) install --cursor
```

Claude Code can also add this repository as a plugin marketplace from inside a session, because `.claude-plugin/marketplace.json` is in the repo:

```text
/plugin marketplace add coldcanuk/rdapq
/plugin install rdap-q@rdapq
```

That is optional. It is not required for `install --claude` or `init`.

### NVIDIA NeMo Agent Toolkit (framework integration)

NeMo Agent Toolkit (`nvidia-nat`, CLI `nat`) is a Python framework, not a chat harness. It has no skills directory and no slash commands: agents are YAML workflows that call Python tools. RDAP-Q ships for it as `rdapq-nat`, a pip package in [`integrations/nemo/`](integrations/nemo/) that registers the engine's commands as one tool group (`rdapq__start`, `__plan`, `__check`, `__gate`, `__claim`, `__note`, `__state`). The tools run the same `rdapq.js`, so the verdict still comes from the engine, not the model.

```bash
npx --yes github:coldcanuk/rdapq install --nemo     # installs the engine under ~/.rdapq and prints the steps below
git clone https://github.com/coldcanuk/rdapq.git
pip install "./rdapq/integrations/nemo[agents]"     # into the environment that runs `nat`
nat run --config_file rdapq/integrations/nemo/examples/workflow.yaml --input "<task>"
```

Caveats:

- The host needs **Node.js 22 or newer**, because the tools run the Node engine. Python 3.11 to 3.13 and NeMo Agent Toolkit 1.8 or newer (tested with 1.9).
- `install --nemo` never runs pip. It installs the engine and prints the commands, because pip-installing into an environment you did not choose breaks PEP 668 systems. `--all` leaves NeMo out; name it.
- RDAP-Q only measures. A NeMo agent also needs tools that read and edit files and run commands, from your own workflow.
- `rdapq-nat` is not on PyPI yet, and NeMo has no catalog to list it in; install it from a clone.

See [`integrations/nemo/README.md`](integrations/nemo/README.md) for the tools and settings, and [`integrations/nemo/NOTES.md`](integrations/nemo/NOTES.md) for the toolkit API it relies on.

---

## <a id="npm-npx-installation"></a> Install

Node.js 22 or newer is required. Do not pipe an installer from the network (`curl | bash`, `irm | iex`). A piped script cannot see the skill tree and is refused.

`SKILL.md` is the instruction source the agent loads. This README is the human guide.

With no harness flag, `install` configures all nine chat harnesses. Name a harness to leave the others alone. NeMo Agent Toolkit is only set up when you pass `--nemo`. `init` and `install` are separate commands. Do not pass harness flags to `init`.

Edited harness files are kept. Pass `--force` to replace one. The previous file is saved as `<file>.rdapq-backup`. A file that is kept also gets the new copy beside it as `<file>.rdapq`. Skill trees are copied to a staging directory and renamed into place only after `SKILL.md` is present, so a failed update does not delete a working install.

### This tree (2.0.0, GitHub `main`, not on npm)

```bash
git clone https://github.com/coldcanuk/rdapq.git
cd rdapq
./install.sh --claude

# or, without cloning first:
npx --yes github:coldcanuk/rdapq install --claude
npx --yes github:coldcanuk/rdapq install --cursor
npx --yes github:coldcanuk/rdapq install --codex --grok
npx --yes github:coldcanuk/rdapq install --all
npx --yes github:coldcanuk/rdapq install --global-only
```

### Released npm package (1.4.0) <!-- keep-version -->

[`rdap-q`](https://www.npmjs.com/package/rdap-q) on the public registry. Pin the version; `@latest` currently resolves to 1.4.0, which is the 1.x protocol. <!-- keep-version -->

```bash
# Pin npm latest (1.4.0). <!-- keep-version -->
npx --yes rdap-q@$(npm view rdap-q version) install --claude
npx --yes rdap-q@$(npm view rdap-q version) install --cursor
npx --yes rdap-q@$(npm view rdap-q version) install --codex --grok
npx --yes rdap-q@$(npm view rdap-q version) install --all
npx --yes rdap-q@$(npm view rdap-q version) install --global-only
```

Right after a publish, npm may advertise `latest` before the tarball is queryable. `npm error notarget No matching version found for rdap-q@x.y.z` is that window, or a stale local cache. Wait until `npm view rdap-q version` prints the version you expect, then pin as above. `npm cache clean --force` if a cached packument still names the previous latest.

`--global-only` writes `$RDAPQ_HOME` (default `~/.rdapq`): `skills/rdap-q/`, plus empty `memory/`, `projects/`, and `registry/` directories. It does not create harness bridges.

### Initialize the current project:
```bash
# This tree:
npx --yes github:coldcanuk/rdapq init
npx --yes github:coldcanuk/rdapq init --hook
npx --yes github:coldcanuk/rdapq init --force
npx --yes github:coldcanuk/rdapq init --repo /path/to/my-project

# Released npm package:
npx --yes rdap-q@$(npm view rdap-q version) init
```

`init` writes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.clinerules/rdapq.md`, `.goosehints`, `.grok/rules.md`, `.github/copilot-instructions.md`, `.claude/commands/rdapq.md`, and skill trees at `.agents/skills/rdap-q/` and `.claude/skills/rdap-q/`. Cursor, Codex, Copilot, and Antigravity read `.agents/skills`. Claude Code reads `.claude/skills`.

### Check installation status:
```bash
npx --yes github:coldcanuk/rdapq status
npx --yes rdap-q@$(npm view rdap-q version) status
```

### Install the command globally:
```bash
# Released npm package (1.4.0): <!-- keep-version -->
npm install -g rdap-q@$(npm view rdap-q version)
rdapq install --claude
rdapq status
rdapq init

# This tree, from a clone:
npm install -g .
rdapq install --claude
```

Harness homes can be redirected without touching the real user profile. `RDAPQ_HOME`, `GEMINI_HOME`, `GOOSE_HOME`, `CLAUDE_HOME`, `CLINE_HOME`, `GROK_HOME`, `COPILOT_HOME`, `CURSOR_HOME`, `AGENTS_HOME`, and `HERMES_HOME` are all honored.

`npx --yes github:coldcanuk/rdapq` always installs this GitHub tree. `npx --yes rdap-q` installs whatever npm currently tags `latest`.

---

## <a id="universal-install-scripts"></a> Local clone

Do not pipe the installer from the network. A piped script cannot see this repository and is refused on purpose.

### Linux / macOS / WSL:
```bash
git clone https://github.com/coldcanuk/rdapq.git
cd rdapq
./install.sh --all          # every harness
./install.sh --claude       # one harness
./install.sh --cursor       # Cursor skill only
npm test                    # installer, packaging, and version checks
```

### Windows (PowerShell):
```powershell
git clone https://github.com/coldcanuk/rdapq.git
cd rdapq
.\install.ps1 -All
.\install.ps1 -Claude -Force
```

`install.sh` and `install.ps1` are wrappers around `node bin/rdapq.js`. With no harness flag they install all nine. `.\install.ps1` has no `status` switch. Use `node .\bin\rdapq.js status`.

---

## <a id="update"></a> Update

There is no `update` command. Install the same flags again. A newer skill tree is staged and swapped in only after its `SKILL.md` verifies. The previous tree is removed only after that rename. If the copy fails, the previous tree is put back.

These are not inside the skill tree and are kept:

- `$RDAPQ_HOME/memory/`
- `$RDAPQ_HOME/projects/`
- repository task files in `<repo>/.rdapq/` (`oracles.json`, `state.jsonl`)
- a harness file you have edited, unless you pass `--force`

`npm install` updates the CLI package only. It does not refresh `~/.rdapq` or the harness files. Run `rdapq install` again after the package is newer.

### This tree (GitHub `main`)
```bash
npx --yes github:coldcanuk/rdapq install --cursor
npx --yes github:coldcanuk/rdapq status
```

Use the same harness flags you used the first time. `--cursor` above is only an example.

From a clone already on disk:

```bash
cd rdapq
git pull --ff-only origin main
./install.sh --claude
node ./bin/rdapq.js status
```

```powershell
cd rdapq
git pull --ff-only origin main
.\install.ps1 -Claude
node .\bin\rdapq.js status
```

There is no `v2.0.0` tag. `git checkout v1.4.0` is the last tagged release. <!-- keep-version -->

### Released npm package
```bash
# Pin; @latest is 1.4.0 and is the 1.x protocol. <!-- keep-version -->
npx --yes rdap-q@$(npm view rdap-q version) install --cursor
npx --yes rdap-q@$(npm view rdap-q version) status
```

### Command installed globally
```bash
npm install -g rdap-q@$(npm view rdap-q version)
rdapq install --cursor
rdapq status
```

### Take the new harness text
A re-install that sees a different `AGENTS.md`, `CLAUDE.md`, or other bridge leaves your file in place and writes the packaged copy next to it as `<file>.rdapq`. Diff that sidecar. When you want the packaged text:

```bash
npx --yes github:coldcanuk/rdapq install --claude --force
```

`--force` copies the current file to `<file>.rdapq-backup`, then writes the new one. It does not delete `$RDAPQ_HOME/memory`.

### Workspace already initialized
```bash
npx --yes github:coldcanuk/rdapq init
```

That refreshes `.agents/skills/rdap-q/` and creates any bridge that is missing. Add `--force` only when you want the bridges replaced. Start a new harness session afterward so it does not keep the previous `SKILL.md` in context.

---

## <a id="harness-audit"></a> Weekly harness audit

Vendor docs move. `scripts/harness-audit/check.py` fetches each vendor `llms.txt`, then the skills and rules pages linked from it, and checks that the paths in `lib/installer.js` and this README are still on those pages. A passing run does not call a model. If a path disappears, it writes `reports/harness-audit/review-prompt.md` for a local model. That directory is gitignored.

```bash
python3 scripts/harness-audit/check.py --self-test
./scripts/harness-audit/weekly.sh
```

The weekly script is what you cron. It does not use Grok cloud credits. Set `RDAPQ_AUDIT_REVIEW` only if a failed run should be handed to a local model.

---

## <a id="canonical-commands"></a> Commands

In the agent:

| Command | Meaning |
| :--- | :--- |
| `/rdapq <task>` | Run the task with RDAP-Q: plan, implement, check, gate. |
| `/rdapq depth full <task>` | Also run discovery before `start` and the audit checklist before reporting. |
| `/rdapq status` | Risk, planned files, last check, and the current gate verdict. |
| `/rdapq audit` | Adversarial audit checklist, then check and gate again. |
| `/rdapq memory <terms>` | Search durable memory (at most 12 records). |

The engine, run by the agent or by you (`node .agents/skills/rdap-q/tool/rdapq.js <command>`, or `rdapq <command>` after `npm install -g rdap-q`):

| Command | Meaning |
| :--- | :--- |
| `start --risk R --files a,b --run "<cmd>" [--repro "<cmd>" \| --no-defect] [--depth full] [--keep]` | Define done for a new task (`--keep`: redefine the current one). |
| `plan --add a --drop b --why "<reason>"` | Change the planned files, with a logged reason. |
| `check [--before]` | Run the oracles (`--before`: run the repro before fixing). |
| `gate [--json]` | Terminal state. Exit code 0 COMPLETE, 3 CONTINUE, 1 otherwise. |
| `claim "<fact>" [--external] [--source s] [--verified] [--off-path]` | Record a claim for the external and claims oracles. |
| `note decision\|assumption\|risk\|question\|blocker "<text>"` | Log a note. A blocker makes the gate report BLOCKED. |
| `state [--json]` | Task summary. `--json` prints one JSON object (`spec`, `required`, `rounds`, `lastCheck`, `notes`, `gate`) and writes nothing. |
| `memory add\|search\|stale\|stats\|compact` | Durable memory. |
| `export --out <file> [--repo <dir>]...` | Append anonymized measurement rows (no text, paths, or code) for training or eval. |
| `hook-stop` | Claude Code Stop hook. |

---

## <a id="oracles"></a> Oracles and gates

`check` computes five oracles. Each is `pass`, `partial`, `fail`, or not applicable:

| Oracle | Weight | Pass | Partial |
| :--- | :---: | :--- | :--- |
| runtime | 35 | Every `--run` command exits 0, and a test changed or imports a changed file by path. | Commands pass, but no test touches the change. |
| repo | 25 | The diff touches exactly the planned files. | Extra files are only lockfiles or build output. |
| repro | 10 | The repro failed before the fix (run before any source edit) and passes after it. | It passes now, but was not run before the source changed. |
| external | 15 | Every recorded external claim is verified. | Unverified claims are all marked off the changed path. |
| claims | 15 | Share of recorded claims that are verified, 0–10. | — |

Q is the weighted mean of the oracles that ran; it is reported, not used to decide. `gate` decides:

| Risk | Required to pass |
| :--- | :--- |
| LOW, MODERATE | runtime, repo |
| HIGH | runtime, repo, repro (or `--no-defect`) |
| CRITICAL | runtime, repo, repro, and every recorded external claim verified |

Any oracle at `fail` blocks COMPLETE. A check is tied to the plan it ran against: editing files or changing the plan afterwards means checking again. `check` refuses a fourth round. Terminal states are `COMPLETE`, `STALLED` (same failure twice, or 3 rounds used), `BLOCKED` (a blocker note), `MISSING_TEST` (no required command), and `UNCLEAR_TASK` (not started, or no planned files by the round cap). A new `start` archives the previous task's log to `.rdapq/archive/`. `CONTINUE` means fix the first reason and check again. A task is COMPLETE only when `gate` prints it, and the agent reports the verdict and its reasons exactly as printed.

---

## <a id="storage-and-persistence-model"></a> Task log and memory

```
<repo>/.rdapq/
├── oracles.json     # what "done" means: risk, files, commands, repro (written by start and plan)
├── state.jsonl      # append-only: start, plan, check, claim, note, gate
└── depth            # optional: "full" to default this repo to full depth

$RDAPQ_HOME/ (default ~/.rdapq)
├── skills/rdap-q/   # installed skill and tool
├── memory/records.jsonl              # global memory, one record per line
└── projects/<id>/records.jsonl       # per-project memory
```

The agent never rewrites task files; the tool appends to them. Memory records are one line each, with provenance (`class`, `evidence`, `verified` date) and status (`ACTIVE`, `STALE`, `SUPERSEDED`, `INVALID`). The tool enforces the rules instead of asking the model to: facts up to 240 characters, evidence up to 160, at most 80 active global and 40 active project records, no duplicates, and nothing that looks like a secret. `memory search` returns at most 12 matching records, so memory never loads in bulk. `memory compact` moves retired records to `archive/YYYY-MM.jsonl`.

---

## <a id="eval"></a> Eval

`eval/` measures whether RDAP-Q helps instead of asserting it. Eight small Node tasks (bug fixes, features, a refactor, and two traps whose visible tests pass on a naive fix) each ship hidden tests and a reference solution. `node eval/run.js --self-test` proves the hidden tests fail on the starting code and pass on the reference; `npm test` runs it.

```bash
node eval/run.js --agents claude:claude-sonnet-5-5,claude:claude-haiku-4-5-20251001 --conditions none,lean,full --reps 2
node eval/report.js eval/results/<run> --write
```

The headline number is the **false-DONE rate**: runs that ended with "STATUS: DONE" while the hidden tests fail. Agents run with a scoped tool allowlist (read, edit, `node`, `npm test`, `git`) and project settings only.

### Results <!-- keep-version -->

Sonnet 5.5 and Haiku 4.5, 8 tasks × 2 repetitions, 32 runs per condition. Reports: [`baseline-1.3.1`](eval/results/baseline-1.3.1/report.md) and [`v2.0.0`](eval/results/v2.0.0/report.md). <!-- keep-version -->

| condition | hidden pass | false DONE | mean cost | mean turns |
| :--- | :---: | :---: | :---: | :---: |
| no protocol | 100% | 0% | $0.08 | 7.1 |
| 1.3.1 lean | 91% | 9% | $0.12 | 15.2 | <!-- keep-version -->
| 1.3.1 full | 97% | 3% | $0.15 | 17.6 | <!-- keep-version -->
| 2.0.0 lean | 88% | 13% | $0.12 | 13.4 | <!-- keep-version -->
| 2.0.0 full | 94% | 6% | $0.12 | 13.2 | <!-- keep-version -->

What this shows:

- **Neither version beats no protocol on this task set.** Unassisted, both models passed every hidden test; every false DONE came from an RDAP-Q run. The set is too easy to show a benefit, and 32 runs per cell cannot separate 9% from 13%.
- **2.0 fixed adoption.** The engine ran in 64 of 64 runs and the gate reached a verdict in 63. In 1.3.1, lean runs usually never opened `SKILL.md` and 1 of 64 runs reported a terminal state. <!-- keep-version -->
- **The gate cannot catch tests the agent never wrote.** All six false COMPLETEs were Haiku runs that skipped spec clauses (invalid-input errors, a DST week) and wrote tests only for what they implemented. The engine measured those tests correctly.
- **Cost:** 2.0 full costs less than 1.3.1 full ($0.12 against $0.15); both cost more than no protocol ($0.08). <!-- keep-version -->

The roadmap's ship gate for 2.0 was a lower false-COMPLETE rate at equal or lower cost. It did not pass, so 2.0 is not released: npm `latest` remains **1.4.0**, and there is no `v2.0.0` tag. Next: harder tasks that an unassisted agent fails, and requirement-to-test mapping so the gate can see untested spec clauses. <!-- keep-version -->

---

## <a id="directory-structure"></a> Directory Structure

```text
rdapq/
├── AGENTS.md, CLAUDE.md, GEMINI.md, .clinerules, .goosehints   # harness bridges
├── .claude/commands/rdapq.md     # Claude Code /rdapq command
├── .github/copilot-instructions.md, .grok/rules.md
├── bin/rdapq.js                  # CLI: install, init, status, and task commands
├── lib/installer.js              # installer implementation
├── lib/hermes.js                 # Hermes Agent frontmatter render and checks
├── integrations/hermes/          # Hermes URL-install copy (generated: npm run sync)
├── integrations/nemo/            # rdapq-nat: NeMo Agent Toolkit tools (pip package)
├── install.sh, install.ps1       # thin wrappers around bin/rdapq.js
├── eval/                         # hidden-test eval harness and results
├── scripts/                      # version stamping, static checks, harness audit
├── test/                         # node:test suites
├── manifest.json, marketplace.json, package.json, plugin manifests
└── rdap-q-skill/                 # the skill that gets installed
    ├── SKILL.md                  # the protocol (loaded on every /rdapq run)
    ├── tool/rdapq.js             # the engine: start, check, gate, memory, export, hook
    ├── playbooks/                # discover.md and audit.md (full depth), git.md
    ├── manifest.json
    └── install/                  # skill-local installers
```

---

## <a id="faq"></a> Frequently Asked Questions (FAQ)

<details>
<summary><strong>How does RDAP-Q differ from a system prompt that says "run the tests"?</strong></summary>
A prompt asks the model to check itself and trusts what it reports. RDAP-Q hands the checking to a script: the model cannot mark a task COMPLETE, only the <code>gate</code> command can, and it reads results the script recorded, not the model's summary.
</details>

<details>
<summary><strong>Can I use RDAP-Q in CI?</strong></summary>
Yes. <code>rdapq gate</code> exits 0 only on COMPLETE, and <code>.rdapq/state.jsonl</code> is plain JSON lines, so a CI job can re-run <code>rdapq check && rdapq gate</code> on the agent's branch.
</details>

<details>
<summary><strong>Does RDAP-Q slow down small tasks?</strong></summary>
Lean depth, the default, is one plan command, the edit, one check, and one gate. The eval section reports the measured token and time cost against no protocol.
</details>

<details>
<summary><strong>How do I override the default storage directory?</strong></summary>
Set the <code>RDAPQ_HOME</code> environment variable:
<pre><code>export RDAPQ_HOME=/custom/path/.rdapq</code></pre>
Per-harness homes use <code>AGENTS_HOME</code> (Codex), <code>CURSOR_HOME</code>, <code>GROK_HOME</code>, <code>COPILOT_HOME</code>, <code>CLAUDE_HOME</code>, <code>CLINE_HOME</code>, <code>GEMINI_HOME</code>, <code>GOOSE_HOME</code>, and <code>HERMES_HOME</code>.
</details>

<details>
<summary><strong>Which version does <code>npx rdap-q</code> install?</strong></summary>
npm <code>latest</code>, which is <strong>1.4.0</strong> (the 1.x protocol). This GitHub tree is <strong>2.0.0</strong> and is not on the registry. Install this tree with <code>npx --yes github:coldcanuk/rdapq</code> or a git clone. Pin a registry install with <code>npx --yes rdap-q@$(npm view rdap-q version)</code>. <!-- keep-version -->
</details>

<details>
<summary><strong>Coming from 1.x?</strong></summary>
The YAML phase playbooks, the 8-dimension self-score, and the ten <code>.rdapq/state/*.md</code> files are gone. Old state files are ignored; delete <code>.rdapq/state/</code> when you no longer need it. Markdown memory files under <code>$RDAPQ_HOME/memory/</code> are not read by 2.x; re-add anything worth keeping with <code>rdapq memory add</code>.
</details>

---

## <a id="license"></a> License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0-or-later). See [LICENSE](LICENSE) for full details.

---

## <a id="contributing"></a> Contributing & Community

Contributions are welcome, especially new harnesses, new eval tasks, and oracle improvements backed by eval results:

1. Fork the repository: [https://github.com/coldcanuk/rdapq](https://github.com/coldcanuk/rdapq)
2. Create a feature branch: `git checkout -b feature/new-harness-support`
3. Run `npm test` (Node.js 22+). It checks the installer, the engine, the eval tasks, the npm tarball, and version consistency. Protocol changes should also come with an eval run.
4. To cut a release, run `npm version <patch|minor|major>`. It stamps the version into every manifest and bridge (see `scripts/version-targets.js`), regenerates `integrations/hermes/`, and commits and tags `vX.Y.Z`. After changing anything in `rdap-q-skill/`, run `npm run sync` so the Hermes URL-install copy matches. Never edit version stamps by hand; `npm run stamp` repairs drift. A README line that must name an older version (release history, eval baselines, the npm `latest` that is not this tree) ends with `<!-- keep-version -->`. `.github/workflows/release.yml` publishes from a `v*` tag only when the `NPM_PUBLISH` repository variable is `true` and npm Trusted Publishing is configured for `coldcanuk/rdapq`. Until that is on, publish from a clean checkout of the tagged commit with `npm test` then `npm publish --access public`. Wait until `npm view rdap-q version` matches the tag before telling people to run `npx`; npm can take a few minutes to serve a new version. Publish this 2.0.0 tree only after the eval ship gate passes; npm `latest` is 1.4.0. <!-- keep-version -->
5. Submit a Pull Request.

**Maintained by:** [@coldcanuk](https://github.com/coldcanuk)  
**Issues & Discussions:** [https://github.com/coldcanuk/rdapq/issues](https://github.com/coldcanuk/rdapq/issues)
