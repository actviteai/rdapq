'use strict';

/**
 * Generate integrations/hermes/, the Hermes Agent skill that installs from a
 * URL without the Node installer:
 *
 *   hermes skills install https://raw.githubusercontent.com/coldcanuk/rdapq/main/integrations/hermes/SKILL.md
 *
 * A URL install fetches SKILL.md, then only the files it names under
 * scripts/, references/, templates/, assets/, or examples/. Raw GitHub URLs
 * do not follow symlinks, so these are committed copies, not links:
 *
 *   SKILL.md             rdap-q-skill/SKILL.md with the Hermes frontmatter (lib/hermes.js)
 *   scripts/rdapq.js     rdap-q-skill/tool/rdapq.js
 *   references/*.md      rdap-q-skill/playbooks/*.md
 *
 *   node scripts/sync-integrations.js          rewrite the copies
 *   node scripts/sync-integrations.js --check  exit 1 if a copy is stale
 */

const fs = require('fs');
const path = require('path');
const hermes = require('../lib/hermes');

const ROOT = path.resolve(__dirname, '..');
const OUT = 'integrations/hermes';

function expected(root = ROOT) {
  const skill = path.join(root, 'rdap-q-skill');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = new Map();
  files.set('SKILL.md', hermes.renderHub(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), version));
  files.set('scripts/rdapq.js', fs.readFileSync(path.join(skill, 'tool', 'rdapq.js'), 'utf8'));
  for (const name of fs.readdirSync(path.join(skill, 'playbooks')).sort()) {
    files.set(`references/${name}`, fs.readFileSync(path.join(skill, 'playbooks', name), 'utf8'));
  }
  return files;
}

function listFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

const lf = (text) => text.replace(/\r\n/g, '\n');

/** Stale, missing, and unexpected files under integrations/hermes/. */
function drift(root = ROOT) {
  const want = expected(root);
  const dir = path.join(root, OUT);
  const problems = [];
  for (const [rel, text] of want) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) problems.push(`${OUT}/${rel} is missing`);
    else if (fs.lstatSync(file).isSymbolicLink()) problems.push(`${OUT}/${rel} is a symlink; raw GitHub URLs do not follow it`);
    else if (lf(fs.readFileSync(file, 'utf8')) !== lf(text)) problems.push(`${OUT}/${rel} is stale`);
  }
  for (const rel of listFiles(dir)) {
    if (!want.has(rel)) problems.push(`${OUT}/${rel} is not generated; remove it or add it to scripts/sync-integrations.js`);
  }
  return problems;
}

function write(root = ROOT) {
  const dir = path.join(root, OUT);
  const want = expected(root);
  for (const rel of listFiles(dir)) {
    if (!want.has(rel)) fs.rmSync(path.join(dir, rel));
  }
  for (const [rel, text] of want) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  }
  return [...want.keys()];
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const problems = drift();
    if (problems.length) {
      process.stderr.write(`${problems.join('\n')}\nrun: node scripts/sync-integrations.js\n`);
      process.exit(1);
    }
    process.stdout.write(`${OUT} is up to date\n`);
  } else {
    process.stdout.write(`wrote ${write().map((rel) => `${OUT}/${rel}`).join(', ')}\n`);
  }
}

module.exports = { OUT, drift, expected, write };
