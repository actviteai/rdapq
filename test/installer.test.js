'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.resolve(__dirname, '..');
const { copyTreeSafe, placeConfigFile, publishTree, resolveLayout, runCli } = require('../lib/installer');
const hermes = require('../lib/hermes');

function tempLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    RDAPQ_HOME: path.join(root, 'rdapq'),
    GEMINI_HOME: path.join(root, 'gemini'),
    GOOSE_HOME: path.join(root, 'goose'),
    CLAUDE_HOME: path.join(root, 'claude'),
    CLINE_HOME: path.join(root, 'cline'),
    CODEX_HOME: path.join(root, 'codex'),
    GROK_HOME: path.join(root, 'grok'),
    COPILOT_HOME: path.join(root, 'copilot'),
    CURSOR_HOME: path.join(root, 'cursor'),
    // Set explicitly: a developer running the tests inside Hermes has a real HERMES_HOME.
    HERMES_HOME: path.join(root, 'hermes'),
  };
  return { root, home, env };
}

function run(args, env, extra = {}) {
  let out = '';
  let err = '';
  const code = runCli(args, {
    pkgRoot: REPO,
    env,
    cwd: extra.cwd,
    invokedAs: extra.invokedAs,
    stdout: (chunk) => { out += chunk; },
    stderr: (chunk) => { err += chunk; },
  });
  return { code, out, err };
}

test('bare install command still installs every harness', () => {
  const { env } = tempLayout();
  const result = run(['install'], env);
  assert.equal(result.code, 0, result.err);
  assert.equal(fs.existsSync(path.join(env.HOME, '.agents', 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.GROK_HOME, 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_HOME, 'commands', 'rdapq.md')), true);
});

test('codex and copilot get skills, not always-on global rules', () => {
  const { env } = tempLayout();
  const result = run(['install', '--codex', '--copilot'], env);
  assert.equal(result.code, 0, result.err);
  assert.equal(fs.existsSync(path.join(env.HOME, '.agents', 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.COPILOT_HOME, 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.CODEX_HOME, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(env.COPILOT_HOME, 'copilot-instructions.md')), false);
});

test('global bridges fall back to the installed core, not a repo path', () => {
  const { env } = tempLayout();
  const result = run(['install', '--claude', '--cline', '--goose'], env);
  assert.equal(result.code, 0, result.err);
  const core = path.join(env.RDAPQ_HOME, 'skills', 'rdap-q', 'SKILL.md');
  assert.equal(fs.existsSync(core), true);
  for (const bridge of [
    path.join(env.CLAUDE_HOME, 'commands', 'rdapq.md'),
    path.join(env.CLINE_HOME, 'rules', 'rdapq.md'),
    path.join(env.GOOSE_HOME, '.goosehints'),
  ]) {
    const body = fs.readFileSync(bridge, 'utf8');
    assert.ok(body.includes(`Fallback: \`${core}\`\n`), `${bridge}:\n${body}`);
    assert.doesNotMatch(body, /Fallback: `rdap-q-skill/);
  }
  const again = run(['install', '--claude'], env);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /unchanged .*rdapq\.md/);
});

test('install --claude does not install the other harnesses', () => {
  const { env } = tempLayout();
  const result = run(['install', '--claude'], env);
  assert.equal(result.code, 0, result.err);
  assert.equal(fs.existsSync(path.join(env.RDAPQ_HOME, 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_HOME, 'commands', 'rdapq.md')), true);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_HOME, 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.CODEX_HOME, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(env.GROK_HOME, 'skills', 'rdap-q', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(env.COPILOT_HOME, 'copilot-instructions.md')), false);
  assert.equal(fs.existsSync(path.join(env.CLINE_HOME, 'rules', 'rdapq.md')), false);
  assert.equal(fs.existsSync(path.join(env.GEMINI_HOME, 'antigravity-cli', 'skills', 'rdap-q', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(env.GOOSE_HOME, '.goosehints')), false);
  assert.equal(fs.existsSync(path.join(env.CURSOR_HOME, 'skills', 'rdap-q', 'SKILL.md')), false);
  const pkg = require('../package.json');
  assert.match(result.out, new RegExp(`v${pkg.version.replace(/\./g, '\\.')}`));
  assert.match(result.out, /Done in \d+ms/);
});

test('rdapq-install alias defaults to install and honors selectors', () => {
  const { env } = tempLayout();
  const result = run(['--grok'], env, { invokedAs: 'rdapq-install' });
  assert.equal(result.code, 0, result.err);
  assert.equal(fs.existsSync(path.join(env.GROK_HOME, 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.CODEX_HOME, 'AGENTS.md')), false);
});

test('install --all covers every harness and honors home overrides', () => {
  const { env, home } = tempLayout();
  const result = run(['install', '--all'], env);
  assert.equal(result.code, 0, result.err);
  const expected = [
    path.join(env.RDAPQ_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.GEMINI_HOME, 'antigravity-cli', 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.GEMINI_HOME, 'config', 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.CLAUDE_HOME, 'commands', 'rdapq.md'),
    path.join(env.CLAUDE_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.CLINE_HOME, 'rules', 'rdapq.md'),
    path.join(env.COPILOT_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(home, '.agents', 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.GROK_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.GOOSE_HOME, '.goosehints'),
    path.join(env.CURSOR_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.HERMES_HOME, 'skills', 'software-development', 'rdap-q', 'SKILL.md'),
  ];
  for (const file of expected) assert.equal(fs.existsSync(file), true, file);
  assert.equal(fs.existsSync(path.join(home, '.copilot')), false);
  assert.equal(fs.existsSync(path.join(home, '.codex')), false);
  assert.equal(fs.existsSync(path.join(home, '.cursor')), false);
  assert.equal(fs.existsSync(path.join(home, '.hermes')), false);
});

test('install --cursor writes a Cursor skill and leaves other harnesses alone', () => {
  const { env, home } = tempLayout();
  const result = run(['install', '--cursor'], env);
  assert.equal(result.code, 0, result.err);
  const skill = path.join(env.CURSOR_HOME, 'skills', 'rdap-q', 'SKILL.md');
  const body = fs.readFileSync(skill, 'utf8');
  assert.match(body, /^---\nname: rdap-q\n/);
  assert.match(body, /disable-model-invocation: true/);
  assert.equal(fs.existsSync(path.join(env.CURSOR_HOME, 'skills', 'rdap-q', 'tool', 'rdapq.js')), true);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_HOME, 'commands', 'rdapq.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.cursor')), false);
});

test('reinstall replaces skill trees but keeps durable memory and drops stale files', () => {
  const { env } = tempLayout();
  assert.equal(run(['install', '--global-only'], env).code, 0);
  const skill = path.join(env.RDAPQ_HOME, 'skills', 'rdap-q');
  fs.writeFileSync(path.join(skill, 'STALE.md'), 'stale');
  fs.writeFileSync(path.join(env.RDAPQ_HOME, 'memory', 'lessons.md'), 'keep-me');
  const again = run(['install', '--global-only'], env);
  assert.equal(again.code, 0, again.err);
  assert.equal(fs.existsSync(path.join(skill, 'STALE.md')), false);
  assert.equal(fs.existsSync(path.join(skill, 'SKILL.md')), true);
  assert.equal(fs.readFileSync(path.join(env.RDAPQ_HOME, 'memory', 'lessons.md'), 'utf8'), 'keep-me');
});

test('init keeps a custom harness file unless --force, and never follows a symlink', () => {
  const { env, root } = tempLayout();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'custom rules\n');
  const first = run(['init'], env, { cwd: repo });
  assert.equal(first.code, 0, first.err);
  assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), 'custom rules\n');
  assert.match(fs.readFileSync(path.join(repo, 'AGENTS.md.rdapq'), 'utf8'), /RDAP-Q/);
  assert.equal(fs.existsSync(path.join(repo, '.rdapq')), true);
  assert.equal(fs.existsSync(path.join(repo, '.agents', 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(repo, '.claude', 'skills', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(repo, '.clinerules', 'rdapq.md')), true);
  assert.equal(fs.existsSync(path.join(repo, 'CLAUDE.md')), true);

  const linked = path.join(repo, 'linked-target.md');
  fs.writeFileSync(linked, 'outside\n');
  fs.rmSync(path.join(repo, 'GEMINI.md'));
  fs.symlinkSync(linked, path.join(repo, 'GEMINI.md'));
  const forced = run(['init', '--force'], env, { cwd: repo });
  assert.equal(forced.code, 1);
  assert.match(forced.err, /refusing to follow symlink/);
  assert.equal(fs.readFileSync(linked, 'utf8'), 'outside\n');

  fs.unlinkSync(path.join(repo, 'GEMINI.md'));
  const replaced = run(['init', '--force'], env, { cwd: repo });
  assert.equal(replaced.code, 0, replaced.err);
  assert.match(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), /RDAP-Q/);
  assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md.rdapq-backup'), 'utf8'), 'custom rules\n');
});

test('identical bridges are left unchanged and status reports them', () => {
  const { env, root } = tempLayout();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  assert.equal(run(['--repo', repo], env).code, 0);
  const second = run(['--repo', repo], env);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /unchanged/);
  assert.equal(fs.existsSync(path.join(repo, 'AGENTS.md.rdapq')), false);
  const status = run(['status'], env);
  assert.equal(status.code, 0, status.err);
  assert.match(status.out, /Core Protocol/);
  assert.match(status.out, /Not installed/);
});

test('--global-only cannot be combined with a harness selector', () => {
  const { env } = tempLayout();
  const result = run(['install', '--global-only', '--claude'], env);
  assert.equal(result.code, 1);
  assert.match(result.err, /--global-only/);
  assert.equal(fs.existsSync(env.RDAPQ_HOME), false);
});

test('unknown options fail before writing', () => {
  const { env } = tempLayout();
  const result = run(['install', '--not-a-flag'], env);
  assert.equal(result.code, 1);
  assert.match(result.err, /unknown option/);
  assert.equal(fs.existsSync(env.RDAPQ_HOME), false);
});

test('help does not install', () => {
  const { env } = tempLayout();
  const result = run(['--help'], env);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /--force/);
  assert.equal(fs.existsSync(env.RDAPQ_HOME), false);
});

test('publishTree leaves the previous skill in place when staging is incomplete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-tree-'));
  const dest = path.join(root, 'skills', 'rdap-q');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'SKILL.md'), 'OLD');
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'README.md'), 'no skill marker');
  assert.throws(() => publishTree(src, dest), /SKILL\.md/);
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'OLD');
  assert.equal(fs.readdirSync(path.join(root, 'skills')).includes('rdap-q'), true);
});

test('copyTreeSafe rejects outbound symlinks and preserves internal ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-link-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'SKILL.md'), 'skill');
  fs.symlinkSync('./SKILL.md', path.join(src, 'alias.md'));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'nope');
  fs.symlinkSync(path.join(root, 'secret.txt'), path.join(src, 'leak'));
  assert.throws(() => copyTreeSafe(src, path.join(root, 'bad'), src), /outbound symlink/);
  fs.unlinkSync(path.join(src, 'leak'));
  const dest = path.join(root, 'dest');
  copyTreeSafe(src, dest, src);
  assert.equal(fs.lstatSync(path.join(dest, 'alias.md')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'skill');
});

test('placeConfigFile does not overwrite without force', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-cfg-'));
  const src = path.join(root, 'src.md');
  const dest = path.join(root, 'AGENTS.md');
  fs.writeFileSync(src, 'packaged\n');
  fs.writeFileSync(dest, 'mine\n');
  const kept = placeConfigFile(src, dest, { force: false });
  assert.equal(kept.action, 'kept');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'mine\n');
  assert.equal(fs.readFileSync(`${dest}.rdapq`, 'utf8'), 'packaged\n');
  const replaced = placeConfigFile(src, dest, { force: true });
  assert.equal(replaced.action, 'replaced');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'packaged\n');
  assert.equal(fs.readFileSync(`${dest}.rdapq-backup`, 'utf8'), 'mine\n');
});

test('install.sh refuses a pipe and delegates a real launch', () => {
  const { env } = tempLayout();
  const piped = spawnSync('bash', ['-s', '--', '--global-only'], {
    input: fs.readFileSync(path.join(REPO, 'install.sh')),
    encoding: 'utf8',
    env,
  });
  assert.notEqual(piped.status, 0);
  assert.match(`${piped.stderr}\n${piped.stdout}`, /refusing a piped install/);
  assert.equal(fs.existsSync(path.join(env.RDAPQ_HOME, 'skills', 'rdap-q')), false);

  const launched = spawnSync('bash', [path.join(REPO, 'install.sh'), '--claude'], {
    encoding: 'utf8',
    env,
  });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_HOME, 'commands', 'rdapq.md')), true);
  assert.equal(fs.existsSync(path.join(env.CODEX_HOME, 'AGENTS.md')), false);
});

/** A PATH whose first `node` reports an old version and refuses to run anything. */
function oldNodePath(root, version = 'v20.11.1') {
  const bin = path.join(root, 'old-node-bin');
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, 'node');
  fs.writeFileSync(shim, [
    '#!/bin/sh',
    'case "$1" in',
    `  -v|--version) echo "${version}" ;;`,
    `  -p) echo "${version.slice(1).split('.')[0]}" ;;`,
    '  *) echo "old node must not run the installer" >&2; exit 99 ;;',
    'esac',
    '',
  ].join('\n'));
  fs.chmodSync(shim, 0o755);
  return `${bin}${path.delimiter}${process.env.PATH}`;
}

const POSIX = process.platform !== 'win32';

test('install.sh refuses Node older than 22 before writing anything', { skip: !POSIX && 'needs a POSIX shell' }, () => {
  const { env, root } = tempLayout();
  const r = spawnSync('bash', [path.join(REPO, 'install.sh'), '--claude'], { encoding: 'utf8', env: { ...env, PATH: oldNodePath(root) } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /Node\.js >= 22 is required \(found v20\.11\.1\)/);
  assert.equal(fs.existsSync(env.RDAPQ_HOME), false);
});

const PWSH = process.env.PWSH || 'pwsh';
const hasPwsh = POSIX && spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

test('install.ps1 refuses Node older than 22 and delegates a real launch', { skip: !hasPwsh && 'pwsh is not installed' }, () => {
  const { env, root } = tempLayout();
  const script = path.join(REPO, 'install.ps1');
  const pwsh = (args, extra = {}) => spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-File', script, ...args], { encoding: 'utf8', env: { ...env, ...extra } });

  const old = pwsh(['-Claude'], { PATH: oldNodePath(root) });
  assert.notEqual(old.status, 0);
  assert.match(`${old.stderr}\n${old.stdout}`, /Node\.js >= 22 is required \(found v20\.11\.1\)/);
  assert.equal(fs.existsSync(env.RDAPQ_HOME), false);

  const launched = pwsh(['-Claude', '-Hermes', '-Quiet']);
  assert.equal(launched.status, 0, `${launched.stderr}\n${launched.stdout}`);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_HOME, 'commands', 'rdapq.md')), true);
  assert.equal(fs.existsSync(path.join(env.HERMES_HOME, 'skills', 'software-development', 'rdap-q', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(env.CURSOR_HOME, 'skills', 'rdap-q')), false);
});

test('skill-local installer swaps only after a verified stage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-skill-'));
  const env = { ...process.env, HOME: root, RDAPQ_HOME: path.join(root, 'home') };
  const script = path.join(REPO, 'rdap-q-skill', 'install', 'install-unix.sh');
  const first = spawnSync('sh', [script], { encoding: 'utf8', env });
  assert.equal(first.status, 0, first.stderr);
  const dest = path.join(env.RDAPQ_HOME, 'skills', 'rdap-q');
  fs.writeFileSync(path.join(dest, 'STALE.md'), 'stale');
  const second = spawnSync('sh', [script], { encoding: 'utf8', env });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.existsSync(path.join(dest, 'STALE.md')), false);
  assert.equal(fs.existsSync(path.join(dest, 'SKILL.md')), true);
  assert.match(second.stdout, /Installed RDAP-Q/);
});

test('task commands route to the bundled engine', () => {
  const { env, root } = tempLayout();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const gate = run(['gate'], env, { cwd: repo });
  assert.equal(gate.code, 1);
  assert.match(gate.out, /UNCLEAR_TASK/);
  const help = run(['--help'], env);
  assert.match(help.out, /rdapq check/);
});

test('init --hook merges the Stop hook into existing settings', () => {
  const { env, root } = tempLayout();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  assert.equal(run(['init', '--hook'], env, { cwd: repo }).code, 0);
  const settings = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
  assert.match(settings.hooks.Stop[0].hooks[0].command, /tool\/rdapq\.js" hook-stop$/);

  const other = path.join(root, 'other');
  const file = path.join(other, '.claude', 'settings.json');
  fs.mkdirSync(path.join(other, '.claude'), { recursive: true });
  fs.writeFileSync(file, '{"model":"x","hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo mine"}]}]}}\n');
  assert.equal(run(['init', '--hook'], env, { cwd: other }).code, 0);
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(merged.model, 'x');
  assert.equal(merged.hooks.Stop.length, 2);
  assert.equal(merged.hooks.Stop[0].hooks[0].command, 'echo mine');
  assert.match(fs.readFileSync(`${file}.rdapq-backup`, 'utf8'), /echo mine/);
  const again = run(['init', '--hook'], env, { cwd: other });
  assert.match(again.out, /unchanged .*settings\.json/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop.length, 2);

  const broken = path.join(root, 'broken');
  fs.mkdirSync(path.join(broken, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.claude', 'settings.json'), '{not json\n');
  assert.equal(run(['init', '--hook'], env, { cwd: broken }).code, 0);
  assert.equal(fs.readFileSync(path.join(broken, '.claude', 'settings.json'), 'utf8'), '{not json\n');
  assert.match(fs.readFileSync(path.join(broken, '.claude', 'settings.json.rdapq'), 'utf8'), /hook-stop/);

  assert.equal(run(['install', '--hook'], env).code, 1);
});

const SKILL_SRC = fs.readFileSync(path.join(REPO, 'rdap-q-skill', 'SKILL.md'), 'utf8');
const hermesSkill = (env) => path.join(env.HERMES_HOME, 'skills', 'software-development', 'rdap-q');

test('install --hermes writes a Hermes skill with Hermes frontmatter and leaves other harnesses alone', () => {
  const { env, home } = tempLayout();
  const result = run(['install', '--hermes'], env);
  assert.equal(result.code, 0, result.err);
  const dir = hermesSkill(env);
  const body = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const { version } = require('../package.json');
  assert.deepEqual(hermes.checkFrontmatter(body, version), []);
  assert.match(body, /^---\nname: rdap-q\ndescription: "Use when the user asks for RDAP-Q or evidence-gated work\. /);
  assert.match(body, new RegExp(`\\nversion: ${version.replace(/\./g, '\\.')}\\n`));
  assert.match(body, /\n {4}requires_toolsets: \[terminal\]\n/);
  assert.doesNotMatch(body, /disable-model-invocation/);
  assert.match(body, /for example `node \$\{HERMES_SKILL_DIR\}\/tool\/rdapq\.js gate`/);
  // Apart from the frontmatter and that one example path, the body is the packaged SKILL.md.
  const strip = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '').replace('${HERMES_SKILL_DIR}/tool/rdapq.js', '.agents/skills/rdap-q/tool/rdapq.js');
  assert.equal(strip(body), strip(SKILL_SRC));
  // The rest of the tree is copied as is: the engine and playbooks the body names.
  assert.equal(fs.readFileSync(path.join(dir, 'tool', 'rdapq.js'), 'utf8'), fs.readFileSync(path.join(REPO, 'rdap-q-skill', 'tool', 'rdapq.js'), 'utf8'));
  assert.equal(fs.existsSync(path.join(dir, 'playbooks', 'audit.md')), true);
  // Hermes needs no bridge file, and no other harness is touched.
  for (const other of [env.CLAUDE_HOME, env.CURSOR_HOME, env.GROK_HOME, env.COPILOT_HOME, env.CLINE_HOME, env.GEMINI_HOME, env.GOOSE_HOME, path.join(home, '.agents'), path.join(home, '.hermes')]) {
    assert.equal(fs.existsSync(other), false, other);
  }
  assert.match(result.out, /quick_commands\.rdapq\.target \/rdap-q/);
});

test('other harnesses keep the packaged SKILL.md byte for byte', () => {
  const { env } = tempLayout();
  assert.equal(run(['install', '--all'], env).code, 0);
  for (const skill of [
    path.join(env.RDAPQ_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.CLAUDE_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.CURSOR_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.GROK_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.COPILOT_HOME, 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.HOME, '.agents', 'skills', 'rdap-q', 'SKILL.md'),
    path.join(env.GEMINI_HOME, 'antigravity-cli', 'skills', 'rdap-q', 'SKILL.md'),
  ]) {
    assert.equal(fs.readFileSync(skill, 'utf8'), SKILL_SRC, skill);
  }
});

test('Hermes reinstall replaces the tree, keeps memory, and is stable; status reports it', () => {
  const { env } = tempLayout();
  assert.equal(run(['install', '--hermes'], env).code, 0);
  const dir = hermesSkill(env);
  const first = fs.readFileSync(path.join(dir, 'SKILL.md'));
  fs.writeFileSync(path.join(dir, 'STALE.md'), 'stale');
  fs.writeFileSync(path.join(env.RDAPQ_HOME, 'memory', 'records.jsonl'), '{"id":"M-1"}\n');
  // Hermes keeps its own bookkeeping beside skill dirs; a reinstall must not touch it.
  fs.writeFileSync(path.join(env.HERMES_HOME, 'skills', '.usage.json'), '{}\n');
  const again = run(['install', '--hermes'], env);
  assert.equal(again.code, 0, again.err);
  assert.equal(fs.existsSync(path.join(dir, 'STALE.md')), false);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'SKILL.md')), first);
  assert.equal(fs.readFileSync(path.join(env.RDAPQ_HOME, 'memory', 'records.jsonl'), 'utf8'), '{"id":"M-1"}\n');
  assert.equal(fs.readFileSync(path.join(env.HERMES_HOME, 'skills', '.usage.json'), 'utf8'), '{}\n');
  const status = run(['status'], env);
  assert.match(status.out, /\[✓\] Nous Research Hermes Agent\s*: Installed \(.*software-development[\\/]rdap-q[\\/]SKILL\.md\)/);
  assert.match(status.out, /\[✗\] Cursor\s*: Not installed/);
});

test('HERMES_HOME wins; otherwise Hermes lives in ~/.hermes, or %LOCALAPPDATA%\\hermes on Windows', () => {
  assert.equal(resolveLayout({ HOME: '/h', HERMES_HOME: '/profiles/work' }, 'linux').hermes, '/profiles/work');
  assert.equal(resolveLayout({ HOME: '/h' }, 'linux').hermes, path.join('/h', '.hermes'));
  assert.equal(resolveLayout({ HOME: '/h' }, 'darwin').hermes, path.join('/h', '.hermes'));
  assert.equal(resolveLayout({ USERPROFILE: '/u', LOCALAPPDATA: '/u/AppData/Local' }, 'win32').hermes, path.join('/u/AppData/Local', 'hermes'));
  assert.equal(resolveLayout({ USERPROFILE: '/u' }, 'win32').hermes, path.join('/u', 'AppData', 'Local', 'hermes'));
});

test('a SKILL.md render that fails leaves the previous skill in place', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-render-'));
  const dest = path.join(root, 'skills', 'rdap-q');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'SKILL.md'), 'OLD');
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'SKILL.md'), 'no frontmatter here');
  assert.throws(() => publishTree(src, dest, { renderSkill: (text) => hermes.renderInstalled(text, '9.9.9') }), /frontmatter/);
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'OLD');
  assert.deepEqual(fs.readdirSync(path.join(root, 'skills')), ['rdap-q']);
});
