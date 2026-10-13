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
