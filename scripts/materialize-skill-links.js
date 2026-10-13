'use strict';

/**
 * npm does not pack symlink directories. Replace the skill mount with a real
 * tree before `npm pack` / `npm publish`, then restore the symlink afterwards.
 * Re-entrant: a second materialize is a no-op while the state file exists
 * (prepack can run twice). plugins/rdap-q/skills/rdap-q is not a link: it is
 * a committed copy (scripts/sync-integrations.js), because plugin installers
 * do not follow links out of the plugin directory.
 */

const fs = require('fs');
const path = require('path');
const { copyTreeSafe } = require('../lib/installer');

const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, '.rdapq-pack-state.json');
const LINKS = [
  '.agents/skills/rdap-q',
];

function assertInsideRepo(resolved) {
  const rel = path.relative(ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing to materialize a link outside the repo: ${resolved}`);
  }
}

function materialize() {
  if (fs.existsSync(STATE)) return;
  const state = [];
  fs.writeFileSync(STATE, '[]\n');
  try {
    for (const rel of LINKS) {
      const abs = path.join(ROOT, rel);
      const st = fs.lstatSync(abs);
      if (!st.isSymbolicLink()) {
        throw new Error(`${rel} is not a symlink; refusing to pack an unexpected tree`);
      }
      const target = fs.readlinkSync(abs);
      const resolved = path.resolve(path.dirname(abs), target);
      assertInsideRepo(resolved);
      if (!fs.existsSync(path.join(resolved, 'SKILL.md'))) {
        throw new Error(`symlink ${rel} does not point at a skill tree`);
      }
      fs.unlinkSync(abs);
      copyTreeSafe(resolved, abs, resolved);
      state.push({ rel, target });
      fs.writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
    }
  } catch (err) {
    restore();
    throw err;
  }
}

function restore() {
  if (!fs.existsSync(STATE)) return;
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  for (const entry of state) {
    const abs = path.join(ROOT, entry.rel);
    fs.rmSync(abs, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.symlinkSync(entry.target, abs);
  }
  fs.unlinkSync(STATE);
}

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'materialize') materialize();
    else if (cmd === 'restore') restore();
    else {
      process.stderr.write('usage: node scripts/materialize-skill-links.js materialize|restore\n');
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { LINKS, STATE, materialize, restore };
