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

## Changing the protocol

After any change under `rdap-q-skill/`, run `npm run sync` so the two generated copies (`integrations/hermes/`, `plugins/rdap-q/skills/rdap-q/`) match; `npm test` fails until they do. A change to what the gate measures should come with an eval run (`node eval/run.js`) or an explicit note that it did not.
