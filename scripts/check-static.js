'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { BRIDGES, BRIDGE_TEMPLATE, CLAUDE_COMMAND } = require('./version-targets');

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
for (const rel of ['plugin.json', '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json', '.claude-plugin/plugin-index.json', 'plugins/rdap-q/plugin.json']) {
  ban(rel, /"marketplace_identifier"/, 'names a marketplace listing that does not exist');
  ban(rel, /agent-skills\/spec/, 'points at a schema repository that does not exist');
}

const pkg = JSON.parse(read('package.json'));
const bin = pkg.bin || {};
if (bin['rdapq-install'] && String(bin['rdapq-install']).includes('install.sh')) {
  failures.push('package.json bin.rdapq-install must not point at the shell script');
}
if (bin.rdapq !== 'bin/rdapq.js' || bin['rdap-q'] !== 'bin/rdapq.js') {
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
  // workflow.yaml's system_prompt is rendered from instructions.md by sync-integrations.js (drift() above).
}

// No manifest.json: no harness reads one (skills are SKILL.md plus files it
// names), and the rule is JSON only where a program reads it. Both the root
// and the skill manifest were deleted; the check keeps them deleted.
for (const rel of ['manifest.json', 'rdap-q-skill/manifest.json']) {
  if (fs.existsSync(path.join(ROOT, rel))) failures.push(`${rel}: nothing reads it; SKILL.md is the skill's only metadata`);
}
// Every playbook SKILL.md names must exist, and every playbook must be named.
{
  const named = new Set(read('rdap-q-skill/SKILL.md').match(/playbooks\/[\w-]+\.md/g) || []);
  if (named.size === 0) failures.push('rdap-q-skill/SKILL.md: must name its playbooks');
  for (const item of named) {
    if (!fs.existsSync(path.join(ROOT, 'rdap-q-skill', item))) failures.push(`rdap-q-skill/SKILL.md: names a missing file ${item}`);
  }
  for (const file of fs.readdirSync(path.join(ROOT, 'rdap-q-skill/playbooks'))) {
    if (!named.has(`playbooks/${file}`)) failures.push(`rdap-q-skill/playbooks/${file}: SKILL.md never names it, so no run can load it`);
  }
}

// Text the model reads has one form per content type (CONTRIBUTING.md):
// prose for rules, Markdown tables for shaped facts, Mermaid only for
// relationships, numbers rendered from the engine, JSON only for programs.
// This enforces what a script can decide about that.
{
  const MODEL_FACING = [
    'rdap-q-skill/SKILL.md',
    ...fs.readdirSync(path.join(ROOT, 'rdap-q-skill', 'playbooks')).map((f) => `rdap-q-skill/playbooks/${f}`),
    'integrations/nemo/instructions.md',
    BRIDGE_TEMPLATE,
    ...BRIDGES,
    CLAUDE_COMMAND,
  ];
  const DIAGRAMS = /^\s*(stateDiagram(-v2)?|flowchart|graph|sequenceDiagram)\b/;
  for (const rel of MODEL_FACING) {
    const lines = read(rel).split('\n');
    let fence = null; // language of the open fenced block
    let table = null; // { start, separator } of the open Markdown table
    lines.forEach((line, i) => {
      const n = i + 1;
      const open = /^\s*```\s*(\S*)/.exec(line);
      if (open) {
        if (fence === null) {
          fence = open[1].toLowerCase();
          if (['json', 'yaml', 'yml'].includes(fence)) failures.push(`${rel}:${n}: a ${fence} block; the model reads prose and tables, programs read JSON`);
          if (fence === 'mermaid' && !DIAGRAMS.test(lines[i + 1] || '')) failures.push(`${rel}:${n}: Mermaid is for relationships only (stateDiagram, flowchart, graph, sequenceDiagram)`);
        } else fence = null;
        return;
      }
      if (fence !== null) return;
      if (/^\s*[[{]\s*"/.test(line)) failures.push(`${rel}:${n}: a raw JSON line in text the model reads`);
      if (/^\s*\|/.test(line)) {
        if (!table) table = { start: n, separator: false };
        if (/^\s*\|\s*:?-{3,}/.test(line)) table.separator = true;
      } else if (table) {
        if (!table.separator) failures.push(`${rel}:${table.start}: a Markdown table without a header separator row`);
        table = null;
      }
    });
    if (table && !table.separator) failures.push(`${rel}:${table.start}: a Markdown table without a header separator row`);
  }
}

// The protocol is a token budget: SKILL.md is loaded on every /rdapq run.
const skill = read('rdap-q-skill/SKILL.md');
if (Buffer.byteLength(skill) > 6144) failures.push(`rdap-q-skill/SKILL.md is ${Buffer.byteLength(skill)} bytes; keep it under 6144 (about 1.5k tokens)`);
need('rdap-q-skill/SKILL.md', /tool\/rdapq\.js/, 'SKILL must route measurement through the bundled tool');
need('rdap-q-skill/SKILL.md', /Never say COMPLETE unless `gate` printed COMPLETE/, 'SKILL must forbid self-declared completion');

// The engine is the one source of the protocol's numbers and names. Every
// place that repeats them to a reader (SKILL.md, README) must
// say what `rdapq protocol --json` says, so a change in the engine cannot
// leave a stale table behind.
{
  const { protocol } = require('../rdap-q-skill/tool/rdapq.js');
  const p = protocol();
  const readme = read('README.md');
  for (const [name, weight] of Object.entries(p.weights)) {
    const row = new RegExp(`^\\| ${name} \\| ${weight} \\|`, 'm');
    if (!row.test(skill)) failures.push(`rdap-q-skill/SKILL.md: oracle table must have a row "| ${name} | ${weight} |"`);
    if (!row.test(readme)) failures.push(`README.md: oracle table must have a row "| ${name} | ${weight} |"`);
  }
  const low = p.required.LOW.join(', ');
  if (!skill.includes(`LOW and MODERATE need ${low}`)) failures.push(`rdap-q-skill/SKILL.md: must say "LOW and MODERATE need ${low}"`);
  if (!new RegExp(`\\| LOW, MODERATE \\| ${low} \\|`).test(readme)) failures.push(`README.md: risk table must say LOW, MODERATE need ${low}`);
  for (const state of p.terminal) {
    for (const [rel, text] of [['rdap-q-skill/SKILL.md', skill], ['README.md', readme]]) {
      if (!text.includes(state)) failures.push(`${rel}: must name the terminal state ${state}`);
    }
  }
  const [top, , , , bottom] = p.scales.Q;
  const scale = `10 ${top[1]} (${top[2]}), 8+ strong, 5+ mixed, under 5 weak, 0 ${bottom[1]} (nothing passed)`;
  if (!skill.includes(scale)) failures.push(`rdap-q-skill/SKILL.md: the Q scale line must read "${scale}"`);
}
for (const gone of ['core', 'state', 'templates']) {
  if (fs.existsSync(path.join(ROOT, 'rdap-q-skill', gone))) failures.push(`rdap-q-skill/${gone}/ was replaced by the engine and must stay deleted`);
}
for (const bridge of [BRIDGE_TEMPLATE, ...BRIDGES, CLAUDE_COMMAND]) {
  need(bridge, /^Fallback: /m, 'bridge needs a Fallback line the installer can point at the installed core');
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('static checks ok\n');
