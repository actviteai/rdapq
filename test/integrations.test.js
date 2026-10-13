'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const hermes = require('../lib/hermes');
const { drift, expected, write } = require('../scripts/sync-integrations');

const REPO = path.resolve(__dirname, '..');
const { version } = require('../package.json');

/** A scratch copy of just what the generator reads and writes. */
function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-sync-'));
  fs.cpSync(path.join(REPO, 'rdap-q-skill'), path.join(root, 'rdap-q-skill'), { recursive: true });
  fs.cpSync(path.join(REPO, 'integrations'), path.join(root, 'integrations'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'));
  return root;
}

test('integrations/hermes is committed, current, and a valid Hermes URL-install skill', () => {
  assert.deepEqual(drift(), []);
  const skill = fs.readFileSync(path.join(REPO, 'integrations', 'hermes', 'SKILL.md'), 'utf8');
  assert.deepEqual(hermes.checkFrontmatter(skill, version), []);
  // Every file the URL installer will fetch is named in SKILL.md under an allowed dir.
  for (const rel of expected().keys()) {
    if (rel !== 'SKILL.md') assert.ok(skill.includes(rel), `SKILL.md must name ${rel}`);
    assert.match(rel, /^(SKILL\.md|scripts\/|references\/)/);
  }
  assert.match(skill, /node \$\{HERMES_SKILL_DIR\}\/scripts\/rdapq\.js gate/);
  assert.doesNotMatch(skill, /\btool\/|\bplaybooks\//);
  // The engine copy is the engine, byte for byte.
  assert.equal(
    fs.readFileSync(path.join(REPO, 'integrations', 'hermes', 'scripts', 'rdapq.js'), 'utf8'),
    fs.readFileSync(path.join(REPO, 'rdap-q-skill', 'tool', 'rdapq.js'), 'utf8'),
  );
});

test('drift catches a stale engine, a stale playbook, a stray file, and a symlink; write repairs them', () => {
  const root = scratch();
  const out = path.join(root, 'integrations', 'hermes');
  assert.deepEqual(drift(root), []);
  fs.appendFileSync(path.join(root, 'rdap-q-skill', 'tool', 'rdapq.js'), '// changed\n');
  fs.appendFileSync(path.join(root, 'rdap-q-skill', 'playbooks', 'git.md'), 'changed\n');
  fs.writeFileSync(path.join(out, 'references', 'old.md'), 'stray\n');
  fs.rmSync(path.join(out, 'references', 'audit.md'));
  fs.symlinkSync(path.join(root, 'rdap-q-skill', 'playbooks', 'audit.md'), path.join(out, 'references', 'audit.md'));
  assert.deepEqual(drift(root).sort(), [
    'integrations/hermes/references/audit.md is a symlink; raw GitHub URLs do not follow it',
    'integrations/hermes/references/git.md is stale',
    'integrations/hermes/references/old.md is not generated; remove it or add it to scripts/sync-integrations.js',
    'integrations/hermes/scripts/rdapq.js is stale',
  ]);
  fs.rmSync(path.join(out, 'references', 'audit.md'));
  write(root);
  assert.deepEqual(drift(root), []);
  assert.equal(fs.existsSync(path.join(out, 'references', 'old.md')), false);
});

test('a version bump restamps the generated SKILL.md and sync agrees with the stamp', () => {
  const root = scratch();
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = '9.8.7';
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  assert.ok(drift(root).includes('integrations/hermes/SKILL.md is stale'));
  write(root);
  const skill = fs.readFileSync(path.join(root, 'integrations', 'hermes', 'SKILL.md'), 'utf8');
  assert.match(skill, /\nversion: 9\.8\.7\n/);
  assert.match(skill, /^# RDAP-Q /m);
  assert.deepEqual(hermes.checkFrontmatter(skill, '9.8.7'), []);
});

test('npm run sync and --check work from the command line', () => {
  const check = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'sync-integrations.js'), '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /integrations\/hermes is up to date/);
});
