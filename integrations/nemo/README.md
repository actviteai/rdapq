# rdapq-nat: RDAP-Q for NVIDIA NeMo Agent Toolkit

This is a framework integration, not a skill install. NeMo Agent Toolkit (`nvidia-nat`, CLI `nat`) has no skills directory and no slash commands. Agents are YAML workflows that call Python tools. `rdapq-nat` registers RDAP-Q's engine commands as one tool group, so a NeMo agent can plan a change, run the checks, and get a verdict it did not write itself.

`npx --yes github:actviteai/rdapq install --nemo` installs the engine and prints these steps. It does not touch any Python environment.

Each tool runs the Node engine (`rdapq.js`), the same file every other harness uses. The engine runs the commands, scores the oracles, and names the verdict. The Python layer passes arguments through and returns what the engine printed.

## Requirements

- Python 3.11 to 3.13, and NeMo Agent Toolkit 1.8 or newer. CI tests 1.8 and the latest release.
- **Node.js 22 or newer** on the host where the tools run, plus the engine. The usual source is the RDAP-Q installer:

  ```bash
  npx --yes github:actviteai/rdapq install --global-only   # writes ~/.rdapq/skills/rdap-q/tool/rdapq.js
  ```

  Or point `rdapq_js_path` at `rdap-q-skill/tool/rdapq.js` in a clone.
- The repository the agent works on must be a git checkout. The engine compares the diff against the plan.

## Install

`rdapq-nat` is not on PyPI yet. Install it from a clone into the environment that runs `nat`:

```bash
git clone https://github.com/actviteai/rdapq.git
pip install "./rdapq/integrations/nemo[agents]"   # [agents] adds react_agent / tool_calling_agent and the OpenAI + NIM clients
nat info components -t function_group -q rdapq   # should list `rdapq`
```

Leave out `[agents]` if your environment already has `nvidia-nat[langchain]`.

## Tools

The group key in your workflow becomes the tool prefix. With the key `rdapq` you get:

| Tool | Engine command | What it returns |
| --- | --- | --- |
| `rdapq__start` | `start` | the plan the engine recorded and the memory records that match the task (stdout) |
| `rdapq__plan` | `plan --why --add --drop` | the amended file list (stdout) |
| `rdapq__req` | `req` | the new requirement's id (stdout) |
| `rdapq__cover` | `cover <R-id> <file> <text>` | confirmation, or an error when the file is not a test that contains the text |
| `rdapq__check` | `check [--before]` | the oracle table and the verdict with its reasons (stdout) |
| `rdapq__gate` | `gate --json` | `{verdict, reasons, round, Q}` as the engine wrote it, without running anything |
| `rdapq__claim` | `claim --external` | confirmation |
| `rdapq__note` | `note <type>` | confirmation |
| `rdapq__state` | `state --json` | plan, rounds, last check, notes, and the gate's current verdict; read-only |

Every result has `ok`. When the engine could not run, `ok` is false and `error` says why: `node` missing, engine missing, timeout, or a usage error such as a `plan` with no reason. The tools do not raise for these, so the model can read the error and act on it. Arguments the schema rejects (an unknown `risk`, say) fail before the engine runs.

Calls run one at a time. `tool_calling_agent` runs one turn's tool calls concurrently, and a `gate` issued next to a `check` must read that check's result, so the group queues them. On timeout the engine and, on Linux and macOS, every command `check` started are stopped.

## Use it in a workflow

[`examples/workflow.yaml`](examples/workflow.yaml) is a complete `tool_calling_agent` config. The parts that matter:

```yaml
function_groups:
  rdapq:
    _type: rdapq
    repo_dir: ${RDAPQ_REPO:-.}
workflow:
  _type: tool_calling_agent
  llm_name: llm
  tool_names: [rdapq]          # plus whatever tools edit files and run commands
  system_prompt: |
    ... (instructions.md) ...
```

```bash
export OPENAI_API_KEY=...        # or NVIDIA_API_KEY for _type: nim
RDAPQ_REPO=/path/to/repo nat run --config_file integrations/nemo/examples/workflow.yaml \
  --input "Fix the off-by-one in src/range.js"
```

[`instructions.md`](instructions.md) is the protocol rewritten for a tool-calling agent. Put it in your agent's `system_prompt`. `react_agent` needs `{tools}` and `{tool_names}` in its `system_prompt`, so for ReAct use `additional_instructions` instead.

RDAP-Q only measures. Your agent still needs tools that read and edit files and run commands, from your own workflow. NeMo has no built-in file editor.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `repo_dir` | `.` | repository the engine works in |
| `rdapq_js_path` | `$RDAPQ_HOME/skills/rdap-q/tool/rdapq.js` | the engine |
| `node` | `node` | Node.js 22+ executable |
| `timeout_s` | `1800` | per call; `check` runs your test commands, and the engine stops each one after 10 minutes |
| `include` / `exclude` | all seven | NeMo's standard group filters |

The group is checked when the workflow is built. If `node` or the engine is missing, `nat run` fails before the first model call and says how to fix it.

## Tests

```bash
pip install "./integrations/nemo[test]"
pytest integrations/nemo/tests
```

Engine tests run the real `rdapq.js` without NeMo installed. Toolkit tests run when `nvidia-nat-core` is importable. The agent test also needs `nvidia-nat-langchain` and drives a `tool_calling_agent` with a scripted, LLM-free model through a full start, check, and gate loop.

[`NOTES.md`](NOTES.md) records the toolkit API this package relies on, verified against NeMo Agent Toolkit 1.9.0 with sources.
