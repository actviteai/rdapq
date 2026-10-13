---
name: rdap-q
description: Run the RDAP-Q evidence-first engineering protocol. Invoke with /rdap-q or /rdapq. A tool measures whether the task is done; the model does not grade itself.
disable-model-invocation: true
---
# RDAP-Q 2.0.0

RDAP-Q makes "done" something a tool measures, not something you claim. You plan the change, `tool/rdapq.js` runs the checks, and its `gate` command names the result. Follow this for the current task only.

## The tool

`tool/rdapq.js` sits next to this file. Run it with `node` from the repository root, for example `node .agents/skills/rdap-q/tool/rdapq.js gate`. Below, `T` stands for that command. If `rdapq` is on PATH, `rdapq <command>` is the same.

## The loop

1. **Look first.** Run `git status`. Read the code you will change and the tests that cover it. Never invent paths, APIs, versions, flags, or commands.
2. **Recall.** `T memory search <two or three keywords>` shows at most 12 relevant records. Current evidence beats memory.
3. **Start.** Choose the risk: LOW (local, easy to revert), MODERATE (shared code or a behavior change), HIGH (persistence, security, public API, concurrency), CRITICAL (money, auth, destructive operations, migrations).

   ```
   T start --risk LOW --files src/a.js,test/a.test.js --run "npm test"
   ```

   - `--files`: every file you intend to change, including tests you will add.
   - `--run`: each command that must pass; repeat the flag for several. Use the repository's real test command.
   - Fixing a bug: add `--repro "<command that fails now>"`, then run `T check --before` before editing source. Nothing broken: add `--no-defect`.
   - Run `start` once per task; a new `start` archives the previous task's log. To change the plan mid-task, use `T plan`.
4. **Implement** the smallest change that does the job. Add or update a test that exercises it: runtime only passes when a changed test, or a test that imports a changed file, exists and the commands pass. Make sure your `--run` command actually runs that test.
5. **Check.** `T check` runs the commands and scores the oracles. If the plan changed, run `T plan --add <files> --why "<reason>"` first.
6. **Gate.** `T gate`. On CONTINUE, fix the first reason it prints and check again. `check` refuses a fourth round, and the same failure twice ends as STALLED.
7. **Report** the terminal state exactly as `gate` printed it, with its reasons. Never say COMPLETE unless `gate` printed COMPLETE.

## What the tool measures

| Oracle | Pass when |
| --- | --- |
| runtime | every `--run` command exits 0, and a test changed or imports a changed file |
| repo | the diff touches exactly the planned files |
| repro | the repro failed before the fix and passes after it |
| external | every external claim you recorded is verified (not applicable if you recorded none) |
| claims | share of recorded claims that are verified (reported, not required) |

Required to complete: LOW and MODERATE need runtime and repo. HIGH adds repro, unless you started with `--no-defect`. CRITICAL also requires every external claim to be verified, so record each outside fact the change relies on. Any failing oracle blocks COMPLETE.

Terminal states: COMPLETE, STALLED (same failure twice, or rounds used up), BLOCKED, MISSING_TEST (no `--run` command), UNCLEAR_TASK (not started, or no planned files by the round cap). CONTINUE is not terminal.

## Claims, notes, blockers

- A fact from outside the repository (an API's behavior, a version, a flag): `T claim "<fact>" --external --source <url or path>`. Add `--verified` only after you read that source. Add `--off-path` when it does not affect the changed code.
- Decisions and assumptions: `T note decision "<text>"` or `T note assumption "<text>"`.
- If you cannot proceed without credentials, a user decision, or a missing environment, run `T note blocker "<why>"`. The gate then reports BLOCKED. Stop and say what you need.

## Depth

Default is lean: the loop above. Use full when the user asks for it, when `.rdapq/depth` says `full`, or when the risk is HIGH or CRITICAL. Full adds `playbooks/discover.md` before start, and `playbooks/audit.md` before you report. Pass `--depth full` to `start`. Read `playbooks/git.md` only when asked to commit, push, or use a worktree.

## Memory

Store only facts that are durable, reusable, and verified, never secrets:

```
T memory add --class OBSERVED --fact "<one line>" --evidence "<file, command, or URL>"
```

Classes: USER_SPECIFIED, OBSERVED, VERIFIED_EXTERNAL, INFERRED. When a record proves wrong, run `T memory stale <id>`. Do not store task progress; the task log holds that.

## Rules

- The tool owns `.rdapq/`. Do not edit those files by hand.
- An unrun test is not a pass. Do not describe results you did not see.
- Never run `git reset --hard`, `git clean -fd`, or `git push --force` without explicit permission.

## Commands the user may type

`/rdapq <task>` runs the loop. `/rdapq status` runs `T state`. `/rdapq audit` reads `playbooks/audit.md`. `/rdapq memory <terms>` runs `T memory search`. `/rdapq depth full <task>` runs the loop at full depth.
