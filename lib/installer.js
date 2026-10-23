'use strict';

/**
 * RDAP-Q installer — single implementation used by the CLI and the
 * shell / PowerShell wrappers. Skill trees are staged and renamed into
 * place. Personal harness files are never replaced unless --force is set.
 */

const fs = require('fs');
const path = require('path');
const hermes = require('./hermes');

const HARNESS_IDS = ['antigravity', 'claude', 'cline', 'copilot', 'codex', 'grok', 'goose', 'cursor', 'hermes', 'nemo'];
// Framework integrations, not chat harnesses: install --nemo writes only the
// core and prints the pip and workflow setup. It never changes a Python
// environment, and --all leaves it out.
const FRAMEWORKS = new Set(['nemo']);
const COMMANDS = new Set(['install', 'init', 'status']);
// Task commands are handled by the engine that ships inside the skill tree.
const ENGINE_COMMANDS = new Set(['start', 'plan', 'check', 'gate', 'claim', 'note', 'state', 'memory', 'export', 'hook-stop']);
const STOP_HOOK = {
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.agents/skills/rdap-q/tool/rdapq.js" hook-stop' }] }],
  },
};

function say(stream, message) {
  const text = String(message);
  stream(text.endsWith('\n') ? text : `${text}\n`);
}

function exists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function readVersion(pkgRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error('package.json is missing a version');
  }
  return pkg.version;
}

/** Hermes' default home: ~/.hermes, or %LOCALAPPDATA%\\hermes on Windows. */
function hermesHome(env, home, platform) {
  if (env.HERMES_HOME) return env.HERMES_HOME;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'hermes');
  return path.join(home, '.hermes');
}

function resolveLayout(env, platform = process.platform) {
  const home = env.HOME || env.USERPROFILE || require('os').homedir();
  return {
    rdapq: env.RDAPQ_HOME || path.join(home, '.rdapq'),
    gemini: env.GEMINI_HOME || path.join(home, '.gemini'),
    goose: env.GOOSE_HOME || path.join(home, '.config', 'goose'),
    claude: env.CLAUDE_HOME || path.join(home, '.claude'),
    cursor: env.CURSOR_HOME || path.join(home, '.cursor'),
    cline: env.CLINE_HOME || path.join(home, '.cline'),
    grok: env.GROK_HOME || path.join(home, '.grok'),
    copilot: env.COPILOT_HOME || path.join(home, '.copilot'),
    agents: env.AGENTS_HOME || path.join(home, '.agents'),
    hermes: hermesHome(env, home, platform),
  };
}

function skillSource(pkgRoot) {
  const src = path.join(pkgRoot, 'rdap-q-skill');
  if (!exists(path.join(src, 'SKILL.md'))) {
    throw new Error(`RDAP-Q skill source is missing (${src}). Install from a full checkout or via npx rdap-q.`);
  }
  return src;
}

/**
 * Copy a file or directory. Symlinks are reproduced, never followed, and
 * rejected when they point outside `root`.
 */
function copyTreeSafe(src, dest, root) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    const link = fs.readlinkSync(src);
    const resolved = path.resolve(path.dirname(src), link);
    const rel = path.relative(root, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`refusing outbound symlink ${src} -> ${link}`);
    }
    if (!exists(resolved)) {
      throw new Error(`refusing dangling symlink ${src} -> ${link}`);
    }
    fs.symlinkSync(link, dest);
    return;
  }
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyTreeSafe(path.join(src, name), path.join(dest, name), root);
    }
    return;
  }
  if (st.isFile()) {
    fs.copyFileSync(src, dest);
    return;
  }
  throw new Error(`unsupported filesystem entry: ${src}`);
}

/**
 * Publish `src` to `dest` by copying into a sibling staging directory and
 * renaming. The previous tree is removed only after the staged copy verifies.
 * `renderSkill` may rewrite the staged SKILL.md before the swap.
 */
function publishTree(src, dest, { renderSkill } = {}) {
  if (!exists(src)) {
    throw new Error(`source tree does not exist: ${src}`);
  }
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const staging = path.join(parent, `.${path.basename(dest)}.staging-${token}`);
  const backup = path.join(parent, `.${path.basename(dest)}.backup-${token}`);
  fs.rmSync(staging, { recursive: true, force: true });
  let movedAside = false;
  try {
    copyTreeSafe(src, staging, src);
    const skillMd = path.join(staging, 'SKILL.md');
    if (!exists(skillMd)) {
      throw new Error(`staged copy is missing SKILL.md; left ${dest} untouched`);
    }
    if (renderSkill) {
      assertRegularFile(skillMd, skillMd);
      fs.writeFileSync(skillMd, renderSkill(fs.readFileSync(skillMd, 'utf8')));
    }
    if (exists(dest)) {
      fs.renameSync(dest, backup);
      movedAside = true;
    }
    fs.renameSync(staging, dest);
    if (movedAside) fs.rmSync(backup, { recursive: true, force: true });
  } catch (err) {
    if (exists(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (movedAside && !exists(dest) && exists(backup)) {
      fs.renameSync(backup, dest);
    }
    throw err;
  }
}

function assertRegularFile(target, label) {
  if (!exists(target)) return;
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink()) {
    throw new Error(`refusing to follow symlink ${label || target}`);
  }
  if (!st.isFile()) {
    throw new Error(`refusing to replace non-file ${label || target}`);
  }
}

/**
 * Write a harness bridge. Existing different content is kept unless `force`.
 * A skipped write leaves the packaged bytes at `dest.rdapq`. A forced
 * replacement keeps the previous bytes at `dest.rdapq-backup`. `render`
 * may rewrite the packaged bytes before they are compared or written.
 */
function placeConfigFile(src, dest, { force, render, content }) {
  let raw;
  if (content !== undefined) {
    raw = Buffer.from(content, 'utf8');
  } else {
    if (!exists(src)) {
      throw new Error(`missing packaged file: ${src}`);
    }
    assertRegularFile(src, src);
    raw = fs.readFileSync(src);
  }
  const packaged = render ? Buffer.from(render(raw.toString('utf8')), 'utf8') : raw;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!exists(dest)) {
    fs.writeFileSync(dest, packaged);
    return { action: 'created', dest };
  }
  assertRegularFile(dest, dest);
  const current = fs.readFileSync(dest);
  if (current.equals(packaged)) {
    return { action: 'unchanged', dest };
  }
  if (!force) {
    const sidecar = `${dest}.rdapq`;
    assertRegularFile(sidecar, sidecar);
    fs.writeFileSync(sidecar, packaged);
    return { action: 'kept', dest, sidecar };
  }
  const backup = `${dest}.rdapq-backup`;
  assertRegularFile(backup, backup);
  fs.writeFileSync(backup, current);
  fs.writeFileSync(dest, packaged);
  return { action: 'replaced', dest, backup };
}

/**
 * A global bridge is read outside any repository, where the packaged
 * repo-relative fallback does not exist. Point it at the installed core.
 */
function globalBridge(layout) {
  const skill = path.join(layout.rdapq, 'skills', 'rdap-q', 'SKILL.md');
  return (text) => text.replace(/^Fallback: .*$/m, `Fallback: \`${skill}\``);
}

/**
 * Merge the RDAP-Q Stop hook into .claude/settings.json. Other settings and
 * hooks are kept; the previous file is saved as settings.json.rdapq-backup.
 * A file that is not valid JSON is left alone and gets a sidecar instead.
 */
function addStopHook(dest, force) {
  const fresh = `${JSON.stringify(STOP_HOOK, null, 2)}\n`;
  if (!exists(dest)) return placeConfigFile(null, dest, { force, content: fresh });
  assertRegularFile(dest, dest);
  const current = fs.readFileSync(dest, 'utf8');
  let settings;
  try {
    settings = JSON.parse(current);
  } catch {
    return placeConfigFile(null, dest, { force, content: fresh });
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return placeConfigFile(null, dest, { force, content: fresh });
  }
  const ours = STOP_HOOK.hooks.Stop[0].hooks[0].command;
  const stop = (settings.hooks && Array.isArray(settings.hooks.Stop)) ? settings.hooks.Stop : [];
  if (stop.some((entry) => (entry.hooks || []).some((h) => h.command === ours))) {
    return { action: 'unchanged', dest };
  }
  const backup = `${dest}.rdapq-backup`;
  assertRegularFile(backup, backup);
  fs.writeFileSync(backup, current);
  settings.hooks = { ...(settings.hooks || {}), Stop: [...stop, STOP_HOOK.hooks.Stop[0]] };
  fs.writeFileSync(dest, `${JSON.stringify(settings, null, 2)}\n`);
  return { action: 'merged', dest, backup };
}

function describePlace(result) {
  if (result.action === 'merged') return `    ✓ added the RDAP-Q Stop hook to ${result.dest} (backup: ${result.backup})`;
  if (result.action === 'created') return `    ✓ created ${result.dest}`;
  if (result.action === 'unchanged') return `    = unchanged ${result.dest}`;
  if (result.action === 'kept') {
    return `    ! kept existing ${result.dest} (pass --force to replace). Proposed copy: ${result.sidecar}`;
  }
  return `    ✓ replaced ${result.dest} (backup: ${result.backup})`;
}

function harnessFiles(id, layout, pkgRoot) {
  switch (id) {
    case 'claude':
      return [[path.join(pkgRoot, 'bridges', 'claude', 'commands', 'rdapq.md'), path.join(layout.claude, 'commands', 'rdapq.md')]];
    case 'cline':
      return [[path.join(pkgRoot, '.clinerules'), path.join(layout.cline, 'rules', 'rdapq.md')]];
    case 'goose':
      return [[path.join(pkgRoot, '.goosehints'), path.join(layout.goose, '.goosehints')]];
    // These load the skill tree on demand. An always-on global rule would
    // enter every session in every project.
    case 'codex':
    case 'copilot':
    case 'grok':
    case 'cursor':
    case 'antigravity':
    // Hermes registers /rdap-q from the skill's name; it needs no bridge.
    case 'hermes':
    // NeMo Agent Toolkit loads tools from a pip package, not from files.
    case 'nemo':
      return [];
    default:
      return [];
  }
}

function harnessLabel(id) {
  return {
    antigravity: 'Google Antigravity',
    claude: 'Anthropic Claude / Claude Code',
    cline: 'Cline / Roo Code',
    copilot: 'GitHub Copilot',
    codex: 'OpenAI Codex',
    grok: 'xAI Grok',
    goose: 'Block Goose',
    cursor: 'Cursor',
    hermes: 'Nous Research Hermes Agent',
    nemo: 'NVIDIA NeMo Agent Toolkit',
  }[id];
}

function harnessTreeDests(id, layout) {
  if (id === 'antigravity') {
    return [
      path.join(layout.gemini, 'antigravity-cli', 'skills', 'rdap-q'),
      path.join(layout.gemini, 'config', 'skills', 'rdap-q'),
    ];
  }
  if (id === 'goose') return [];
  if (id === 'cursor') return [path.join(layout.cursor, 'skills', 'rdap-q')];
  if (id === 'grok') return [path.join(layout.grok, 'skills', 'rdap-q')];
  if (id === 'claude') return [path.join(layout.claude, 'skills', 'rdap-q')];
  if (id === 'copilot') return [path.join(layout.copilot, 'skills', 'rdap-q')];
  if (id === 'codex') return [path.join(layout.agents, 'skills', 'rdap-q')];
  if (id === 'hermes') return [path.join(layout.hermes, 'skills', hermes.CATEGORY, hermes.NAME)];
  return [];
}

/** H3: Hermes gets its own frontmatter; every other harness gets SKILL.md as packaged. */
function skillRender(id, version) {
  if (id === 'hermes') return (text) => hermes.renderInstalled(text, version);
  return undefined;
}

const REPO_BRIDGES = [
  ['AGENTS.md', 'AGENTS.md'],
  ['CLAUDE.md', 'CLAUDE.md'],
  ['GEMINI.md', 'GEMINI.md'],
  ['.clinerules', path.join('.clinerules', 'rdapq.md')],
  ['.goosehints', '.goosehints'],
  [path.join('bridges', 'grok', 'rules.md'), path.join('.grok', 'rules.md')],
  [path.join('.github', 'copilot-instructions.md'), path.join('.github', 'copilot-instructions.md')],
  [path.join('bridges', 'claude', 'commands', 'rdapq.md'), path.join('.claude', 'commands', 'rdapq.md')],
];

function statusRows(layout) {
  return [
    ['Core Protocol ($RDAPQ_HOME)', path.join(layout.rdapq, 'skills', 'rdap-q', 'SKILL.md')],
    ['Google Antigravity', path.join(layout.gemini, 'antigravity-cli', 'skills', 'rdap-q', 'SKILL.md')],
    ['Anthropic Claude Code', path.join(layout.claude, 'skills', 'rdap-q', 'SKILL.md')],
    ['Cline / Roo Code', path.join(layout.cline, 'rules', 'rdapq.md')],
    ['GitHub Copilot', path.join(layout.copilot, 'skills', 'rdap-q', 'SKILL.md')],
    ['OpenAI Codex', path.join(layout.agents, 'skills', 'rdap-q', 'SKILL.md')],
    ['xAI Grok', path.join(layout.grok, 'skills', 'rdap-q', 'SKILL.md')],
    ['Block Goose', path.join(layout.goose, '.goosehints')],
    ['Cursor', path.join(layout.cursor, 'skills', 'rdap-q', 'SKILL.md')],
    ['Nous Research Hermes Agent', path.join(layout.hermes, 'skills', hermes.CATEGORY, hermes.NAME, 'SKILL.md')],
  ];
}

function parseArgs(argv) {
  const flags = {
    help: false,
    force: false,
    quiet: false,
    all: false,
    globalOnly: false,
    hook: false,
    repo: null,
    command: null,
    harnesses: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--force') {
      flags.force = true;
    } else if (arg === '--quiet') {
      flags.quiet = true;
    } else if (arg === '--all') {
      flags.all = true;
    } else if (arg === '--global-only') {
      flags.globalOnly = true;
    } else if (arg === '--hook') {
      flags.hook = true;
    } else if (arg === '--repo') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('--repo requires a directory path');
      i += 1;
      flags.repo = value;
    } else if (arg.startsWith('--') && HARNESS_IDS.includes(arg.slice(2))) {
      const id = arg.slice(2);
      if (!flags.harnesses.includes(id)) flags.harnesses.push(id);
    } else if (COMMANDS.has(arg)) {
      if (flags.command) throw new Error(`multiple commands: ${flags.command} and ${arg}`);
      flags.command = arg;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return flags;
}

function helpText(version) {
  return `Usage: rdapq [COMMAND] [OPTIONS]
       npx rdap-q [COMMAND] [OPTIONS]

Research-Driven Adaptive Planning with Quality Gates (v${version})

Commands:
  install          Install the core skill and harness bridges (default)
  init             Write workspace bridges into the current repository
  status           Show install status for every harness

Task commands (run inside a repository; see SKILL.md):
  start, plan, check, gate, claim, note, state, memory, export, hook-stop
  e.g. rdapq start --risk LOW --files src/a.js --run "npm test"; rdapq check; rdapq gate

Options:
  --all            Install every chat harness (default when none are named)
  --antigravity    Install for Google Antigravity
  --claude         Install for Anthropic Claude / Claude Code
  --cline          Install for Cline / Roo Code
  --copilot        Install for GitHub Copilot
  --codex          Install for OpenAI Codex
  --grok           Install for xAI Grok
  --goose          Install for Block Goose
  --cursor         Install for Cursor
  --hermes         Install for Nous Research Hermes Agent
  --nemo           NVIDIA NeMo Agent Toolkit: install the core engine and print
                   the pip and workflow setup (no Python environment is changed)
  --repo PATH      Write workspace bridges into PATH
  --hook           With init: add the Claude Code Stop hook to .claude/settings.json
  --global-only    Install only ~/.rdapq (or $RDAPQ_HOME)
  --force          Replace existing harness files (keeps a .rdapq-backup)
  --quiet          Suppress the banner and per-file chatter
  --help, -h       Show this help message

There is no separate update command. Run install again with the same flags.
Skill trees are replaced after the new copy verifies. Edited harness files
are kept unless you pass --force.

Examples:
  npx rdap-q install --claude
  npx rdap-q install --cursor
  npx rdap-q install --hermes
  npx rdap-q@${version} install --all
  rdapq init
  rdapq init --force
  rdapq status
`;
}

function banner(version) {
  return `
  ____  ____    _    ____         ___
 |  _ \\|  _ \\  / \\  |  _ \\       / _ \\
 | |_) | | | |/ _ \\ | |_) |_____| | | |
 |  _ <| |_| / ___ \\|  __/|_____| |_| |
 |_| \\_\\____/_/   \\_\\_|          \\__\\_\\

 Research-Driven Adaptive Planning with Quality Gates (v${version})
`;
}

function installCore(pkgRoot, layout, log) {
  const src = skillSource(pkgRoot);
  log(`==> Setting up RDAP-Q core at: ${layout.rdapq}`);
  for (const sub of ['memory', 'projects', 'registry']) {
    fs.mkdirSync(path.join(layout.rdapq, sub), { recursive: true });
  }
  const dest = path.join(layout.rdapq, 'skills', 'rdap-q');
  publishTree(src, dest);
  log(`    ✓ Core skill installed to ${dest}`);
}

function installHarness(id, pkgRoot, layout, force, log) {
  log(`==> Configuring for ${harnessLabel(id)}...`);
  const renderSkill = skillRender(id, readVersion(pkgRoot));
  for (const treeDest of harnessTreeDests(id, layout)) {
    publishTree(skillSource(pkgRoot), treeDest, { renderSkill });
    log(`    ✓ skill tree installed to ${treeDest}`);
  }
  for (const [fromRel, dest] of harnessFiles(id, layout, pkgRoot)) {
    const from = path.isAbsolute(fromRel) ? fromRel : path.join(pkgRoot, fromRel);
    log(describePlace(placeConfigFile(from, dest, { force, render: globalBridge(layout) })));
  }
  if (id === 'hermes') {
    log('    i Hermes registers the skill as /rdap-q. To make /rdapq work too, add an alias:');
    log('        hermes config set quick_commands.rdapq.type alias');
    log('        hermes config set quick_commands.rdapq.target /rdap-q');
  }
  if (id === 'nemo') {
    for (const line of nemoGuidance(layout)) log(line);
  }
}

const NEMO_DOCS = 'https://github.com/actviteai/rdapq/tree/main/integrations/nemo';

/**
 * NeMo Agent Toolkit is a Python framework, not a chat harness: there is no
 * skills directory to write. The tools come from the rdapq-nat pip package,
 * which runs the engine installed in the core. PEP 668 environments refuse
 * an unasked pip install, so print the steps instead of running them.
 */
function nemoGuidance(layout) {
  const engine = path.join(layout.rdapq, 'skills', 'rdap-q', 'tool', 'rdapq.js');
  return [
    `    ✓ engine for the rdapq function group: ${engine}`,
    '    i NeMo Agent Toolkit loads RDAP-Q as a pip package. In the Python environment that runs `nat`:',
    '        git clone https://github.com/actviteai/rdapq.git',
    '        pip install "./rdapq/integrations/nemo[agents]"',
    '    i Then add the tools to your workflow YAML and use integrations/nemo/instructions.md as the system prompt:',
    '        function_groups:',
    '          rdapq: {_type: rdapq, repo_dir: /path/to/repo}',
    '        workflow:',
    '          tool_names: [rdapq]',
    `    i Full example: integrations/nemo/examples/workflow.yaml (${NEMO_DOCS})`,
  ];
}

/**
 * Best effort: can the Python on PATH import rdapq_nat? NeMo installs into a
 * virtual environment, so "not detected" may only mean a different Python.
 */
function nemoDetected(env) {
  const { spawnSync } = require('child_process');
  for (const python of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const probe = spawnSync(python, ['-c', 'import rdapq_nat'], { env, stdio: 'ignore', timeout: 15000, windowsHide: true });
    if (probe.error) continue; // not on PATH: try the next name
    return { python, found: probe.status === 0 };
  }
  return { python: null, found: false };
}

function installRepo(pkgRoot, repoArg, cwd, force, log, hook) {
  const abs = path.resolve(cwd, repoArg);
  if (!exists(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`directory does not exist: ${abs}`);
  }
  log(`==> Installing RDAP-Q workspace configuration into: ${abs}`);
  fs.mkdirSync(path.join(abs, '.rdapq'), { recursive: true });
  for (const [relSrc, relDest] of REPO_BRIDGES) {
    log(describePlace(placeConfigFile(path.join(pkgRoot, relSrc), path.join(abs, relDest), { force })));
  }
  const skillDest = path.join(abs, '.agents', 'skills', 'rdap-q');
  publishTree(skillSource(pkgRoot), skillDest);
  log(`    ✓ skill tree installed to ${skillDest}`);
  const claudeSkill = path.join(abs, '.claude', 'skills', 'rdap-q');
  publishTree(skillSource(pkgRoot), claudeSkill);
  log(`    ✓ skill tree installed to ${claudeSkill}`);
  if (hook) log(describePlace(addStopHook(path.join(abs, '.claude', 'settings.json'), force)));
  log('    ✓ Workspace bridges processed for Codex, Grok, Copilot, Antigravity, Goose, Claude, and Cline.');
}

function printStatus(layout, log, env) {
  log('==> Inspecting RDAP-Q Multi-Harness Status:');
  for (const [name, target] of statusRows(layout)) {
    let installed = false;
    try {
      installed = fs.lstatSync(target).isFile();
    } catch {
      installed = false;
    }
    const icon = installed ? '✓' : '✗';
    const detail = installed ? `Installed (${target})` : 'Not installed';
    log(`  [${icon}] ${name.padEnd(28)}: ${detail}`);
  }
  const nemo = nemoDetected(env);
  let detail = 'Not detected (no python3 or python on PATH)';
  if (nemo.found) detail = `Installed (${nemo.python} can import rdapq_nat)`;
  else if (nemo.python) detail = `Not detected in ${nemo.python}; a virtual environment may have it (pip install ./integrations/nemo)`;
  log(`  [${nemo.found ? '✓' : '✗'}] ${harnessLabel('nemo').padEnd(28)}: ${detail}`);
}

function selectedHarnesses(flags) {
  if (flags.globalOnly) return [];
  if (flags.all || flags.harnesses.length === 0) {
    // --all means every chat harness; a framework named next to it still counts.
    const named = flags.harnesses.filter((id) => FRAMEWORKS.has(id));
    return [...HARNESS_IDS.filter((id) => !FRAMEWORKS.has(id)), ...named];
  }
  return flags.harnesses.slice();
}

function normalizeArgv(argv, invokedAs) {
  const args = argv.slice();
  const name = String(invokedAs || '').replace(/\.js$/, '');
  const known = new Set(['install', 'init', 'status', '--help', '-h']);
  if (name === 'rdapq-install' && !args.some((arg) => known.has(arg))) {
    args.unshift('install');
  }
  return args;
}

function runCli(argv, options = {}) {
  const pkgRoot = options.pkgRoot || path.resolve(__dirname, '..');
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const stdout = options.stdout || ((line) => process.stdout.write(line));
  const stderr = options.stderr || ((line) => process.stderr.write(line));
  const log = (message) => say(stdout, message);
  const error = (message) => say(stderr, message);
  const started = Date.now();

  if (ENGINE_COMMANDS.has(argv[0])) {
    const engine = require(path.join(skillSource(pkgRoot), 'tool', 'rdapq.js'));
    let stdin = options.stdin !== undefined ? options.stdin : '';
    if (options.stdin === undefined && argv[0] === 'hook-stop') {
      try {
        stdin = fs.readFileSync(0, 'utf8');
      } catch {
        stdin = '';
      }
    }
    return engine.main(argv, {
      cwd,
      env,
      stdin,
      out: (line) => stdout(`${line}\n`),
      err: (line) => stderr(`${line}\n`),
    });
  }

  try {
    const version = readVersion(pkgRoot);
    const flags = parseArgs(normalizeArgv(argv, options.invokedAs));
    if (flags.help) {
      if (!flags.quiet) log(banner(version).replace(/^\n/, ''));
      log(helpText(version).replace(/\n$/, ''));
      return 0;
    }
    if (!flags.quiet) log(banner(version).replace(/^\n/, ''));

    const repoMode = Boolean(flags.repo) || flags.command === 'init';
    const harnessMode = flags.all || flags.globalOnly || flags.harnesses.length > 0;
    if (repoMode && harnessMode) {
      throw new Error('init/--repo only writes workspace bridges. Run a separate install command for global harnesses.');
    }
    if (flags.hook && !repoMode) {
      throw new Error('--hook only applies to init / --repo');
    }
    if (flags.globalOnly && (flags.all || flags.harnesses.length > 0)) {
      throw new Error('--global-only cannot be combined with harness selectors or --all');
    }
    if (flags.command === 'status' && (repoMode || harnessMode || flags.force)) {
      throw new Error('status does not take install selectors');
    }

    const layout = resolveLayout(env);

    if (flags.command === 'status') {
      printStatus(layout, log, env);
    } else if (repoMode) {
      installRepo(pkgRoot, flags.repo || cwd, cwd, flags.force, flags.quiet ? () => {} : log, flags.hook);
    } else {
      installCore(pkgRoot, layout, flags.quiet ? () => {} : log);
      for (const id of selectedHarnesses(flags)) {
        installHarness(id, pkgRoot, layout, flags.force, flags.quiet ? () => {} : log);
      }
      if (!flags.quiet) {
        const harnesses = selectedHarnesses(flags);
        const frameworksOnly = harnesses.length > 0 && harnesses.every((id) => FRAMEWORKS.has(id));
        log(frameworksOnly
          ? '\n==> Installation complete. Add the rdapq function group to your workflow as shown above.'
          : "\n==> Installation complete. Invoke '/rdapq <task>' in your AI harness.");
      }
    }

    if (!flags.quiet) log(`==> Done in ${Date.now() - started}ms`);
    return 0;
  } catch (err) {
    error(`error: ${err.message}`);
    return 1;
  }
}

module.exports = {
  FRAMEWORKS,
  HARNESS_IDS,
  REPO_BRIDGES,
  copyTreeSafe,
  harnessFiles,
  harnessTreeDests,
  parseArgs,
  placeConfigFile,
  publishTree,
  readVersion,
  resolveLayout,
  runCli,
  statusRows,
};
