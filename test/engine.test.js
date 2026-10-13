'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { main } = require('../rdap-q-skill/tool/rdapq');

const TOOL = path.join(__dirname, '..', 'rdap-q-skill', 'tool', 'rdapq.js');

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

/** A tiny repo: src/add.js with a bug, a test that imports it, and a failing repro test. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-engine-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'src', 'add.js'), "module.exports = (a, b) => a - b;\n");
  fs.writeFileSync(path.join(root, 'test', 'add.test.js'), [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const add = require('../src/add');",
    "test('adds', () => assert.equal(add(2, 3), 5));",
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function rdapq(root, args, extra = {}) {
  const lines = [];
  const errs = [];
  const code = main(args, { cwd: root, out: (l) => lines.push(l), err: (l) => errs.push(l), env: { ...process.env, RDAPQ_HOME: path.join(root, '.home') }, ...extra });
  return { code, out: lines.join('\n'), err: errs.join('\n') };
}

const fix = (root) => fs.writeFileSync(path.join(root, 'src', 'add.js'), "module.exports = (a, b) => a + b;\n");
const TEST_CMD = 'node --test test/*.test.js';

test('gate is CONTINUE before any check and UNCLEAR_TASK before start', () => {
  const root = fixture();
  assert.match(rdapq(root, ['gate']).out, /UNCLEAR_TASK/);
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  const g = rdapq(root, ['gate']);
  assert.equal(g.code, 3);
  assert.match(g.out, /CONTINUE/);
});

test('a real fix with an importing test reaches COMPLETE', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  const failing = rdapq(root, ['check']);
  assert.match(failing.out, /runtime\s+fail/);
  fix(root);
  const passing = rdapq(root, ['check']);
  assert.match(passing.out, /runtime\s+pass .*imports src\/add\.js/);
  assert.match(passing.out, /repo\s+pass/);
  const g = rdapq(root, ['gate']);
  assert.equal(g.code, 0, g.out);
  assert.match(g.out, /COMPLETE/);
  assert.match(g.out, /^Report exactly this terminal state: COMPLETE\.$/m);
  assert.doesNotMatch(g.out, /Vibe/i, 'the gate names the state; it adds no catchphrase');
});

test('unplanned files fail the repo oracle until the plan is amended with a reason', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  fix(root);
  fs.writeFileSync(path.join(root, 'notes.txt'), 'stray\n');
  rdapq(root, ['check']);
  const g = rdapq(root, ['gate']);
  assert.match(g.out, /CONTINUE/);
  assert.match(g.out, /unplanned: notes\.txt/);
  assert.equal(rdapq(root, ['plan', '--add', 'notes.txt']).code, 2);
  rdapq(root, ['plan', '--add', 'notes.txt', '--why', 'release note']);
  rdapq(root, ['check']);
  assert.match(rdapq(root, ['gate']).out, /COMPLETE/);
});

test('passing commands that never touch the change are only partial', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'README.md', '--run', 'node -e "process.exit(0)"']);
  fs.writeFileSync(path.join(root, 'README.md'), 'changed\n');
  const c = rdapq(root, ['check']);
  assert.match(c.out, /runtime\s+partial/);
  assert.match(rdapq(root, ['gate']).out, /runtime is partial/);
});

test('the same failure twice is STALLED', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  rdapq(root, ['check']);
  fs.writeFileSync(path.join(root, 'src', 'add.js'), "module.exports = (a, b) => a * b;\n");
  rdapq(root, ['check']);
  const g = rdapq(root, ['gate']);
  assert.equal(g.code, 1);
  assert.match(g.out, /STALLED/);
  assert.match(g.out, /same failure twice/);
});

test('HIGH risk needs a repro that failed before and passes after', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'HIGH', '--files', 'src/add.js', '--run', TEST_CMD, '--repro', TEST_CMD]);
  fix(root);
  rdapq(root, ['check']);
  assert.match(rdapq(root, ['gate']).out, /repro is partial/);

  const again = fixture();
  rdapq(again, ['start', '--risk', 'HIGH', '--files', 'src/add.js', '--run', TEST_CMD, '--repro', TEST_CMD]);
  assert.match(rdapq(again, ['check', '--before']).out, /failed as expected/);
  fix(again);
  rdapq(again, ['check']);
  assert.match(rdapq(again, ['gate']).out, /COMPLETE/);
});

test('HIGH risk without repro or --no-defect cannot complete', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'HIGH', '--files', 'src/add.js', '--run', TEST_CMD]);
  fix(root);
  rdapq(root, ['check']);
  assert.match(rdapq(root, ['gate']).out, /repro required/);
});

test('no required command is MISSING_TEST; a blocker note is BLOCKED', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js']);
  assert.match(rdapq(root, ['gate']).out, /MISSING_TEST/);
  const other = fixture();
  rdapq(other, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  rdapq(other, ['note', 'blocker', 'needs a production credential']);
  assert.match(rdapq(other, ['gate']).out, /BLOCKED/);
});

test('editing after a check forces another check', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  fix(root);
  rdapq(root, ['check']);
  fs.appendFileSync(path.join(root, 'src', 'add.js'), '// later edit\n');
  assert.match(rdapq(root, ['gate']).out, /changed since the last check/);
});

test('an unverified external claim on the changed path fails external', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'CRITICAL', '--files', 'src/add.js', '--run', TEST_CMD, '--no-defect']);
  rdapq(root, ['claim', 'the API returns cents', '--external']);
  fix(root);
  rdapq(root, ['check']);
  assert.match(rdapq(root, ['gate']).out, /external is fail/);
  rdapq(root, ['claim', 'the API returns cents', '--external', '--verified', '--source', 'docs/api.md']);
});

test('state.jsonl is append-only and oracles.json holds the plan', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  rdapq(root, ['check']);
  rdapq(root, ['note', 'decision', 'keep the signature']);
  const log = fs.readFileSync(path.join(root, '.rdapq', 'state.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((e) => e.kind), ['start', 'check', 'note']);
  const spec = JSON.parse(fs.readFileSync(path.join(root, '.rdapq', 'oracles.json'), 'utf8'));
  assert.deepEqual(spec.files, ['src/add.js']);
});

test('memory: add, search, dedupe, secrets, stale, caps', () => {
  const root = fixture();
  const add = (fact, extra = []) => rdapq(root, ['memory', 'add', '--class', 'OBSERVED', '--fact', fact, '--evidence', 'test/add.test.js', ...extra]);
  const first = add('node --test needs a glob on Node 24');
  assert.equal(first.code, 0, first.err);
  const id = /M-\d{8}-[0-9a-f]{4}/.exec(first.out)[0];
  assert.equal(add('Node --test  needs a glob on node 24').code, 2);
  assert.match(add('token=abcdef123456 works').err, /secret/);
  assert.match(add('x'.repeat(241)).err, /cap is 240/);
  assert.match(rdapq(root, ['memory', 'search', 'glob']).out, new RegExp(id));
  rdapq(root, ['memory', 'stale', id]);
  assert.match(rdapq(root, ['memory', 'search', 'glob']).out, /no matching/);
  for (let i = 0; i < 40; i += 1) assert.equal(add(`fact number ${i}`).code, 0);
  assert.match(add('one too many').err, /MEMORY_CAP/);
});

test('export writes anonymized measurement rows only', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  rdapq(root, ['note', 'decision', 'secretive internal detail']);
  fix(root);
  rdapq(root, ['check']);
  rdapq(root, ['gate']);
  const outFile = path.join(root, 'export.jsonl');
  rdapq(root, ['export', '--out', outFile]);
  const text = fs.readFileSync(outFile, 'utf8');
  const row = JSON.parse(text);
  assert.equal(row.verdict, 'COMPLETE');
  assert.equal(row.rounds, 1);
  assert.doesNotMatch(text, /src\/add\.js|secretive|node --test/);
});

test('hook-stop blocks only while the gate says CONTINUE', () => {
  const root = fixture();
  const hook = (input) => spawnSync(process.execPath, [TOOL, 'hook-stop'], { cwd: root, input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(hook({ cwd: root }).stdout, '');
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  const blocked = JSON.parse(hook({ cwd: root }).stdout);
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /CONTINUE/);
  assert.equal(hook({ cwd: root, stop_hook_active: true }).stdout, '');
  fix(root);
  rdapq(root, ['check']);
  assert.equal(hook({ cwd: root }).stdout, '');
});

test('HIGH with --no-defect completes without a repro', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'HIGH', '--files', 'src/add.js', '--run', TEST_CMD, '--no-defect']);
  fix(root);
  rdapq(root, ['check']);
  assert.match(rdapq(root, ['gate']).out, /COMPLETE/);
});

test('changing the plan after a passing check invalidates it', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  fix(root);
  rdapq(root, ['check']);
  rdapq(root, ['start', '--keep', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD, '--run', 'node -e "process.exit(1)"']);
  assert.match(rdapq(root, ['gate']).out, /plan .* changed since the last check/);
});

test('a new start archives the previous task log and resets the base', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  rdapq(root, ['check']);
  rdapq(root, ['check']);
  fix(root);
  git(root, 'commit', '-qam', 'fix');
  const again = rdapq(root, ['start', '--risk', 'LOW', '--files', 'README.md', '--run', TEST_CMD]);
  assert.match(again.out, /archived/);
  const log = fs.readFileSync(path.join(root, '.rdapq', 'state.jsonl'), 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
  fs.writeFileSync(path.join(root, 'README.md'), 'edited\n');
  assert.match(rdapq(root, ['check']).out, /check round 1/);
  assert.match(rdapq(root, ['check']).out, /repo\s+pass/);
});

test('planned paths are normalized', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', './src/add.js', '--run', TEST_CMD]);
  fix(root);
  assert.match(rdapq(root, ['check']).out, /repo\s+pass/);
});

test('the round cap is hard, even after more edits', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  for (const body of ['a * b', 'a / b', 'a % b']) {
    fs.writeFileSync(path.join(root, 'src', 'add.js'), `module.exports = (a, b) => ${body};\n`);
    rdapq(root, ['check']);
  }
  fix(root);
  const fourth = rdapq(root, ['check']);
  assert.equal(fourth.code, 2);
  assert.match(fourth.err, /rounds are used/);
  assert.match(rdapq(root, ['gate']).out, /STALLED/);
});

test('boolean flags do not swallow the claim text', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  const c = rdapq(root, ['claim', '--external', '--verified', 'the docs say so', '--source', 'docs/x.md']);
  assert.equal(c.code, 0, c.err);
  assert.match(c.out, /verified, external/);
});

test('a torn log line is skipped and a broken plan never crashes the hook', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD]);
  fs.appendFileSync(path.join(root, '.rdapq', 'state.jsonl'), '{"kind":"che');
  assert.match(rdapq(root, ['gate']).out, /CONTINUE/);
  fs.writeFileSync(path.join(root, '.rdapq', 'oracles.json'), '{broken');
  const hook = spawnSync(process.execPath, [TOOL, 'hook-stop'], { cwd: root, input: JSON.stringify({ cwd: root }), encoding: 'utf8' });
  assert.equal(hook.status, 0);
  assert.equal(hook.stdout, '');
});

test('a test that imports only a same-named file elsewhere does not count', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib', 'add.js'), 'module.exports = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'lib');
  rdapq(root, ['start', '--risk', 'LOW', '--files', 'lib/add.js', '--run', TEST_CMD]);
  fs.writeFileSync(path.join(root, 'lib', 'add.js'), 'module.exports = 2;\n');
  fix(root);
  rdapq(root, ['plan', '--add', 'src/add.js', '--why', 'fixture']);
  const c = rdapq(root, ['check']);
  assert.match(c.out, /runtime\s+pass .*imports src\/add\.js/);
});

test('check --before after editing source is flagged', () => {
  const root = fixture();
  rdapq(root, ['start', '--risk', 'HIGH', '--files', 'src/add.js', '--run', TEST_CMD, '--repro', TEST_CMD]);
  fs.writeFileSync(path.join(root, 'src', 'add.js'), 'module.exports = (a, b) => a * b;\n');
  assert.match(rdapq(root, ['check', '--before']).out, /source already edited/);
  fix(root);
  rdapq(root, ['check']);
  assert.match(rdapq(root, ['gate']).out, /repro is partial/);
});

test('depth is lean or full, from --depth or .rdapq/depth, and nothing else', () => {
  const root = fixture();
  const begin = (...extra) => rdapq(root, ['start', '--risk', 'LOW', '--files', 'src/add.js', '--run', TEST_CMD, ...extra]);
  const depth = () => JSON.parse(fs.readFileSync(path.join(root, '.rdapq', 'oracles.json'), 'utf8')).depth;

  assert.equal(begin().code, 0);
  assert.equal(depth(), 'lean');
  assert.equal(begin('--depth', 'full').code, 0);
  assert.equal(depth(), 'full');

  const ghost = begin('--depth', 'standard');
  assert.equal(ghost.code, 2);
  assert.match(ghost.err, /--depth must be lean\|full$/);
  assert.equal(depth(), 'full', 'a rejected start must not rewrite the plan');

  fs.writeFileSync(path.join(root, '.rdapq', 'depth'), 'full\n');
  assert.equal(begin().code, 0);
  assert.equal(depth(), 'full');
  fs.writeFileSync(path.join(root, '.rdapq', 'depth'), 'standard\n');
  const preset = begin();
  assert.equal(preset.code, 2);
  assert.match(preset.err, /\.rdapq\/depth says "standard"; it must be lean or full/);
  assert.equal(begin('--depth', 'lean').code, 0, '--depth overrides a bad preset');
  assert.equal(depth(), 'lean');
});

test('the engine passes the pattern Hermes scans skills for (environment dumps)', () => {
  // tools/skills_guard.py in Hermes Agent: r'printenv|env\s*\|' marks a skill
  // "caution", and a URL install of a caution skill is blocked.
  const source = fs.readFileSync(TOOL, 'utf8');
  assert.doesNotMatch(source, /printenv|env\s*\|/);
});

test('state --json is machine-readable, matches the gate, and never writes the log', () => {
  const root = fixture();
  const state = () => {
    const r = rdapq(root, ['state', '--json']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.split('\n').length, 1, 'one JSON line');
    return JSON.parse(r.out);
  };
  const logFile = path.join(root, '.rdapq', 'state.jsonl');

  const none = state();
  assert.equal(none.task, false);
  assert.equal(none.gate.verdict, 'UNCLEAR_TASK');
  assert.equal(fs.existsSync(path.join(root, '.rdapq')), false, 'state must not create .rdapq/');

  rdapq(root, ['start', '--risk', 'HIGH', '--files', 'src/add.js', '--run', TEST_CMD, '--no-defect']);
  const fresh = state();
  assert.deepEqual(
    { task: fresh.task, risk: fresh.spec.risk, depth: fresh.spec.depth, files: fresh.spec.files, run: fresh.spec.run, defect: fresh.spec.defect },
    { task: true, risk: 'HIGH', depth: 'lean', files: ['src/add.js'], run: [TEST_CMD], defect: false },
  );
  assert.deepEqual(fresh.required, ['runtime', 'repo', 'repro']);
  assert.deepEqual([fresh.rounds, fresh.maxRounds, fresh.lastCheck], [0, 3, null]);
  assert.equal(fresh.gate.verdict, 'CONTINUE');

  rdapq(root, ['check']);
  rdapq(root, ['note', 'decision', 'keep the signature']);
  const before = fs.readFileSync(logFile, 'utf8');
  const failing = state();
  assert.equal(failing.rounds, 1);
  assert.equal(failing.lastCheck.round, 1);
  assert.equal(failing.lastCheck.oracles.runtime.observed, 'fail');
  assert.ok(failing.lastCheck.failures.length > 0);
  assert.deepEqual(failing.notes.map((n) => [n.type, n.text]), [['decision', 'keep the signature']]);
  assert.equal(failing.gate.verdict, 'CONTINUE');
  assert.equal(fs.readFileSync(logFile, 'utf8'), before, 'state --json is read-only');

  fix(root);
  rdapq(root, ['check']);
  const done = state();
  const gate = JSON.parse(rdapq(root, ['gate', '--json']).out);
  assert.equal(done.gate.verdict, 'COMPLETE');
  assert.deepEqual(done.gate, gate, 'state --json reports what gate decides');
  assert.equal(done.lastCheck.oracles.repo.observed, 'pass');
  assert.match(rdapq(root, ['state']).out, /^risk HIGH, depth lean, rounds 2\/3/, 'plain state is unchanged');
});

test('start refuses a directory that is not a git repository, and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-nogit-'));
  const r = rdapq(dir, ['start', '--risk', 'LOW', '--files', 'a.js', '--run', 'true']);
  assert.equal(r.code, 2);
  assert.match(r.err, /is not inside a git repository/);
  assert.equal(fs.existsSync(path.join(dir, '.rdapq')), false);
});

test('start refuses a git repository with no commits, and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-nocommit-'));
  git(dir, 'init', '-q');
  const r = rdapq(dir, ['start', '--risk', 'LOW', '--files', 'a.js', '--run', 'true']);
  assert.equal(r.code, 2);
  assert.match(r.err, /has no commits yet/);
  assert.equal(fs.existsSync(path.join(dir, '.rdapq')), false);
});

test('task commands never use the RDAP-Q home as a task directory', () => {
  // The home directory, outside any repository: <home>/.rdapq is $RDAPQ_HOME.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rdapq-home-'));
  const rdapqHome = path.join(home, '.rdapq');
  fs.mkdirSync(path.join(rdapqHome, 'memory'), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, RDAPQ_HOME: rdapqHome };
  for (const args of [['start', '--risk', 'LOW', '--files', 'a.js', '--run', 'true'], ['note', 'decision', 'x'], ['claim', 'x'], ['gate'], ['check'], ['state']]) {
    const r = rdapq(home, args, { env });
    assert.equal(r.code, 2, `${args[0]}: ${r.out}`);
    assert.match(r.err, /is not a project: its \.rdapq\/ is the RDAP-Q home/, args[0]);
  }
  assert.deepEqual(fs.readdirSync(rdapqHome), ['memory']);
  // Memory commands still work from anywhere; they never touch a task.
  const mem = rdapq(home, ['memory', 'stats'], { env });
  assert.equal(mem.code, 0, mem.err);
});
