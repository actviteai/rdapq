# Changelog

Changes on `main` that are not in a release yet. npm `latest` is 1.4.0; this tree is 2.0.0 and unreleased (see the README). <!-- keep-version -->

## Unreleased

### Added

- **Hermes Agent (Nous Research).** `install --hermes` (`-Hermes` in `install.ps1`) writes the skill to `$HERMES_HOME/skills/software-development/rdap-q/` (default `~/.hermes`, or `%LOCALAPPDATA%\hermes` on Windows) with a Hermes frontmatter: a description that opens with its trigger sentence, `platforms`, `metadata.hermes.tags`, and `requires_toolsets: [terminal]`. The body names the engine as `${HERMES_SKILL_DIR}/tool/rdapq.js`. `status` reports the Hermes row. `--all` now covers nine harnesses.
- **NVIDIA NeMo Agent Toolkit.** `integrations/nemo/` is `rdapq-nat`, a pip package that registers the engine's commands as one NeMo function group (`rdapq__start`, `__plan`, `__check`, `__gate`, `__claim`, `__note`, `__state`), with a system-prompt snippet (`instructions.md`) and an example `tool_calling_agent` workflow. The tools run `rdapq.js`; calls are serialized, and a timeout stops the commands `check` started. `install --nemo` (`-Nemo` in `install.ps1`) installs the engine and prints the pip and workflow steps; it never runs pip, and `--all` leaves it out. `status` reports whether the Python on PATH can import `rdapq_nat`. CI runs its tests with and without the toolkit.
- **Hermes URL install.** `hermes skills install https://raw.githubusercontent.com/coldcanuk/rdapq/main/integrations/hermes/SKILL.md` installs the skill without the Node installer. `integrations/hermes/` is generated from `rdap-q-skill/` (`npm run sync`); `npm test` fails on drift, and `npm version` regenerates it.
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

- Metadata files no harness reads, checked against vendor docs and the Claude Code, Codex, Copilot, and Grok CLIs: `skills.json`, `agentskills.json`, the root `marketplace.json`, `.codex/skill.json`, `.grok/skill.json`, `.grok-plugin/`, and `.agents/plugins/rdap-q/plugin.json`. The root `marketplace.json` also broke `copilot plugin marketplace add`, because Copilot reads it before `.claude-plugin/marketplace.json`. The static checks keep these files deleted.

### Changed

- `.claude-plugin/plugin.json` passes `claude plugin validate`: `repository` is a string, `skills` is `["./rdap-q-skill"]`, and the `rules` and `commands` fields Claude Code rejects are gone. The root `plugin.json` keeps only `name`, `version`, `description`, and `skills`, so a whole-repo install in Copilot or Grok still finds the skill.
- README: four badges instead of fourteen, no JSON-LD block, no emoji headings. Ten npm keywords instead of 32.
