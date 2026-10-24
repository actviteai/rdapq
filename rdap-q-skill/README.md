# RDAP-Q Skill v2.1.0

`SKILL.md` is the instruction source. This README is not a second copy of the protocol.

**Research-Driven Adaptive Planning with Quality Gates**

RDAP-Q is an evidence-first protocol for AI coding agents. The model plans the change; `tool/rdapq.js` runs the checks and names the result.

## Layout

```text
rdap-q-skill/
├── SKILL.md            # the protocol, loaded on every /rdapq run (~1.5k tokens)
├── tool/rdapq.js       # the engine: start, plan, req, cover, check, gate, claim, note, state, outcome, memory, export, protocol, hook-stop
├── playbooks/
│   ├── discover.md     # full depth, before start
│   ├── audit.md        # full depth or /rdapq audit, before reporting
│   └── git.md          # only when asked to commit, push, or use a worktree
└── install/            # skill-local installers for Unix and Windows
```

## Files the tool writes

```text
<repo>/.rdapq/oracles.json      # what "done" means: risk, task, requirements, files, commands
<repo>/.rdapq/state.jsonl       # append-only task log: start, plan, req, cover, check, gate, claim, note, stop, outcome
<repo>/.rdapq/rounds/<n>.patch  # the exact diff each check round measured
<repo>/.rdapq/archive/<time>/   # the previous task, moved whole by the next start
<repo>/.rdapq/depth             # optional default depth for this repo ("full")

$RDAPQ_HOME/memory/records.jsonl          # global memory, one record per line
$RDAPQ_HOME/projects/<id>/records.jsonl   # project memory
```

The model never reads the task files; only the tool does. That is why they can hold the full patch and every timing at no token cost, while the model sees a few lines per command.

`RDAPQ_HOME` defaults to `~/.rdapq` (`%USERPROFILE%\.rdapq` on Windows).

## Slash commands

```text
/rdapq <task>
/rdapq depth full <task>
/rdapq status
/rdapq audit
/rdapq memory <terms>
```

## Requirements

Node.js 22 or newer on the agent's PATH. The tool has no dependencies.
