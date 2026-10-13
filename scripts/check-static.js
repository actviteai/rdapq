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
need('.gitignore', /^\.code-dr\/$/m, 'diagnostic artifacts must be ignored');

// Metadata must not name listings or schemas that do not exist. Both were
// invented once: catalog ids for catalogs RDAP-Q is not in, and $schema URLs
// under github.com/agent-skills/spec, which is a 404.
for (const rel of ['skills.json', 'agentskills.json', 'marketplace.json']) {
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

for (const rel of ['bin/rdapq.js', 'lib/installer.js', 'scripts/check-versions.js', 'scripts/check-static.js', 'scripts/materialize-skill-links.js', 'scripts/stamp-version.js', 'scripts/version-targets.js', 'rdap-q-skill/tool/rdapq.js', 'eval/run.js', 'eval/report.js', 'eval/lib/agents.js']) {
  const checked = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
  if (checked.status !== 0) {
    failures.push(`${rel}: node --check failed\n${checked.stderr}`);
  }
}

const pluginPath = path.join(ROOT, '.agents/plugins/rdap-q/plugin.json');
const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
const base = path.dirname(pluginPath);
for (const rel of [...(plugin.rules || []), ...(plugin.skills || [])]) {
  const resolved = path.resolve(base, rel);
  if (!fs.existsSync(resolved)) {
    failures.push(`.agents plugin path does not exist: ${rel} -> ${resolved}`);
  }
}

need('rdap-q-skill/README.md', /SKILL\.md` is the instruction source/, 'README must point at SKILL.md and not act as a second protocol');

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
for (const bridge of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.clinerules', '.goosehints', '.grok/rules.md', '.github/copilot-instructions.md', '.claude/commands/rdapq.md']) {
  need(bridge, /^Fallback: /m, 'bridge needs a Fallback line the installer can point at the installed core');
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('static checks ok\n');
