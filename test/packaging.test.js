'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { LINKS, restore } = require('../scripts/materialize-skill-links');

const REPO = path.resolve(__dirname, '..');

function isSymlink(rel) {
  return fs.lstatSync(path.join(REPO, rel)).isSymbolicLink();
}

test('npm pack includes marketplace skill bodies and restores symlinks', () => {
  for (const rel of LINKS) assert.equal(isSymlink(rel), true, rel);
  let packed = null;
  try {
    const result = spawnSync('npm', ['pack', '--json', '--ignore-scripts=false'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    packed = path.join(REPO, entry.filename);
    const paths = (entry.files || []).map((file) => file.path);
    assert.ok(paths.some((item) => item.endsWith('plugins/rdap-q/skills/rdap-q/SKILL.md')), paths.filter((item) => item.includes('skills/rdap-q')).join('\n'));
    assert.ok(paths.some((item) => item.endsWith('.agents/skills/rdap-q/SKILL.md')));
    assert.ok(paths.some((item) => item.endsWith('package/lib/installer.js') || item.endsWith('lib/installer.js')));
    // install --hermes renders SKILL.md with lib/hermes.js at install time.
    assert.ok(paths.some((item) => item.endsWith('lib/hermes.js')), 'lib/hermes.js must be packed');
  } finally {
    restore();
    if (packed && fs.existsSync(packed)) fs.unlinkSync(packed);
    const stray = fs.readdirSync(REPO).filter((name) => name.endsWith('.tgz'));
    for (const name of stray) fs.unlinkSync(path.join(REPO, name));
  }
  for (const rel of LINKS) assert.equal(isSymlink(rel), true, `${rel} was not restored`);
  assert.equal(fs.existsSync(path.join(REPO, '.rdapq-pack-state.json')), false);
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
  const untracked = (entry.files || []).map((file) => file.path).filter((rel) => {
    if (rel === 'package.json' || tracked.has(rel)) return false;
    const link = LINKS.find((l) => rel.startsWith(`${l}/`));
    return !(link && tracked.has(`rdap-q-skill/${rel.slice(link.length + 1)}`));
  });
  assert.deepEqual(untracked, []);
});

test('package.json points at the actviteai/rdapq repository', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.repository.url, 'git+https://github.com/actviteai/rdapq.git');
  assert.equal(pkg.homepage, 'https://github.com/actviteai/rdapq#readme');
  assert.equal(pkg.bugs.url, 'https://github.com/actviteai/rdapq/issues');
});
