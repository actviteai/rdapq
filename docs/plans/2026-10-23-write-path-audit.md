# Write-path audit: what RDAP-Q writes, where, when, and what the model pays for it

**Date:** 2026-10-23
**Repo state reviewed:** `main` @ `f3829e5` (2.0.0 tree, unreleased)
**Branch with the changes:** `feat/requirements-coverage-and-task-log` (uncommitted working tree)
**Baseline:** `npm test` 81 pass, 1 skipped. After: 89 pass, 1 skipped; NeMo wrapper tests 12 pass, 2 skipped (toolkit not installed locally; CI runs them).

---

## 1. What the engine wrote before this change

Only `tool/rdapq.js` writes. The model never writes `.rdapq/` by hand (the eval's `stateWrites` metric confirms 0 in every 2.0.0 run).

| File | Written by | When | Size per lean task |
| :--- | :--- | :--- | :--- |
| `<repo>/.rdapq/oracles.json` | `start` (overwrite), `plan` (overwrite) | plan defined or amended | ~240 B |
| `<repo>/.rdapq/state.jsonl` | `start`, `plan`, `check`, `check --before`, `gate`, `claim`, `note` | one line per event, append-only | ~1.4 KB (start 228 B, check 702 B, gate 194 B, note 88 B, claim 164 B) |
| `<repo>/.rdapq/archive/<ts>.jsonl` | `start` | the next task begins | the previous log, renamed |
| `$RDAPQ_HOME/memory/records.jsonl`, `projects/<id>/records.jsonl` | `memory add`, `memory stale` (append), `memory compact` (rewrite + `archive/YYYY-MM.jsonl`) | explicit memory commands | ~250 B per record |
| `--out` file | `export` | on request | one anonymized row per repo |

Not written anywhere: the task statement, the diff, command durations, and the stops the Claude Code hook refused. `state`, `state --json`, `hook-stop`, and `memory search` wrote nothing.

### What the model reads (the real token cost)

- `SKILL.md`: 5,101 bytes, ~1.25k tokens, every run. Playbooks only at full depth.
- Engine output per command: `start` 3–5 lines, `check` ~8 lines plus a 15-line tail when a command fails, `gate` 3 lines, `state` ~10 lines, `memory search` up to 12 lines.
- The dominant cost is not text but **turns**. In the 2.0.0 eval, lean runs took 13.4 turns against 7.1 with no protocol, and total input tokens doubled (344k vs 171k) because every turn re-reads the context. A lean task spent 3–4 turns on the engine alone: `memory search`, `start`, `check`, `gate`.

### A stale number in the eval report

`eval/results/v2.0.0/report.md` reports a mean state footprint of 1 file / 25 bytes. That is impossible for a run whose `state.jsonl` held a gate event. 25 bytes is exactly the seeded `value: lean\nset_by: user\n` depth file; the footprint metric at the time only knew the 1.x layout (CHANGELOG, "Fixed"). The metric is right now, but the stored results and that table are an artifact of the old one. Real footprint, measured: ~1.6 KB across two files per lean task before this change.

---

## 2. The one design idea everything below follows

**Rich on disk, lean in context.** The model never reads the task files; only the tool does. So the record on disk can hold everything a reviewer or a training set needs at zero token cost, while what the model sees stays a few lines per command. The 2.0.0 design had already made the files tool-owned; it just had not used the freedom that gives.

---

## 3. What changed

### 3.1 Requirements and the coverage oracle (the gauntlet the tool can enforce)

The eval's own finding: all six false COMPLETEs were spec clauses the agent never wrote a test for. The engine measured the tests that existed correctly; it could not see the clause nobody tested. The README named "requirement-to-test mapping" as the next step. This is it.

- `start --req "<clause>"` (repeatable) and `req "<clause>"` list the request's testable clauses (`R1`, `R2`, …).
- `cover <R-id> <test-file> "<text>"` ties a clause to a test. It refuses a file that is not a test, does not exist, or does not contain the text, so a wrong cover never costs a check round.
- The `coverage` oracle (weight 20) passes only when every requirement is covered by a test that **changed or imports a changed file** (the same proxy `runtime` uses). Its value is covered/total on the 0–10 scale.
- Required at every risk. A task with no requirements gets `coverage required: list each clause…` from the gate and cannot complete. Adding a requirement changes the plan hash, so the last check is invalidated.
- Honest limit: this catches the clause the agent listed and did not test. It cannot catch a clause the agent never listed. The skill text now tells the agent to list "the ones that are easy to skip: errors, empty input, boundaries", which is exactly the shape of the six misses.

### 3.2 One turn fewer per round

`check` now prints the verdict and logs the gate event itself. A lean task is `start`, edit, `cover`, `check`. `gate` still reprints the verdict without running anything (CI, Stop hook, a second look). `start` prints up to five memory records matching the task's words or planned file names, so recall no longer needs its own `memory search` turn (it is still there for more). Net: a lean round drops from 4 engine turns to 2.

### 3.3 Rich on disk

Per check round the log now also holds: diff statistics, every command's exit code and duration, the Q band, and `rounds/<n>.patch`, the exact patch (untracked files included, capped at 512 KB). `hook-stop` logs a `stop` event when it refuses a stop: the agent was about to report before the measurement agreed, which is the most telling signal in the log. `start --task` records the request; each task has an id; `memory add` records the task a fact was learned in. A new `start` moves the whole previous task (plan, log, patches) to `archive/<time>/` as one record. `export` rows gain the id, requirement and cover counts, insertions/deletions, durations, refused stops, and still carry no text, paths, or code.

Footprint after: ~3.1 KB log + ~480 B plan + the patch, per task. Still never read by the model.

### 3.4 Named scales

Every score runs 0..10 with both ends named, so no number is read without its meaning. `protocol [--json]` prints them; `check` and `state` print Q with its band.

| Scale | Alpha (0) | … | Omega (10) |
| :--- | :--- | :--- | :--- |
| oracle | fail | 5 partial: it ran, evidence incomplete | pass: the evidence is complete |
| Q (weighted mean) | alpha: no measured oracle passed | under 5 weak · 5+ mixed · 8+ strong | omega: every measured oracle passed |
| memory confidence | a guess | 3 one unverified source · 5 observed once · 8 observed and reproduced | primary source read, and reproduced |
| coverage value | no requirement covered | covered/total | every requirement covered |

Weights are now runtime 30, repo 20, coverage 20, repro 10, external 10, claims 10. Q is reported; the gate decides. That has not changed.

### 3.5 One source for the numbers

The engine exports `protocol()`. `scripts/check-static.js` now fails `npm test` when SKILL.md's oracle table, the README's oracle and risk tables, the terminal-state names, the Q scale line, or either manifest's `terminal_states` disagree with it. This is the DRY the YAML idea was after, without a YAML parser in a zero-dependency tool: constants live once, in code; prose is checked against them.

### 3.6 Mermaid in SKILL.md

The loop's state machine is now an eight-line `stateDiagram-v2` in SKILL.md: which check outcome leads to which terminal state. It replaced a sentence that listed the states without the transitions. SKILL.md is 5,980 bytes (budget 6,144), up from 5,101, with requirements, cover, the diagram, and the scale line added and the memory and commands sections tightened.

### 3.7 NeMo Agent Toolkit

`rdapq__start` takes `task` and `reqs`; new tools `rdapq__req` and `rdapq__cover`; `instructions.md` and the example workflow's `system_prompt` carry the new loop (the static check keeps them byte-identical). Without this, no NeMo task could have passed the new gate.

---

## 4. On the formats you asked about, against the evidence here

- **YAML prompts.** This repo already tried it: 1.x had YAML phase playbooks (commit `c064974`). The 1.3.1 eval showed lean runs usually never opened SKILL.md and 1 of 64 reported a terminal state; 2.0 moved to prose plus a tool and adoption went to 64/64. Causation is not proven (the load path changed too), but there is no evidence YAML in front of the model helped. Where DRY does pay is behind the model: the protocol's numbers were repeated by hand in six places. They are now checked against one source (3.5). YAML as that source would need a parser the zero-dependency engine does not have; JS constants do the same job.
- **Mermaid.** It earns its place where relationships matter: the state machine (3.6), and the README's flow. It is the wrong container for the task record: JSONL is appendable, line-oriented, and torn-write safe; a graph file is none of those. A `.mmd` render of an archived task for human review would be a reasonable later addition, generated from the JSONL, not instead of it.
- **Gauntlet.** `playbooks/audit.md` was already a gauntlet, but unscored and self-graded, which the protocol's own premise rejects. Requirements coverage (3.1) is the gauntlet the tool can score.
- **Loop.** The loop existed; it is now cheaper (3.2) and its shape is drawn (3.6).
- **Scales with alpha and omega.** Done (3.4). The engine refuses to print a Q without its band.

---

## 5. What is not done, and how to measure the rest

1. **Re-run the eval.** The claim that requirements coverage removes the false COMPLETEs is a prediction from the eval's failure analysis, not a measurement. `node eval/run.js --agents claude:claude-sonnet-5-5,claude:claude-haiku-4-5-20251001 --conditions none,lean,full --reps 2` costs about $8 and was not run here. Two things to watch: false-DONE on the two trap tasks and `date-range`, and mean turns (expected to fall by 1–2 per run).
2. **Harder tasks.** The README already says the set is too easy; unassisted agents pass 100%. The coverage oracle can only show its value on tasks where an unassisted agent skips a clause.
3. **Outcome labels for training.** The log now has the task, the patch, the measurements, and the verdict, but no ground truth after the fact (accepted, reverted, bug reported). A `label` command, or reading later git history for the planned files, would close that loop. Not added here: it is a product decision about who labels.
4. **The stale footprint numbers** in `eval/results/v2.0.0/report.md` cannot be regenerated (the scratch repos are gone). The next eval run replaces them.
