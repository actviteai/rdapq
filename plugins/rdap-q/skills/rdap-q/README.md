# RDAP-Q Skill v2.0.0

`SKILL.md` is the instruction source. This README is not a second copy of the protocol.

**Research-Driven Adaptive Planning with Quality Gates**

RDAP-Q is an evidence-first protocol for AI coding agents. The model plans the change; `tool/rdapq.js` runs the checks and names the result.

## Layout

```text
rdap-q-skill/
├── SKILL.md            # the protocol, loaded on every /rdapq run (~1.2k tokens)
├── tool/rdapq.js       # the engine: start, plan, check, gate, claim, note, state, memory, export, hook-stop
├── playbooks/
│   ├── discover.md     # full depth, before start
│   ├── audit.md        # full depth or /rdapq audit, before reporting
│   └── git.md          # only when asked to commit, push, or use a worktree
├── manifest.json
└── install/            # skill-local installers for Unix and Windows
```

## Files the tool writes

```text
<repo>/.rdapq/oracles.json   # what "done" means for the current task
<repo>/.rdapq/state.jsonl    # append-only task log
<repo>/.rdapq/depth          # optional default depth for this repo ("full")

$RDAPQ_HOME/memory/records.jsonl          # global memory, one record per line
$RDAPQ_HOME/projects/<id>/records.jsonl   # project memory
```

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
