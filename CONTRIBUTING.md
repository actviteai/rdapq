# Contributing

`npm test` is the gate: Node.js 22+, it checks the installer, the engine, the eval tasks, the npm tarball, version consistency, and the rules below. The release steps are in the README under Contributing.

## Text the model reads

Every file the model reads is a token budget and an instruction channel. Each kind of content has exactly one form. Pick by content type, never by taste.

| Content | Form | Rule |
| :--- | :--- | :--- |
| Rules and steps | Terse prose | One rule per sentence. A numbered list when order matters, bullets when it does not. |
| Facts with a repeated shape | Markdown table | The header row names the fields once; rows carry only values. |
| Transitions and dependencies | Mermaid | Only when the content is edges (`stateDiagram`, `flowchart`, `graph`, `sequenceDiagram`). Never for a list. |
| Numbers, names, enums | Rendered from the engine | The engine's constants are the source (`rdapq protocol --json`). Prose and tables repeat them, and `npm test` fails on drift. No hand-typed weights, required sets, or terminal states anywhere else. |
| Anything a program reads | JSON | `state --json`, `gate --json`, the task log. Never shown to the model. |

Why: measured on the oracle table, JSON costs 50 to 100 percent more tokens than prose for the same facts. YAML is the cheapest by count, but the 1.x YAML playbooks were not followed (1.3.1 eval: lean runs rarely opened SKILL.md). Terse prose was followed in 64 of 64 runs in 2.0.0. Mermaid costs more per fact than a table, and earns it only when the fact is an edge.

The model-facing files are `rdap-q-skill/SKILL.md`, `rdap-q-skill/playbooks/*.md`, `integrations/nemo/instructions.md`, and the bridges (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `bridges/**`, `.github/copilot-instructions.md`). `scripts/check-static.js` enforces what a script can decide about them:

- no `json`, `yaml`, or `yml` fenced blocks, and no line that opens a JSON object or array;
- every Mermaid block is one of the relationship diagram types above;
- every Markdown table has a header separator row;
- `SKILL.md` stays under 6144 bytes, and its oracle table, required sets, terminal states, and Q scale match the engine.

The one thing a script cannot decide is whether a passage is a rule, a shaped fact, or a relationship. That call is yours, and the table above is the answer.

## Generated files

Anything that exists in more than one place is written once and rendered. `npm run sync` renders; `npm test` fails on drift. Edit the source, never the copy.

```mermaid
flowchart LR
  E[rdap-q-skill/tool/rdapq.js<br/>constants] -- protocol --json --> C{check-static}
  S[rdap-q-skill/SKILL.md<br/>playbooks/] -- sync --> H[integrations/hermes/]
  S -- sync --> P[plugins/rdap-q/skills/rdap-q/]
  B[bridges/project.md] -- sync --> A[AGENTS.md CLAUDE.md GEMINI.md<br/>cline goose grok copilot]
  I[integrations/nemo/instructions.md] -- sync --> W[examples/workflow.yaml<br/>system_prompt]
  R[eval/results/*/results.jsonl] -- report.js --> M[report.md]
  S --> C
  A --> C
  W --> C
  README --> C
```

| Source | Rendered copies | Why a copy exists |
| :--- | :--- | :--- |
| `rdap-q-skill/` | `integrations/hermes/`, `plugins/rdap-q/skills/rdap-q/` | raw GitHub URLs and plugin installers do not follow symlinks |
| `bridges/project.md` | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `bridges/cline/rdapq.md`, `bridges/goose/goosehints`, `bridges/grok/rules.md`, `.github/copilot-instructions.md` | each harness reads its own file name |
| `integrations/nemo/instructions.md` | the `system_prompt` block of `integrations/nemo/examples/workflow.yaml` | NeMo workflows are YAML |
| engine constants (`protocol --json`) | tables and scale lines in `SKILL.md`, `README.md`; `terminal_states` in the skill manifest | readers need the numbers in prose |
| `eval/results/<run>/results.jsonl` | `report.md` beside it | humans read tables, programs read rows |

## Design review scale

Every review of a file, a format choice, or a design in this repo scores on one scale, 0 to 10, with both ends named. A score is never given without the row it means.

| Score | Meaning |
| :---: | :--- |
| 0 | Alpha. No direction. |
| 1 | Wrong direction. Following it causes harm. |
| 2 | Direction unclear. Mostly mistakes. |
| 3 | Some direction. More wrong than right. |
| 4 | Right direction. Many mistakes. Unreliable. |
| 5 | Good idea. Lots of mistakes. General direction is right. |
| 6 | Good idea. Some mistakes. Works sometimes. |
| 7 | Great ideas. Will likely work. Needs some correction. Excellent direction. |
| 8 | Works. Minor corrections only. |
| 9 | Works as designed. Nothing to correct. Not enforced by a check. |
| 10 | Omega. Correct and enforced: `npm test` fails when it stops being true. |

The step from 9 to 10 is always the same step: write the check.

## Changing the protocol

After any change under `rdap-q-skill/`, run `npm run sync` so the two generated copies (`integrations/hermes/`, `plugins/rdap-q/skills/rdap-q/`) match; `npm test` fails until they do. A change to what the gate measures should come with an eval run (`node eval/run.js`) or an explicit note that it did not.
