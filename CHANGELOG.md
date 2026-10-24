# Changelog

Changes on `main` that are not in a release yet. npm `latest` is 1.4.0; this tree is 2.0.0 and unreleased (see the README). <!-- keep-version -->

## Unreleased

### Added

- **Requirements and the coverage oracle.** `start --req "<clause>"` (repeatable) and `req "<clause>"` list the request's testable clauses; `cover <R-id> <test-file> "<text>"` ties each to a test, and refuses a file that is not a test, does not exist, or does not contain the text, so a wrong cover never costs a check round. The new `coverage` oracle (weight 20) passes only when every requirement is covered by a test that changed or imports a changed file; its value is covered/total on the 0–10 scale. It is required at every risk, so a task with no requirements cannot complete. This is the gap the 2.0.0 eval found: all six false COMPLETEs were spec clauses nobody wrote a test for.
- `check` prints the verdict and logs the gate event itself, so a lean task is `start`, edit, `cover`, `check`: one engine call fewer per round. `gate` still reprints the verdict without running anything, for CI, the Stop hook, and a second look.
- `start --task "<request>"` records the request; `start` prints up to five memory records that match the task's words or planned file names, so recall no longer needs its own turn. Each task has an id (`T-<date>-<hex>`), and `memory add` records the task a fact was learned in.
- **Rich on disk, lean in context.** The model never reads the task files, so they now hold what a reviewer or a training set needs at no token cost: each check round's full patch (`.rdapq/rounds/<n>.patch`, untracked files included, capped at 512 KB), diff statistics, every command's exit code and duration, the Q band, and each stop the Claude Code hook refused (`stop` events). A new `start` moves the whole previous task (`oracles.json`, `state.jsonl`, `rounds/`) to `.rdapq/archive/<time>/` instead of only the log. `export` rows gain the task id, requirement and cover counts, insertions and deletions, durations, and refused stops; they still carry no text, paths, or code.
- **Named scales.** `protocol [--json]` prints the risks, required oracles, weights, terminal states, and every scale with both ends named: oracle scores (10 pass, 5 partial, 0 fail), Q bands (10 omega, 8+ strong, 5+ mixed, under 5 weak, 0 alpha), and memory confidence (0 a guess … 10 primary source read and reproduced). `check` and `state` print Q with its band. `npm test` fails when SKILL.md, the README, or a manifest disagrees with the engine's constants, so the numbers live in one place.
- SKILL.md carries the loop's state machine as a Mermaid diagram: which check outcome leads to which terminal state, in eight lines.

- **Hermes Agent (Nous Research).** `install --hermes` (`-Hermes` in `install.ps1`) writes the skill to `$HERMES_HOME/skills/software-development/rdap-q/` (default `~/.hermes`, or `%LOCALAPPDATA%\hermes` on Windows) with a Hermes frontmatter: a description that opens with its trigger sentence, `platforms`, `metadata.hermes.tags`, and `requires_toolsets: [terminal]`. The body names the engine as `${HERMES_SKILL_DIR}/tool/rdapq.js`. `status` reports the Hermes row. `--all` now covers nine harnesses.
- **NVIDIA NeMo Agent Toolkit.** `integrations/nemo/` is `rdapq-nat`, a pip package that registers the engine's commands as one NeMo function group (`rdapq__start`, `__plan`, `__check`, `__gate`, `__claim`, `__note`, `__state`), with a system-prompt snippet (`instructions.md`) and an example `tool_calling_agent` workflow. The tools run `rdapq.js`; calls are serialized, and a timeout stops the commands `check` started. `install --nemo` (`-Nemo` in `install.ps1`) installs the engine and prints the pip and workflow steps; it never runs pip, and `--all` leaves it out. `status` reports whether the Python on PATH can import `rdapq_nat`. CI runs its tests with and without the toolkit.
- **Hermes URL install.** `hermes skills install https://raw.githubusercontent.com/actviteai/rdapq/main/integrations/hermes/SKILL.md` installs the skill without the Node installer. `integrations/hermes/` is generated from `rdap-q-skill/` (`npm run sync`); `npm test` fails on drift, and `npm version` regenerates it.
- `state --json` prints the task as one JSON object (`spec`, `required`, `rounds`, `lastCheck`, `notes`, `gate`) and writes nothing, so programs such as `rdapq-nat` never parse prose.

### Fixed

- `memory add` could reuse an id: ids are `M-<date>-<4 random hex>`, and records are keyed by id, so a collision (about 1% by the 40th record of a day) silently replaced an earlier record. New ids now skip every id already in either scope. This was also an intermittent CI failure in the memory test.
- Installing the plugin from the marketplace in Codex or Grok gave an empty `skills/` folder, so neither exposed the skill. `plugins/rdap-q/skills/rdap-q` was a symlink to `rdap-q-skill/`, outside the plugin directory, and both copy the plugin without following it. It is now a committed copy that `npm run sync` generates and `npm test` checks for drift. Claude Code and Copilot were not affected.
- Task commands refuse to treat the RDAP-Q home as a project: run from `~` (outside any repository), `start` used to write `oracles.json` and `state.jsonl` into `~/.rdapq`, beside memory and the installed skill. `start` also refuses a directory that is not a git repository, or a repository with no commits, before writing anything: without a base commit no task could reach COMPLETE.
- The eval's `playbooksRead`, `stateWrites`, and state footprint measure 2.x runs; they only knew the 1.x layout.
- `start --depth standard` is rejected; only `lean` and `full` exist.
- `install.sh` and `install.ps1` require Node.js 22, matching `engines.node`.
- Hermes' skill scanner no longer flags the engine as an environment dump (`options.env || process.env` became `??`), so a URL install passes its security scan.
- Metadata no longer names invented marketplace ids or a schema repository that does not exist.
- The gate no longer tells the agent to say "Vibe Code Build complete." The eval still recognizes the phrase in old transcripts.

### Removed

- The root `manifest.json`. No program read it (only the version stamp touched it), and it repeated `rdap-q-skill/manifest.json` with different path prefixes. The rule is JSON only where a program reads it. The static check keeps it deleted.

- Metadata files no harness reads, checked against vendor docs and the Claude Code, Codex, Copilot, and Grok CLIs: `skills.json`, `agentskills.json`, the root `marketplace.json`, `.codex/skill.json`, `.grok/skill.json`, `.grok-plugin/`, and `.agents/plugins/rdap-q/plugin.json`. The root `marketplace.json` also broke `copilot plugin marketplace add`, because Copilot reads it before `.claude-plugin/marketplace.json`. The static checks keep these files deleted.

### Changed

- **One source per repeated text.** The seven project bridges (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Cline, Goose, Grok, Copilot) were byte-identical files maintained by hand; they are now generated from `bridges/project.md` by `npm run sync`. The NeMo example workflow's `system_prompt` is rendered from `instructions.md` instead of being checked for equality after the fact. `npm test` fails on drift in either. `CONTRIBUTING.md` draws the whole source-to-copy pipeline and states the design review scale (0 alpha … 10 omega: correct and enforced).
- Oracle weights are runtime 30, repo 20, coverage 20, repro 10, external 10, claims 10 (were 35/25/–/10/15/15). Q from a 2.0.0 pre-release log is not comparable.
- `.claude-plugin/plugin.json` passes `claude plugin validate`: `repository` is a string, `skills` is `["./rdap-q-skill"]`, and the `rules` and `commands` fields Claude Code rejects are gone. The root `plugin.json` keeps only `name`, `version`, `description`, and `skills`, so a whole-repo install in Copilot or Grok still finds the skill.
- README: four badges instead of fourteen, no JSON-LD block, no emoji headings. Ten npm keywords instead of 32.
