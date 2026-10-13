#!/usr/bin/env node
'use strict';

/**
 * RDAP-Q engine. The model proposes, this tool decides: it runs the checks,
 * computes the oracles, and names the terminal state. Zero dependencies so
 * it runs from any installed skill tree with plain `node`.
 *
 * Task files, relative to the repository root:
 *   .rdapq/oracles.json   what "done" means for this task (written by start/plan)
 *   .rdapq/state.jsonl    append-only log: start, plan, check, claim, note, gate
 *
 * Memory lives under $RDAPQ_HOME (default ~/.rdapq), one record per line.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RISKS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const DEPTHS = ['lean', 'full'];
const REQUIRED = {
  LOW: ['runtime', 'repo'],
  MODERATE: ['runtime', 'repo'],
  HIGH: ['runtime', 'repo', 'repro'],
  CRITICAL: ['runtime', 'repo', 'repro', 'external'],
};
const WEIGHTS = { runtime: 35, repo: 25, external: 15, claims: 15, repro: 10 };
const SCORE = { pass: 10, partial: 5, fail: 0 };
const MAX_ROUNDS = 3;
const NOTE_TYPES = ['assumption', 'decision', 'risk', 'blocker', 'question'];
const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum)$|(^|\/)(dist|build|coverage)\//;
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/;
const FIXTURE = /(^|\/)(fixtures?|__fixtures__|__snapshots__|testdata)\//;
const isTest = (f) => TEST_FILE.test(f) && !FIXTURE.test(f);
// Flags that never take a value, so `claim --external "text"` keeps its text.
const BOOLEAN_FLAGS = ['before', 'json', 'external', 'verified', 'off-path', 'no-defect', 'keep'];
const MEMORY_CAPS = { fact: 240, evidence: 160, global: 80, project: 40, search: 12 };
const MEMORY_CLASSES = ['USER_SPECIFIED', 'OBSERVED', 'VERIFIED_EXTERNAL', 'INFERRED'];
const MEMORY_STATUS = ['ACTIVE', 'STALE', 'SUPERSEDED', 'INVALID'];
const SECRET = /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,})/i;
const EXIT = { COMPLETE: 0, CONTINUE: 3 };

class UsageError extends Error {}

// ---------------------------------------------------------------- utilities

function run(command, cwd, timeoutMs = 10 * 60 * 1000) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, env, maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`;
  return { code: r.status === null ? 124 : r.status, output };
}

function git(root, args) {
  // quotePath=false: non-ASCII names come back as-is instead of "caf\303\251.js".
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

function repoRoot(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  return top ? top.trim() : cwd;
}

function taskPaths(root) {
  const dir = path.join(root, '.rdapq');
  return { dir, oracles: path.join(dir, 'oracles.json'), log: path.join(dir, 'state.jsonl') };
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${file} is not valid JSON; run \`start\` again to rewrite it`);
  }
}

/** A torn line from an interrupted write is skipped, never fatal. */
function readLog(root) {
  const { log } = taskPaths(root);
  if (!fs.existsSync(log)) return [];
  const events = [];
  for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip
    }
  }
  return events;
}

function append(root, event) {
  const { dir, log } = taskPaths(root);
  fs.mkdirSync(dir, { recursive: true });
  const line = { t: new Date().toISOString(), ...event };
  fs.appendFileSync(log, `${JSON.stringify(line)}\n`);
  return line;
}

function list(value) {
  if (value === undefined || value === null || value === true) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Planned paths are compared with git's names: forward slashes, relative to the root. */
function normalizePath(p) {
  const n = path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
  return n === '.' ? '' : n;
}

function specHash(spec) {
  const key = JSON.stringify([spec.risk, spec.run, spec.repro, spec.defect, [...spec.files].sort()]);
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function parseFlags(argv, repeatable = []) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      flags._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    let value = true;
    if (!BOOLEAN_FLAGS.includes(key) && next !== undefined && (repeatable.includes(key) || !next.startsWith('--'))) {
      value = next;
      i += 1;
    }
    if (repeatable.includes(key)) (flags[key] = flags[key] || []).push(value);
    else flags[key] = value;
  }
  return flags;
}

function firstFailureLine(output) {
  const patterns = [
    /^\s*✖\s+(.+?)(?:\s+\([\d.]+m?s\))?\s*$/m, // node --test
    /^\s*not ok \d+ - (.+)$/m, // TAP
    /^FAILED\s+(\S+)/m, // pytest
    /^\s*●\s+(.+)$/m, // jest
    /^--- FAIL: (\S+)/m, // go test
    /^(\w*Error\b.*)$/m,
  ];
  for (const re of patterns) {
    const m = re.exec(output);
    if (m) return m[1].trim().slice(0, 160);
  }
  return null;
}

// ---------------------------------------------------------------- oracles

function changedFiles(root, base) {
  if (!base) return null;
  const diff = git(root, ['diff', '--name-only', base]);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);
  if (diff === null) return null;
  return [...new Set(`${diff}\n${untracked || ''}`.split('\n').filter(Boolean))]
    .filter((f) => !f.startsWith('.rdapq/'))
    .sort();
}

function fingerprint(root, base) {
  const files = changedFiles(root, base) || [];
  const hash = crypto.createHash('sha256');
  for (const f of files) {
    hash.update(f);
    try {
      hash.update(fs.readFileSync(path.join(root, f)));
    } catch {
      hash.update('<deleted>');
    }
  }
  return hash.digest('hex').slice(0, 16);
}

function allTestFiles(root) {
  const tracked = git(root, ['ls-files']) || '';
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']) || '';
  return `${tracked}\n${untracked}`.split('\n').filter((f) => f && isTest(f) && !f.startsWith('.rdapq/'));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * At least one test file changed, or a test file imports a changed source
 * file by its path (JS/TS relative import, or a Python dotted module). Whether
 * the required command executes that test is not observed; the import is the proxy.
 */
function touchesChange(root, changed) {
  const tests = changed.filter(isTest);
  if (tests.length) return { touches: true, via: `changed test ${tests[0]}` };
  const sources = changed.filter((f) => !isTest(f) && /\.[cm]?[jt]sx?$|\.py$/.test(f));
  if (!sources.length) return { touches: false, via: 'no changed source file a test could import' };
  for (const t of allTestFiles(root)) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, t), 'utf8');
    } catch {
      continue;
    }
    for (const src of sources) {
      const noExt = src.replace(/\.[^./]+$/, '');
      let rel = path.posix.relative(path.posix.dirname(t), noExt);
      if (!rel.startsWith('.')) rel = `./${rel}`;
      const js = new RegExp(`(require\\(|import\\b|from\\b)[^\\n]*['"\`]${escapeRe(rel)}(\\.[cm]?[jt]sx?)?(/index(\\.[cm]?[jt]sx?)?)?['"\`]`);
      const dotted = noExt.replace(/\//g, '.').replace(/^src\./, '');
      const py = src.endsWith('.py') && new RegExp(`^\\s*(from\\s+(\\w+\\.)*${escapeRe(dotted.split('.').pop())}\\s+import|import\\s+[\\w.]*${escapeRe(dotted)}\\b|from\\s+[\\w.]*${escapeRe(dotted)}\\s+import)`, 'm');
      if (js.test(text) || (py && py.test(text))) return { touches: true, via: `${t} imports ${src}` };
    }
  }
  return { touches: false, via: 'no test file imports a changed source file' };
}

function runtimeOracle(root, spec, changed) {
  if (!spec.run.length) return { observed: null, detail: 'no required command; pass --run to start' };
  const results = spec.run.map((cmd) => ({ cmd, ...run(cmd, root) }));
  const failed = results.find((r) => r.code !== 0);
  if (failed) {
    const line = firstFailureLine(failed.output);
    return {
      observed: 'fail',
      detail: `${failed.cmd} exited ${failed.code}${line ? `: ${line}` : ''}`,
      oracle_id: `${failed.cmd} :: ${line || `exit ${failed.code}`}`,
      tail: failed.output.trim().split('\n').slice(-15).join('\n'),
    };
  }
  const touch = changed ? touchesChange(root, changed) : { touches: false, via: 'no git base' };
  return touch.touches
    ? { observed: 'pass', detail: `${results.length} command(s) exit 0; ${touch.via}` }
    : { observed: 'partial', detail: `${results.length} command(s) exit 0, but ${touch.via}` };
}

function repoOracle(spec, changed) {
  if (!changed) return { observed: null, detail: 'not a git repository or no base commit' };
  const planned = new Set(spec.files);
  const extras = changed.filter((f) => !planned.has(f));
  const missing = spec.files.filter((f) => !changed.includes(f));
  if (!extras.length && !missing.length) return { observed: 'pass', detail: `diff matches the ${planned.size} planned file(s)` };
  const unplanned = extras.filter((f) => !GENERATED.test(f));
  if (!unplanned.length && !missing.length) return { observed: 'partial', detail: `only generated extras: ${extras.join(', ')}` };
  const gap = [unplanned.length && `unplanned: ${unplanned.join(', ')}`, missing.length && `planned but unchanged: ${missing.join(', ')}`].filter(Boolean).join('; ');
  return { observed: 'fail', detail: `${gap} (amend with plan --add/--drop and --why)`, oracle_id: `repo :: ${gap}` };
}

function reproOracle(root, spec, log) {
  if (!spec.repro) {
    return spec.defect === false
      ? { observed: null, detail: 'no defect in scope (start --no-defect)' }
      : { observed: null, detail: 'no repro command', unjustified: true };
  }
  const before = log.filter((e) => e.kind === 'repro-before').pop();
  const after = run(spec.repro, root);
  if (after.code !== 0) {
    const line = firstFailureLine(after.output);
    return { observed: 'fail', detail: `repro still fails${line ? `: ${line}` : ''}`, oracle_id: `${spec.repro} :: ${line || `exit ${after.code}`}` };
  }
  if (!before) return { observed: 'partial', detail: 'passes now; run check --before first to prove it failed' };
  if (before.sourceChanged) return { observed: 'partial', detail: 'check --before ran after source files were already edited' };
  if (before.code === 0) return { observed: 'partial', detail: 'repro passed before the fix, so it did not reproduce the defect' };
  return { observed: 'pass', detail: 'failed before the fix, passes after' };
}

function claimOracles(log) {
  const claims = log.filter((e) => e.kind === 'claim');
  const external = claims.filter((c) => c.external);
  let ext;
  if (!external.length) ext = { observed: null, detail: 'no external claim recorded' };
  else {
    const unverified = external.filter((c) => !c.verified);
    if (!unverified.length) ext = { observed: 'pass', detail: `${external.length} external claim(s) verified` };
    else if (unverified.every((c) => c.offPath)) ext = { observed: 'partial', detail: `${unverified.length} unverified, all off the changed path` };
    else ext = { observed: 'fail', detail: `unverified on the changed path: ${unverified.filter((c) => !c.offPath).map((c) => c.text).join('; ')}`, oracle_id: `external :: ${unverified.map((c) => c.text).join('; ')}` };
  }
  const verified = claims.filter((c) => c.verified).length;
  const claimsOracle = claims.length
    ? { value: Math.round((10 * verified) / claims.length), detail: `${verified}/${claims.length} material claims verified` }
    : { observed: null, detail: 'no claims recorded' };
  return { external: ext, claims: claimsOracle };
}

function numeric(o) {
  if (typeof o.value === 'number') return o.value;
  return o.observed ? SCORE[o.observed] : null;
}

function quality(oracles) {
  let num = 0;
  let den = 0;
  for (const [name, o] of Object.entries(oracles)) {
    const v = numeric(o);
    if (v === null) continue;
    num += WEIGHTS[name] * v;
    den += WEIGHTS[name];
  }
  return den ? Math.round((num / den) * 10) / 10 : 'UNMEASURED';
}

// ---------------------------------------------------------------- commands

function requireSpec(root) {
  const spec = readJson(taskPaths(root).oracles);
  if (!spec) throw new UsageError('no .rdapq/oracles.json; run `start` first');
  return spec;
}

function cmdStart(root, argv, out) {
  const f = parseFlags(argv, ['run']);
  const risk = String(f.risk || '').toUpperCase();
  if (!RISKS.includes(risk)) throw new UsageError(`start needs --risk ${RISKS.join('|')}`);
  const depthFile = path.join(taskPaths(root).dir, 'depth');
  const preset = fs.existsSync(depthFile) ? fs.readFileSync(depthFile, 'utf8').trim() : '';
  const depth = f.depth ? String(f.depth) : preset || 'lean';
  if (!DEPTHS.includes(depth)) {
    throw new UsageError(f.depth ? `--depth must be ${DEPTHS.join('|')}` : `.rdapq/depth says "${depth}"; it must be ${DEPTHS.join(' or ')}`);
  }
  const { dir, oracles, log } = taskPaths(root);
  const existing = fs.existsSync(oracles) ? readJson(oracles) : null;
  const head = git(root, ['rev-parse', 'HEAD']);
  // A new task gets a fresh log and base; --keep re-defines the current task instead.
  if (existing && !f.keep && fs.existsSync(log)) {
    const archive = path.join(dir, 'archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(log, path.join(archive, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
    out('previous task log archived to .rdapq/archive/ (pass --keep to amend the current task instead)');
  }
  const spec = {
    version: 2,
    risk,
    depth,
    base: f.keep && existing && existing.base ? existing.base : head ? head.trim() : null,
    files: list(f.files).map(normalizePath).filter(Boolean),
    run: (f.run || []).filter((r) => r !== true).map(String),
    repro: typeof f.repro === 'string' ? f.repro : null,
    defect: f['no-defect'] ? false : Boolean(f.repro) || null,
  };
  fs.mkdirSync(taskPaths(root).dir, { recursive: true });
  fs.writeFileSync(taskPaths(root).oracles, `${JSON.stringify(spec, null, 2)}\n`);
  append(root, { kind: 'start', ...spec });
  out(`started: risk ${risk}, depth ${depth}, required oracles ${REQUIRED[risk].join(', ')}`);
  out(`planned files: ${spec.files.join(', ') || '(none yet)'}`);
  out(`required commands: ${spec.run.join(' && ') || '(none: gate will say MISSING_TEST)'}`);
  if (spec.repro) out(`repro: ${spec.repro} (run \`check --before\` now, before fixing)`);
  if (REQUIRED[risk].includes('repro') && !spec.repro && spec.defect !== false) {
    out('warning: this risk requires repro; pass --repro <command>, or --no-defect when nothing is broken');
  }
  return 0;
}

function cmdPlan(root, argv, out) {
  const f = parseFlags(argv);
  const spec = requireSpec(root);
  const why = typeof f.why === 'string' ? f.why : '';
  if (!why) throw new UsageError('plan needs --why "<reason>"; plan changes are logged');
  const add = list(f.add).map(normalizePath).filter(Boolean);
  const drop = list(f.drop).map(normalizePath).filter(Boolean);
  spec.files = [...new Set([...spec.files.filter((x) => !drop.includes(x)), ...add])];
  fs.writeFileSync(taskPaths(root).oracles, `${JSON.stringify(spec, null, 2)}\n`);
  append(root, { kind: 'plan', add, drop, why });
  out(`planned files: ${spec.files.join(', ')}`);
  return 0;
}

function renderOracles(oracles, required, out) {
  for (const name of Object.keys(WEIGHTS)) {
    const o = oracles[name];
    const v = numeric(o);
    const mark = o.observed || (typeof o.value === 'number' ? `${o.value}/10` : 'n/a');
    const req = required.includes(name) ? ' (required)' : '';
    out(`  ${name.padEnd(8)} ${String(mark).padEnd(8)} ${v === null ? '' : `[${v}] `}${o.detail}${req}`);
  }
}

function cmdCheck(root, argv, out) {
  const f = parseFlags(argv);
  const spec = requireSpec(root);
  const log = readLog(root);
  if (f.before) {
    if (!spec.repro) throw new UsageError('no repro command; pass --repro to start');
    const r = run(spec.repro, root);
    const edited = (changedFiles(root, spec.base) || []).filter((x) => !isTest(x));
    append(root, { kind: 'repro-before', code: r.code, line: firstFailureLine(r.output), sourceChanged: edited.length > 0 });
    if (edited.length) out(`warning: source already edited (${edited.join(', ')}); this does not prove the defect existed before the fix`);
    out(r.code === 0 ? 'repro PASSED before the fix: it does not reproduce the defect yet' : `repro failed as expected (exit ${r.code})`);
    return 0;
  }
  const prior = log.filter((e) => e.kind === 'check').length;
  if (prior >= MAX_ROUNDS) {
    throw new UsageError(`all ${MAX_ROUNDS} rounds are used; run \`gate\` and report its verdict`);
  }
  const changed = changedFiles(root, spec.base);
  const oracles = {
    runtime: runtimeOracle(root, spec, changed),
    repo: repoOracle(spec, changed),
    repro: reproOracle(root, spec, log),
    ...claimOracles(log),
  };
  const round = prior + 1;
  const Q = quality(oracles);
  const failures = Object.values(oracles).filter((o) => o.oracle_id).map((o) => o.oracle_id);
  const stored = Object.fromEntries(Object.entries(oracles).map(([k, o]) => [k, { observed: o.observed ?? null, value: o.value, detail: o.detail, oracle_id: o.oracle_id }]));
  append(root, { kind: 'check', round, Q, oracles: stored, failures, changed, fingerprint: fingerprint(root, spec.base), spec: specHash(spec) });
  out(`check round ${round}: Q ${Q}`);
  renderOracles(oracles, REQUIRED[spec.risk], out);
  if (oracles.runtime.tail) out(`\nlast output of the failing command:\n${oracles.runtime.tail}`);
  out('\nnext: run `gate` to get the terminal state.');
  return 0;
}

/** Decide the terminal state from the log. Pure: does not run anything. */
function decide(root) {
  const spec = readJson(taskPaths(root).oracles);
  if (!spec) return { verdict: 'UNCLEAR_TASK', reasons: ['no oracles.json: the task was never started with `start`'] };
  const log = readLog(root);
  const checks = log.filter((e) => e.kind === 'check');
  const last = checks[checks.length - 1];
  const lastIndex = last ? log.lastIndexOf(last) : -1;
  const blocker = log.slice(lastIndex + 1).filter((e) => e.kind === 'note' && e.type === 'blocker').pop();
  if (blocker) return { verdict: 'BLOCKED', reasons: [blocker.text] };
  if (!spec.run.length) return { verdict: 'MISSING_TEST', reasons: ['no required command was named with --run'] };
  if (!last) return { verdict: 'CONTINUE', reasons: ['no check has run yet'], round: 0 };
  const stale = [];
  if (fingerprint(root, spec.base) !== last.fingerprint) stale.push('files changed since the last check');
  if (last.spec !== specHash(spec)) stale.push('the plan (risk, files, or commands) changed since the last check');
  if (stale.length) {
    if (last.round >= MAX_ROUNDS) {
      return { verdict: 'STALLED', reasons: [`round cap (${MAX_ROUNDS}) reached`, ...stale, 'the last measured check did not complete'], round: last.round, Q: last.Q };
    }
    return { verdict: 'CONTINUE', reasons: [...stale.map((r) => `${r}; run check again`)], round: last.round };
  }

  const required = REQUIRED[spec.risk];
  const reasons = [];
  for (const name of required) {
    const o = last.oracles[name];
    const v = numeric(o);
    if (name === 'repro' && v === null) {
      if (spec.defect !== false) reasons.push('repro required: pass --repro <command>, or start --no-defect');
      continue;
    }
    if (name === 'external' && v === null) continue; // null only when no external claim was recorded
    else if (v === null) reasons.push(`${name} did not run: ${o.detail}`);
    else if (o.observed && o.observed !== 'pass') reasons.push(`${name} is ${o.observed}: ${o.detail}`);
  }
  for (const [name, o] of Object.entries(last.oracles)) {
    if (o.observed === 'fail' && !required.includes(name)) reasons.push(`${name} failed: ${o.detail}`);
  }
  if (!reasons.length) return { verdict: 'COMPLETE', reasons: [`all required oracles pass (${required.join(', ')}); Q ${last.Q}`], round: last.round, Q: last.Q };

  const prev = checks[checks.length - 2];
  const repeated = prev && last.failures.find((id) => prev.failures.includes(id));
  if (repeated) return { verdict: 'STALLED', reasons: [`same failure twice: ${repeated}`, ...reasons], round: last.round, Q: last.Q };
  if (last.round >= MAX_ROUNDS) {
    const unclear = !spec.files.length;
    return { verdict: unclear ? 'UNCLEAR_TASK' : 'STALLED', reasons: [`round cap (${MAX_ROUNDS}) reached`, ...reasons], round: last.round, Q: last.Q };
  }
  return { verdict: 'CONTINUE', reasons, round: last.round, Q: last.Q };
}

function cmdGate(root, argv, out) {
  const f = parseFlags(argv);
  const result = decide(root);
  if (fs.existsSync(taskPaths(root).oracles)) append(root, { kind: 'gate', ...result });
  if (f.json) out(JSON.stringify(result));
  else {
    out(`RDAP-Q gate: ${result.verdict}`);
    for (const r of result.reasons) out(`  - ${r}`);
    if (result.verdict === 'CONTINUE') out(`rounds used: ${result.round || 0}/${MAX_ROUNDS}. Fix the first reason, then check again.`);
    else out(`Report exactly this terminal state: ${result.verdict}.${result.verdict === 'COMPLETE' ? ' Vibe Code Build complete.' : ''}`);
  }
  return result.verdict in EXIT ? EXIT[result.verdict] : 1;
}

function cmdClaim(root, argv, out) {
  const f = parseFlags(argv);
  const text = f._.join(' ').trim();
  if (!text) throw new UsageError('claim needs text: claim "<statement>" [--external] [--source <url|path>] [--verified] [--off-path]');
  requireSpec(root);
  const event = append(root, { kind: 'claim', text, external: Boolean(f.external), source: typeof f.source === 'string' ? f.source : null, verified: Boolean(f.verified), offPath: Boolean(f['off-path']) });
  out(`claim recorded (${event.verified ? 'verified' : 'unverified'}${event.external ? ', external' : ''})`);
  return 0;
}

function cmdNote(root, argv, out) {
  const [type, ...rest] = argv;
  if (!NOTE_TYPES.includes(type)) throw new UsageError(`note needs a type: ${NOTE_TYPES.join('|')}`);
  const text = rest.join(' ').trim();
  if (!text) throw new UsageError('note needs text');
  if (SECRET.test(text)) throw new UsageError('refusing to log something that looks like a secret; record its source and identifier instead');
  append(root, { kind: 'note', type, text: text.slice(0, 400) });
  out(`${type} noted`);
  return 0;
}

function cmdState(root, argv, out) {
  const spec = readJson(taskPaths(root).oracles);
  if (!spec) {
    out('no RDAP-Q task in this repository');
    return 0;
  }
  const log = readLog(root);
  const checks = log.filter((e) => e.kind === 'check');
  out(`risk ${spec.risk}, depth ${spec.depth}, rounds ${checks.length}/${MAX_ROUNDS}, required ${REQUIRED[spec.risk].join(', ')}`);
  out(`planned files: ${spec.files.join(', ') || '(none)'}`);
  const last = checks[checks.length - 1];
  if (last) {
    out(`last check: Q ${last.Q}`);
    renderOracles(last.oracles, REQUIRED[spec.risk], out);
  }
  const notes = log.filter((e) => e.kind === 'note').slice(-5);
  for (const n of notes) out(`  ${n.type}: ${n.text}`);
  const gate = decide(root);
  out(`gate now: ${gate.verdict}`);
  return 0;
}

// ---------------------------------------------------------------- memory

function memoryHome(env) {
  return env.RDAPQ_HOME || path.join(env.HOME || env.USERPROFILE || os.homedir(), '.rdapq');
}

function projectId(root) {
  const remote = (git(root, ['config', '--get', 'remote.origin.url']) || '').trim();
  const key = remote || root;
  return `${path.basename(root).replace(/[^\w.-]/g, '_')}-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
}

function memoryFile(home, scope, root) {
  return scope === 'global' ? path.join(home, 'memory', 'records.jsonl') : path.join(home, 'projects', projectId(root), 'records.jsonl');
}

/** Latest line per id wins: the file is an append-only event log. */
function loadMemory(file) {
  if (!fs.existsSync(file)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      byId.set(rec.id, rec);
    } catch {
      // a torn line from an interrupted write is skipped, never fatal
    }
  }
  return [...byId.values()];
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

function cmdMemory(root, argv, out, env) {
  const [sub, ...rest] = argv;
  const f = parseFlags(rest);
  const home = memoryHome(env);
  if (sub === 'add') {
    const scope = f.scope === 'global' ? 'global' : 'project';
    const cls = String(f.class || '').toUpperCase();
    const fact = typeof f.fact === 'string' ? f.fact.trim() : '';
    const evidence = typeof f.evidence === 'string' ? f.evidence.trim() : '';
    if (!MEMORY_CLASSES.includes(cls)) throw new UsageError(`--class must be ${MEMORY_CLASSES.join('|')}`);
    if (!fact || !evidence) throw new UsageError('memory add needs --fact and --evidence');
    if (fact.length > MEMORY_CAPS.fact) throw new UsageError(`fact is ${fact.length} chars; the cap is ${MEMORY_CAPS.fact}`);
    if (evidence.length > MEMORY_CAPS.evidence) throw new UsageError(`evidence is ${evidence.length} chars; the cap is ${MEMORY_CAPS.evidence}`);
    if (SECRET.test(fact) || SECRET.test(evidence)) throw new UsageError('refusing to store something that looks like a secret; store its source and identifier instead');
    const file = memoryFile(home, scope, root);
    const active = loadMemory(file).filter((r) => r.status === 'ACTIVE');
    if (active.some((r) => norm(r.fact) === norm(fact))) throw new UsageError('an ACTIVE record already states this fact');
    const cap = scope === 'global' ? MEMORY_CAPS.global : MEMORY_CAPS.project;
    if (active.length >= cap) throw new UsageError(`MEMORY_CAP: ${active.length}/${cap} ACTIVE ${scope} records. Mark stale ones with \`memory stale <id>\` first.`);
    const rec = {
      id: `M-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex')}`,
      scope: scope === 'global' ? 'global' : `project:${projectId(root)}`,
      status: 'ACTIVE',
      class: cls,
      confidence: f.confidence !== undefined ? Math.max(0, Math.min(10, Number(f.confidence))) : null,
      verified: new Date().toISOString().slice(0, 10),
      fact,
      evidence,
      tags: list(f.tags),
      supersedes: typeof f.supersedes === 'string' ? f.supersedes : null,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
    if (rec.supersedes) markMemory(home, root, rec.supersedes, 'SUPERSEDED', rec.id);
    out(`${rec.id} stored (${rec.scope})`);
    return 0;
  }
  if (sub === 'search') {
    const terms = f._.map(norm).filter(Boolean);
    const limit = Math.min(Number(f.limit) || MEMORY_CAPS.search, MEMORY_CAPS.search);
    const records = [...loadMemory(memoryFile(home, 'project', root)), ...loadMemory(memoryFile(home, 'global', root))]
      .filter((r) => r.status === 'ACTIVE')
      .filter((r) => terms.every((t) => norm(`${r.fact} ${r.evidence} ${(r.tags || []).join(' ')}`).includes(t)))
      .slice(0, limit);
    if (!records.length) out('no matching ACTIVE memory');
    for (const r of records) out(`${r.id} [${r.class}${r.confidence === null ? '' : ` ${r.confidence}/10`}] ${r.fact} — ${r.evidence}`);
    return 0;
  }
  if (sub === 'stale') {
    const id = f._[0];
    if (!id) throw new UsageError('memory stale <id> [--status STALE|SUPERSEDED|INVALID] [--by <id>]');
    const status = String(f.status || 'STALE').toUpperCase();
    if (!MEMORY_STATUS.includes(status) || status === 'ACTIVE') throw new UsageError('--status must be STALE, SUPERSEDED, or INVALID');
    if (!markMemory(home, root, id, status, typeof f.by === 'string' ? f.by : null)) throw new UsageError(`no memory record ${id}`);
    out(`${id} marked ${status}`);
    return 0;
  }
  if (sub === 'stats') {
    for (const scope of ['project', 'global']) {
      const all = loadMemory(memoryFile(home, scope, root));
      const active = all.filter((r) => r.status === 'ACTIVE').length;
      out(`${scope}: ${active} ACTIVE of ${all.length} (cap ${scope === 'global' ? MEMORY_CAPS.global : MEMORY_CAPS.project})`);
    }
    return 0;
  }
  if (sub === 'compact') {
    for (const scope of ['project', 'global']) {
      const file = memoryFile(home, scope, root);
      const all = loadMemory(file);
      if (!all.length) continue;
      const keep = all.filter((r) => r.status === 'ACTIVE');
      const retired = all.filter((r) => r.status !== 'ACTIVE');
      if (retired.length) {
        const archive = path.join(path.dirname(file), 'archive', `${new Date().toISOString().slice(0, 7)}.jsonl`);
        fs.mkdirSync(path.dirname(archive), { recursive: true });
        fs.appendFileSync(archive, retired.map((r) => `${JSON.stringify(r)}\n`).join(''));
      }
      fs.writeFileSync(file, keep.map((r) => `${JSON.stringify(r)}\n`).join(''));
      out(`${scope}: kept ${keep.length}, archived ${retired.length}`);
    }
    return 0;
  }
  throw new UsageError('memory add|search|stale|stats|compact');
}

function markMemory(home, root, id, status, by) {
  for (const scope of ['project', 'global']) {
    const file = memoryFile(home, scope, root);
    const rec = loadMemory(file).find((r) => r.id === id);
    if (rec) {
      fs.appendFileSync(file, `${JSON.stringify({ ...rec, status, superseded_by: by || rec.superseded_by || null })}\n`);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- export and hook

/** One anonymized row per task: measurements only, no text, paths, or code. */
function cmdExport(root, argv, out) {
  const f = parseFlags(argv, ['repo']);
  const target = typeof f.out === 'string' ? path.resolve(f.out) : null;
  if (!target) throw new UsageError('export needs --out <file.jsonl>; it appends one anonymized row per repository');
  const repos = (f.repo || [root]).map((r) => repoRoot(path.resolve(String(r))));
  let rows = 0;
  for (const repo of repos) {
    const spec = readJson(taskPaths(repo).oracles);
    if (!spec) continue;
    const log = readLog(repo);
    const checks = log.filter((e) => e.kind === 'check');
    const gate = log.filter((e) => e.kind === 'gate').pop();
    const row = {
      repo: crypto.createHash('sha256').update(repo).digest('hex').slice(0, 12),
      exported: new Date().toISOString(),
      risk: spec.risk,
      depth: spec.depth,
      planned_files: spec.files.length,
      commands: spec.run.length,
      repro: Boolean(spec.repro),
      rounds: checks.length,
      checks: checks.map((c) => ({
        round: c.round,
        Q: c.Q,
        changed_files: (c.changed || []).length,
        ...Object.fromEntries(Object.entries(c.oracles).map(([k, o]) => [k, o.observed ?? (typeof o.value === 'number' ? o.value : null)])),
      })),
      claims: log.filter((e) => e.kind === 'claim').length,
      notes: log.filter((e) => e.kind === 'note').length,
      verdict: gate ? gate.verdict : null,
    };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(row)}\n`);
    rows += 1;
  }
  out(`exported ${rows} row(s) to ${target}`);
  return 0;
}

/**
 * Claude Code Stop hook. Blocks stopping while the gate says CONTINUE, so an
 * RDAP-Q task cannot end without a measured verdict. Tasks without
 * .rdapq/oracles.json are not RDAP-Q tasks and are never blocked.
 */
function cmdHookStop(root, argv, out, env, stdin) {
  try {
    return hookStop(root, out, stdin);
  } catch {
    return 0; // a broken task file must never trap the user's session
  }
}

function hookStop(root, out, stdin) {
  let input = {};
  try {
    input = JSON.parse(stdin || '{}');
  } catch {
    input = {};
  }
  if (input.stop_hook_active) return 0;
  const where = repoRoot(input.cwd || root);
  if (!fs.existsSync(taskPaths(where).oracles)) return 0;
  const result = decide(where);
  if (result.verdict !== 'CONTINUE') return 0;
  const tool = path.relative(where, __filename) || __filename;
  out(JSON.stringify({
    decision: 'block',
    reason: `RDAP-Q gate says CONTINUE: ${result.reasons.join('; ')}. Fix it and run \`node ${tool} check\` then \`node ${tool} gate\`, or record a blocker with \`node ${tool} note blocker "<why>"\`.`,
  }));
  return 0;
}

// ---------------------------------------------------------------- main

const HELP = `RDAP-Q engine

  start --risk LOW|MODERATE|HIGH|CRITICAL --files a,b --run "<cmd>" [--run "<cmd>"]
        [--repro "<cmd>" | --no-defect] [--depth lean|full]
  plan --add a,b [--drop c] --why "<reason>"
  check [--before]          run the oracles and log the result (--before: run the repro first)
  gate [--json]             name the terminal state; exit 0 COMPLETE, 3 CONTINUE, 1 otherwise
  claim "<text>" [--external] [--source s] [--verified] [--off-path]
  note assumption|decision|risk|blocker|question "<text>"
  state                     task summary
  memory add --class C --fact F --evidence E [--scope project|global] [--tags a,b] [--supersedes id]
  memory search <terms...> | stale <id> [--status S] [--by id] | stats | compact
  export --out <file.jsonl> [--repo <dir>]...
  hook-stop                 Claude Code Stop hook (reads JSON on stdin)
`;

const COMMANDS = {
  start: cmdStart,
  plan: cmdPlan,
  check: cmdCheck,
  gate: cmdGate,
  claim: cmdClaim,
  note: cmdNote,
  state: cmdState,
  memory: cmdMemory,
  export: cmdExport,
  'hook-stop': cmdHookStop,
};

function main(argv, options = {}) {
  const out = options.out || ((line) => process.stdout.write(`${line}\n`));
  const err = options.err || ((line) => process.stderr.write(`${line}\n`));
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    out(HELP.trimEnd());
    return 0;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    err(`unknown command: ${command}\n\n${HELP}`);
    return 2;
  }
  try {
    return handler(repoRoot(cwd), rest, out, env, options.stdin);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

module.exports = { main, decide, COMMANDS, REQUIRED, MAX_ROUNDS };

if (require.main === module) {
  let stdin = '';
  if (process.argv[2] === 'hook-stop') {
    try {
      stdin = fs.readFileSync(0, 'utf8');
    } catch {
      stdin = '';
    }
  }
  process.exitCode = main(process.argv.slice(2), { stdin });
}
