'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.resolve(__dirname, '..');

test('npm pack includes the skill, bridges, and marketplace copy, and no agent folders', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  const paths = ((Array.isArray(parsed) ? parsed[0] : parsed).files || []).map((file) => file.path);
  for (const want of [
    'rdap-q-skill/SKILL.md',
    'rdap-q-skill/tool/rdapq.js',
    'plugins/rdap-q/skills/rdap-q/SKILL.md',
    'lib/installer.js',
    // install --hermes renders SKILL.md with lib/hermes.js at install time.
    'lib/hermes.js',
    // install --claude and init copy these into the harness and the project.
    'bridges/claude/commands/rdapq.md',
    'bridges/grok/rules.md',
    '.github/copilot-instructions.md',
  ]) assert.ok(paths.includes(want), `missing ${want}`);
  assert.deepEqual(paths.filter((rel) => /^\.(claude|grok|agents|agent|codex|copilot)\//.test(rel)), []);
});

test('npm pack ships only tracked files, even from a dirty checkout', (t) => {
  const planted = [
    '.claude/settings.local.json',
    '.claude/sessions/planted.txt',
    '.agents/planted.txt',
    '.grok/sessions/planted.txt',
    '.github/planted.txt',
    'scripts/harness-audit/__pycache__/planted.pyc',
  ].filter((rel) => !fs.existsSync(path.join(REPO, rel)));
  t.after(() => {
    for (const rel of planted) {
      fs.rmSync(path.join(REPO, rel), { force: true });
      for (let dir = path.dirname(rel); dir !== '.'; dir = path.dirname(dir)) {
        const abs = path.join(REPO, dir);
        if (!fs.existsSync(abs) || fs.readdirSync(abs).length) break;
        fs.rmdirSync(abs);
      }
    }
  });
  for (const rel of planted) {
    fs.mkdirSync(path.dirname(path.join(REPO, rel)), { recursive: true });
    fs.writeFileSync(path.join(REPO, rel), 'planted\n');
  }
  const tracked = new Set(spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n').filter(Boolean));
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const untracked = (entry.files || []).map((file) => file.path)
    .filter((rel) => rel !== 'package.json' && !tracked.has(rel));
  assert.deepEqual(untracked, []);
});

test('package.json points at the actviteai/rdapq repository', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.repository.url, 'git+https://github.com/actviteai/rdapq.git');
  assert.equal(pkg.homepage, 'https://github.com/actviteai/rdapq#readme');
  assert.equal(pkg.bugs.url, 'https://github.com/actviteai/rdapq/issues');
});

test('no tracked file points at the old coldcanuk/rdapq repository', () => {
  const res = spawnSync('git', ['grep', '-n', 'coldcanuk/rdapq', '--', '.', ':!test/packaging.test.js'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(res.stdout, '', res.stdout);
});

test('.gitignore keeps every agent harness folder out of the repository', () => {
  const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: REPO }).status === 0;
  for (const rel of [
    '.claude/settings.local.json', '.claude/commands/rdapq.md', '.claude/skills/rdap-q/SKILL.md',
    '.grok/rules.md', '.agents/skills/rdap-q/SKILL.md', '.agent/x', '.codex/x', '.copilot/x', '.worktrees/x',
  ]) assert.equal(ignored(rel), true, `${rel} should be ignored`);
  for (const rel of ['.claude-plugin/marketplace.json', 'bridges/claude/commands/rdapq.md', 'bridges/grok/rules.md']) {
    assert.equal(ignored(rel), false, `${rel} must stay tracked`);
  }
  const tracked = spawnSync('git', ['ls-files', '.claude', '.grok', '.agents', '.agent', '.codex', '.copilot'], { cwd: REPO, encoding: 'utf8' }).stdout;
  assert.equal(tracked, '');
  assert.equal(spawnSync('git', ['ls-files', '-ci', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' }).stdout, '');
});

test('package and plugin manifests name the actvite.com owner', () => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
  const author = { name: 'coldcanuk', email: 'chuck@actvite.com', url: 'https://actvite.com' };
  assert.deepEqual(read('package.json').author, author);
  const market = read('.claude-plugin/marketplace.json');
  assert.equal(market.owner.email, author.email);
  assert.deepEqual(market.plugins[0].author, author);
  assert.deepEqual(read('.claude-plugin/plugin.json').author, author);
  assert.deepEqual(read('plugins/rdap-q/plugin.json').author, author);
  assert.match(fs.readFileSync(path.join(REPO, 'integrations/nemo/pyproject.toml'), 'utf8'), /authors = \[\{ name = "coldcanuk", email = "chuck@actvite\.com" \}\]/);
});
