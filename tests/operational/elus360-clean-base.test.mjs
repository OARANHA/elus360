import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseChanges, parseTree, assertSafePath, planOverlay, run } from '../../scripts/elus360-clean-base-prepare.mjs';

test('parser binário preserva caminhos e recusa entradas inconsistentes', () => {
  const changes = parseChanges(Buffer.from('M\0core.ts\0A\0lib/elus360/custom.ts\0'));
  assert.equal(changes.get('core.ts'), 'M');
  assert.equal(changes.get('lib/elus360/custom.ts'), 'A');
  assert.throws(() => parseChanges('M\0sem-path\0A\0'), /BAD_GIT_DIFF_NAME_STATUS/);
  assert.throws(() => parseChanges('M\0x\0A\0x\0'), /BAD_OR_DUPLICATE/);
  for (const p of ['../foo', '/etc/passwd', 'a\\b', '.git/config', 'a//b']) assert.throws(() => assertSafePath(p), /INVALID_GIT_PATH/);
  const tree = parseTree('100644 blob 1111111111111111111111111111111111111111\ta.txt\0');
  assert.equal(tree.get('a.txt').mode, '100644');
});

test('caminho alterado nos dois lados bloqueia e alteração idêntica dispensa overlay', () => {
  const base = new Map([['both', { type: 'blob', mode: '100644', sha: '1' }]]);
  const fork = new Map([['both', { type: 'blob', mode: '100644', sha: '2' }],
    ['own', { type: 'blob', mode: '100644', sha: '3' }]]);
  const target = new Map([['both', { type: 'blob', mode: '100644', sha: '4' }]]);
  const result = planOverlay({ forkChanges: new Map([['both', 'M'], ['own', 'A']]),
    upstreamChanges: new Map([['both', 'M']]), baseTree: base, forkTree: fork, targetTree: target });
  assert.deepEqual(result.staged, ['own']);
  assert.equal(result.review[0].reason, 'both_changed');
  assert.deepEqual(result.alreadyIncluded, []);
});

test('reconstrói base oficial limpa, reaplica delta isolado, exporta arquivos novos e bloqueia conflito', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elus-clean-base-test-'));
  const repo = join(dir, 'repo'), out = join(dir, 'candidate'), reports = join(dir, 'reports');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (name, body) => writeFileSync(join(repo, name), body);
  const cwd = process.cwd();
  try {
    git('init', '-b', 'main');
    git('config', 'user.email', 'ci@example.invalid'); git('config', 'user.name', 'ELUS CI');
    put('only-local.txt', 'base\n'); put('both.txt', 'base\n'); git('add', '.'); git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'target');
    put('both.txt', 'upstream\n'); put('official.txt', 'upstream new\n');
    git('add', '.'); git('commit', '-m', 'target');
    const target = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'fork', base);
    put('only-local.txt', 'ELUS\n'); put('both.txt', 'ELUS collision\n');
    put('new-elus.txt', 'arquivo novo ELUS\n');
    git('add', '.'); git('commit', '-m', 'fork');
    const fork = git('rev-parse', 'HEAD');
    process.chdir(repo);
    const report = run(['--base', base, '--target', target, '--fork', fork, '--out', out, '--reports', reports]);
    assert.equal(report.stage, 'PREPARED_NOT_VALIDATED');
    assert.equal(report.counts.staged, 2);
    assert.equal(report.counts.conflicts, 1);
    assert.equal(report.review[0].path, 'both.txt');
    assert.equal(readFileSync(join(out, 'only-local.txt'), 'utf8'), 'ELUS\n');
    assert.equal(readFileSync(join(out, 'new-elus.txt'), 'utf8'), 'arquivo novo ELUS\n');
    assert.equal(readFileSync(join(out, 'both.txt'), 'utf8'), 'upstream\n');
    assert.equal(readFileSync(join(out, 'official.txt'), 'utf8'), 'upstream new\n');
    const patch = readFileSync(join(reports, 'elus360-clean-base.patch'), 'utf8');
    assert.match(patch, /new-elus\.txt/);
    assert.match(patch, /only-local\.txt/);
    assert.doesNotMatch(patch, /both\.txt/);
    assert.equal(git('rev-parse', 'HEAD'), fork);
    assert.equal(report.gates.security, 'NOT_RUN');
    git('worktree', 'remove', '--force', out);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
