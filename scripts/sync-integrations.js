'use strict';

/**
 * Generated copies of rdap-q-skill/ for readers that do not follow symlinks.
 * Each copy is committed, and `npm test` fails when one drifts.
 *
 * integrations/hermes/  The Hermes Agent skill that installs from a URL
 *   without the Node installer:
 *
 *     hermes skills install https://raw.githubusercontent.com/actviteai/rdapq/main/integrations/hermes/SKILL.md
 *
 *   A URL install fetches SKILL.md, then only the files it names under
 *   scripts/, references/, templates/, assets/, or examples/. Raw GitHub URLs
 *   do not follow symlinks, so these are copies, not links:
 *
 *     SKILL.md             rdap-q-skill/SKILL.md with the Hermes frontmatter (lib/hermes.js)
 *     scripts/rdapq.js     rdap-q-skill/tool/rdapq.js
 *     references/*.md      rdap-q-skill/playbooks/*.md
 *
 * plugins/rdap-q/skills/rdap-q/  The skill inside the marketplace plugin
 *   (.claude-plugin/marketplace.json points at ./plugins/rdap-q). Codex and
 *   Grok copy the plugin directory and drop a symlink that leaves it, so this
 *   is every file of rdap-q-skill/, byte for byte, executable bits included.
 *
 * bridges/project.md -> AGENTS.md, CLAUDE.md, GEMINI.md, the Cline, Goose,
 *   Grok, and Copilot bridges. Seven files that say the same thing, written once.
 *
 * integrations/nemo/instructions.md -> the system_prompt block of
 *   integrations/nemo/examples/workflow.yaml. NeMo wants YAML; the prose is
 *   written once and rendered into it.
 *
 *   node scripts/sync-integrations.js          rewrite the copies
 *   node scripts/sync-integrations.js --check  exit 1 if a copy is stale
 */

const fs = require('fs');
const path = require('path');
const hermes = require('../lib/hermes');
const { BRIDGES, BRIDGE_TEMPLATE } = require('./version-targets');

const ROOT = path.resolve(__dirname, '..');
const OUT = 'integrations/hermes';
const PLUGIN_OUT = 'plugins/rdap-q/skills/rdap-q';
const POSIX = process.platform !== 'win32';
// Editor and OS litter that must never become part of a copy.
const JUNK = /^(\.DS_Store|Thumbs\.db|[Dd]esktop\.ini|__pycache__|.*\.py[cod])$/;

/** integrations/hermes/: relative path -> text. */
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
    if (JUNK.test(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

const isExec = (file) => (fs.statSync(file).mode & 0o111) !== 0;

/** plugins/rdap-q/skills/rdap-q/: relative path -> { text, exec }, from every file of rdap-q-skill/. */
function pluginFiles(root = ROOT) {
  const skill = path.join(root, 'rdap-q-skill');
  const files = new Map();
  for (const rel of listFiles(skill)) {
    const src = path.join(skill, rel);
    files.set(rel, { text: fs.readFileSync(src, 'utf8'), exec: isExec(src) });
  }
  return files;
}

const WORKFLOW = 'integrations/nemo/examples/workflow.yaml';
const INSTRUCTIONS = 'integrations/nemo/instructions.md';

/** workflow.yaml with its system_prompt block rendered from instructions.md. */
function renderWorkflow(root = ROOT) {
  const yaml = fs.readFileSync(path.join(root, WORKFLOW), 'utf8');
  const prose = fs.readFileSync(path.join(root, INSTRUCTIONS), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const block = prose.split('\n').map((line) => (line ? `    ${line}` : '')).join('\n');
  const match = /^( {2}system_prompt: \|\n)((?: {4}.*\n|\n)+)/m.exec(yaml);
  if (!match) throw new Error(`${WORKFLOW}: no "  system_prompt: |" block to render instructions.md into`);
  return `${yaml.slice(0, match.index)}${match[1]}${block}\n${yaml.slice(match.index + match[0].length)}`;
}

/** Files generated in place at the repository root: no directory is swept. */
function rootFiles(root = ROOT) {
  const files = new Map();
  const bridge = fs.readFileSync(path.join(root, BRIDGE_TEMPLATE), 'utf8');
  for (const rel of BRIDGES) files.set(rel, { text: bridge, exec: false });
  files.set(WORKFLOW, { text: renderWorkflow(root), exec: false });
  return files;
}

function targets(root = ROOT) {
  return [
    { out: OUT, why: 'raw GitHub URLs do not follow it', modes: false, files: new Map([...expected(root)].map(([rel, text]) => [rel, { text, exec: false }])) },
    { out: PLUGIN_OUT, why: 'Codex and Grok do not copy it', modes: true, files: pluginFiles(root) },
    { out: '', why: 'they are rendered from one source', modes: false, sweep: false, files: rootFiles(root) },
  ];
}

function isLink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

const lf = (text) => text.replace(/\r\n/g, '\n');

/** Stale, missing, unexpected, and symlinked files in every generated copy. */
function drift(root = ROOT) {
  const problems = [];
  for (const target of targets(root)) {
    const dir = path.join(root, target.out);
    if (target.out && isLink(dir)) {
      problems.push(`${target.out} is a symlink; ${target.why}`);
      continue;
    }
    const name = (rel) => (target.out ? `${target.out}/${rel}` : rel);
    for (const [rel, want] of target.files) {
      const file = path.join(dir, rel);
      if (!fs.existsSync(file)) problems.push(`${name(rel)} is missing`);
      else if (isLink(file)) problems.push(`${name(rel)} is a symlink; ${target.why}`);
      else if (lf(fs.readFileSync(file, 'utf8')) !== lf(want.text)) problems.push(`${name(rel)} is stale`);
      else if (target.modes && POSIX && isExec(file) !== want.exec) problems.push(`${name(rel)} ${want.exec ? 'must' : 'must not'} be executable`);
    }
    if (target.sweep === false) continue;
    for (const rel of listFiles(dir)) {
      if (!target.files.has(rel)) problems.push(`${target.out}/${rel} is not generated; remove it or add it to scripts/sync-integrations.js`);
    }
  }
  return problems;
}

/** Rewrite every generated copy. Returns [{ out, count }]. */
function write(root = ROOT) {
  const done = [];
  for (const target of targets(root)) {
    const dir = path.join(root, target.out);
    // A symlinked copy is replaced by real files, never written through.
    if (target.out && isLink(dir)) fs.unlinkSync(dir);
    if (target.sweep !== false) {
      for (const rel of listFiles(dir)) {
        if (!target.files.has(rel)) fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
      }
    }
    for (const [rel, want] of target.files) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (isLink(file)) fs.unlinkSync(file);
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== want.text) fs.writeFileSync(file, want.text);
      if (target.modes && POSIX) fs.chmodSync(file, want.exec ? 0o755 : 0o644);
    }
    done.push({ out: target.out || '<root>', count: target.files.size });
  }
  return done;
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const problems = drift();
    if (problems.length) {
      process.stderr.write(`${problems.join('\n')}\nrun: node scripts/sync-integrations.js\n`);
      process.exit(1);
    }
    for (const target of targets()) process.stdout.write(`${target.out || '<root>'} is up to date\n`);
  } else {
    for (const { out, count } of write()) process.stdout.write(`wrote ${count} file(s) to ${out}\n`);
  }
}

module.exports = { OUT, PLUGIN_OUT, WORKFLOW, drift, expected, pluginFiles, renderWorkflow, rootFiles, targets, write };
