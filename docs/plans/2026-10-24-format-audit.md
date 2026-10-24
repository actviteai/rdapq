# Format audit: does the repo follow its own rule?

**Date:** 2026-10-24
**Rule under test:** `CONTRIBUTING.md`, "Text the model reads": prose for rules, Markdown tables for shaped facts, Mermaid only for relationships, numbers rendered from the engine, JSON only where a program reads it. Extended here to every format the repo uses: YAML and plain text where a tool requires them, and never otherwise.
**Scale:** the design review scale in `CONTRIBUTING.md` (0 alpha, no direction … 10 omega, correct and enforced by `npm test`).

## Inventory

| Format | Files | Read by |
| :--- | :--- | :--- |
| JavaScript | 53 | Node |
| Markdown | 33 | humans, and the model for SKILL.md, playbooks, bridges, the NeMo prompt |
| JSON | 17 after this change | npm, Claude Code, Codex, Copilot, Grok, the eval harness, the engine |
| Python | 8 | NeMo Agent Toolkit |
| YAML | 4 | GitHub Actions, Dependabot, NeMo workflows, skill frontmatter (Claude Code, Hermes) |
| Shell, PowerShell | 7 | installers |
| JSONL | 2 tracked, plus `.rdapq/state.jsonl` at runtime | `eval/report.js`, the engine, `export` |
| TOML | 1 | pip |
| Plain text | `.gitignore`, `LICENSE`, `goosehints`, `.rdapq/depth`, `.rdapq/rounds/*.patch` | git, Goose, the engine |

## Scores

| Area | Before | After | What moved it |
| :--- | :---: | :---: | :--- |
| Model-facing prose (SKILL.md, playbooks, NeMo prompt) | 6 | 10 | Numbers were typed by hand in two places and the state machine was a sentence; now rendered-number drift, fence types, Mermaid types, and table shape all fail `npm test` (PRs #38, #39). |
| Project bridges (7 files) | 4 | 10 | Identical by luck, maintained by hand. Generated from `bridges/project.md`; drift fails `npm test`. |
| Mermaid | 5 | 9 | One flowchart in the README, none where the state machine mattered. Now: state machine in SKILL.md, flow in README, pipeline in CONTRIBUTING. A script checks that a Mermaid block is a relationship diagram; it cannot check that a relationship was drawn, so 9. |
| YAML | 7 | 10 | CI, Dependabot, and frontmatter were already where a tool requires YAML, and the Hermes frontmatter was already generated. The NeMo `system_prompt` was duplicated by hand and checked after; it is now rendered by sync and drift-checked. |
| JSON | 6 | 10 | All program-read files were right. The root `manifest.json` had no reader and is deleted. The skill manifest turned out to have no reader either (no harness format looks for one; follow-up PR deletes it), and the check keeps both deleted. |
| Plain text | 9 | 10 | Already only where a tool wants it. `goosehints` is now generated with the other bridges. |
| Human docs (README, CHANGELOG, this folder) | 6 | 8 | Tables and one graph used well; numbers drift-checked. The four overlapping install sections became one task × source table (follow-up PR, README 37 KB → 33 KB). The oracle rows, risk row, terminal states, versions, and harness paths are checked; the rest of its shape is not, so 8. |
| Task record for ML (`.rdapq/`) | 4 | 8 | Was oracle results and file names. Now task text, requirements and covers, per-round patch, timings, verdicts, refused stops, whole-task archive. No outcome label after the fact, so 8. |

## What keeps the 10s at 10

`npm test` runs `scripts/sync-integrations.js --check` semantics through `check-static.js`: a stale generated copy, a hand edit to a copy, a number in prose that disagrees with `protocol --json`, a `json` or `yaml` fence in a model-facing file, a Mermaid block that is not a relationship diagram, or a Markdown table without a header row each fail the build with file and line.

## What would move the rest

- README: done in a follow-up PR. One Install section: a task × source table, the per-harness table, and notes that state each fact once.
- JSON: done in a follow-up PR. No harness reads a skill manifest (Agent Skills, Codex, Cursor, Copilot, Claude Code, Cline, Goose, Grok, and Hermes all load `SKILL.md` and the files it names), so `rdap-q-skill/manifest.json` is deleted rather than trimmed.
- Mermaid (9): a `state --mmd` render of an archived task for human review would be the next relationship worth drawing, generated from the JSONL.
- Task record (8): an outcome label (accepted, reverted, bug reported) recorded after the fact, by command or from later git history.
