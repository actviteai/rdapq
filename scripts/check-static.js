'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function ban(rel, pattern, why) {
  if (pattern.test(read(rel))) failures.push(`${rel}: ${why}`);
}

function need(rel, pattern, why) {
  if (!pattern.test(read(rel))) failures.push(`${rel}: ${why}`);
}

ban('install.sh', /\brm\b/, 'wrapper must not delete user files');
ban('install.sh', /\|\|\s*true/, 'wrapper must not hide copy failures');
need('install.sh', /refusing a piped install/, 'wrapper must refuse curl | bash');
need('install.ps1', /refusing a piped install/, 'wrapper must refuse irm | iex');
ban('install.ps1', /Remove-Item/, 'wrapper must not delete user files');
ban('rdap-q-skill/install/install-unix.sh', /rm -rf "\$TARGET\/skills\/rdap-q"/, 'must not delete the live skill before the copy succeeds');
ban('rdap-q-skill/install/install-unix.sh', /\|\|\s*true/, 'must not hide copy failures');
need('rdap-q-skill/install/install-unix.sh', /SKILL\.md/, 'must verify the staged skill before swapping');

// Metadata nothing reads must stay deleted. Each of these was audited against
// vendor docs and the harness CLIs on 2026-10-13. A root marketplace.json also
// breaks Copilot: it reads that file before .claude-plugin/marketplace.json.
for (const rel of ['skills.json', 'agentskills.json', 'marketplace.json', '.codex/skill.json', '.grok/skill.json', '.grok-plugin', '.agents/plugins']) {
  if (fs.existsSync(path.join(ROOT, rel))) failures.push(`${rel}: no harness reads it; it was deleted on purpose`);
}
// Metadata must not name listings or schemas that do not exist. Both were
// invented once: catalog ids for catalogs RDAP-Q is not in, and $schema URLs
// under github.com/agent-skills/spec, which is a 404.
for (const rel of ['plugin.json', '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json', '.claude-plugin/plugin-index.json', 'plugins/rdap-q/plugin.json', 'manifest.json', 'rdap-q-skill/manifest.json']) {
  ban(rel, /"marketplace_identifier"/, 'names a marketplace listing that does not exist');
  ban(rel, /agent-skills\/spec/, 'points at a schema repository that does not exist');
}

const pkg = JSON.parse(read('package.json'));
const bin = pkg.bin || {};
if (bin['rdapq-install'] && String(bin['rdapq-install']).includes('install.sh')) {
  failures.push('package.json bin.rdapq-install must not point at the shell script');
}
if (bin.rdapq !== './bin/rdapq.js' || bin['rdap-q'] !== './bin/rdapq.js') {
  failures.push('package.json bin entries must point at bin/rdapq.js');
}

for (const rel of ['bin/rdapq.js', 'lib/installer.js', 'lib/hermes.js', 'scripts/check-versions.js', 'scripts/check-static.js', 'scripts/sync-integrations.js', 'scripts/stamp-version.js', 'scripts/version-targets.js', 'rdap-q-skill/tool/rdapq.js', 'eval/run.js', 'eval/report.js', 'eval/lib/agents.js']) {
  const checked = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
  if (checked.status !== 0) {
    failures.push(`${rel}: node --check failed\n${checked.stderr}`);
  }
}

// Claude Code plugin manifests: the shape `claude plugin validate` accepts.
// Skills are "./"-relative directories that contain SKILL.md.
for (const rel of ['.claude-plugin/plugin.json', 'plugins/rdap-q/plugin.json']) {
  const plugin = JSON.parse(read(rel));
  const base = rel === '.claude-plugin/plugin.json' ? ROOT : path.join(ROOT, path.dirname(rel));
  if (plugin.repository !== undefined && typeof plugin.repository !== 'string') failures.push(`${rel}: repository must be a string`);
  for (const key of ['rules', 'commands']) {
    if (plugin[key] !== undefined) failures.push(`${rel}: "${key}" is not a field Claude Code accepts here`);
  }
  for (const skill of plugin.skills || []) {
    if (!String(skill).startsWith('./')) failures.push(`${rel}: skill path ${skill} must start with ./`);
    else if (!fs.existsSync(path.join(base, skill, 'SKILL.md'))) failures.push(`${rel}: ${skill} has no SKILL.md`);
  }
}
// The root plugin.json is what Copilot and Grok read when the whole repository
// is installed as a plugin. Neither accepts "rules".
{
  const plugin = JSON.parse(read('plugin.json'));
  if (plugin.rules !== undefined) failures.push('plugin.json: "rules" is not a plugin field');
  for (const skill of plugin.skills || []) {
    if (!fs.existsSync(path.join(ROOT, skill, 'SKILL.md'))) failures.push(`plugin.json: ${skill} has no SKILL.md`);
  }
}
{
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  if (!market.owner || !Array.isArray(market.plugins) || !market.plugins.length) failures.push('.claude-plugin/marketplace.json: needs owner and plugins');
  for (const entry of market.plugins || []) {
    if (!fs.existsSync(path.join(ROOT, entry.source || '', 'skills'))) failures.push(`.claude-plugin/marketplace.json: ${entry.name} source ${entry.source} has no skills/`);
  }
}

need('rdap-q-skill/README.md', /SKILL\.md` is the instruction source/, 'README must point at SKILL.md and not act as a second protocol');

// Hermes Agent: the installed SKILL.md is rendered from rdap-q-skill/SKILL.md
// at install time, so check the render, not a file on disk.
{
  const hermes = require('../lib/hermes');
  const rendered = hermes.renderInstalled(read('rdap-q-skill/SKILL.md'), pkg.version);
  for (const problem of hermes.checkFrontmatter(rendered, pkg.version)) failures.push(`Hermes SKILL.md render: ${problem}`);
  // integrations/hermes/ is what `hermes skills install <raw URL>` fetches. It is
  // generated from rdap-q-skill/ and must not drift from it.
  for (const problem of require('./sync-integrations').drift()) failures.push(problem);
  const hub = read('integrations/hermes/SKILL.md');
  for (const problem of hermes.checkFrontmatter(hub, pkg.version)) failures.push(`integrations/hermes/SKILL.md: ${problem}`);
  if (/\btool\/|\bplaybooks\//.test(hub)) failures.push('integrations/hermes/SKILL.md must name scripts/ and references/, which a URL install copies');
}

// NeMo Agent Toolkit: integrations/nemo wraps engine commands as tools, so its
// tool names and argument choices must stay the engine's, and the example
// workflow's system prompt must stay the published instructions.md.
{
  const engineSrc = read('rdap-q-skill/tool/rdapq.js');
  const { COMMANDS } = require('../rdap-q-skill/tool/rdapq.js');
  const register = read('integrations/nemo/src/rdapq_nat/register.py');
  const quoted = (text, q) => (text.match(new RegExp(`${q}([^${q}]+)${q}`, 'g')) || []).map((s) => s.slice(1, -1));
  const tools = quoted((/^TOOLS = \(([^)]*)\)/m.exec(register) || [])[1] || '', '"');
  if (!tools.length) failures.push('integrations/nemo/src/rdapq_nat/register.py: TOOLS not found');
  for (const tool of tools) {
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, tool)) failures.push(`integrations/nemo: tool "${tool}" is not an engine command`);
  }
  for (const name of ['RISKS', 'NOTE_TYPES']) {
    const values = quoted((new RegExp(`^const ${name} = \\[([^\\]]*)\\]`, 'm').exec(engineSrc) || [])[1] || '', "'");
    const literal = `Literal[${values.map((v) => `"${v}"`).join(', ')}]`;
    if (!values.length || !register.includes(literal)) failures.push(`integrations/nemo: register.py must offer the engine's ${name} as ${literal}`);
  }
  const workflow = /^ {2}system_prompt: \|\n((?: {4}.*\n|\n)+)/m.exec(read('integrations/nemo/examples/workflow.yaml'));
  const inline = workflow ? workflow[1].replace(/^ {4}/gm, '').trim() : '';
  if (inline !== read('integrations/nemo/instructions.md').trim()) {
    failures.push('integrations/nemo/examples/workflow.yaml: system_prompt must be instructions.md verbatim');
  }
}

// Every file a manifest names must exist.
for (const [rel, prefix] of [['manifest.json', ''], ['rdap-q-skill/manifest.json', 'rdap-q-skill/']]) {
  const manifest = JSON.parse(read(rel));
  const named = [manifest.entrypoint, manifest.tool, ...Object.values(manifest.depth_load || {}).flat(), ...Object.values(manifest.event_load || {}).flat()];
  for (const item of named) {
    if (!item || !fs.existsSync(path.join(ROOT, prefix, item))) failures.push(`${rel}: names a missing file ${item}`);
  }
  if (!(manifest.event_load && manifest.event_load.git_mutation)) {
    failures.push(`${rel}: git_mutation event must point at the git playbook`);
  }
}

// The protocol is a token budget: SKILL.md is loaded on every /rdapq run.
const skill = read('rdap-q-skill/SKILL.md');
if (Buffer.byteLength(skill) > 6144) failures.push(`rdap-q-skill/SKILL.md is ${Buffer.byteLength(skill)} bytes; keep it under 6144 (about 1.5k tokens)`);
need('rdap-q-skill/SKILL.md', /tool\/rdapq\.js/, 'SKILL must route measurement through the bundled tool');
need('rdap-q-skill/SKILL.md', /Never say COMPLETE unless `gate` printed COMPLETE/, 'SKILL must forbid self-declared completion');
for (const gone of ['core', 'state', 'templates']) {
  if (fs.existsSync(path.join(ROOT, 'rdap-q-skill', gone))) failures.push(`rdap-q-skill/${gone}/ was replaced by the engine and must stay deleted`);
}
for (const bridge of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.clinerules', '.goosehints', 'bridges/grok/rules.md', '.github/copilot-instructions.md', 'bridges/claude/commands/rdapq.md']) {
  need(bridge, /^Fallback: /m, 'bridge needs a Fallback line the installer can point at the installed core');
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('static checks ok\n');
