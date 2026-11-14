#!/usr/bin/env node
/** Monta um worktree Deskcomm LIMPO e reaplica apenas o delta ELUS sem colisão de caminhos.
 *  Preparação não é homologação: migrations, segurança e E2E dependem de gates separados.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const RISK = /^(?:app\/api\/|lib\/(?:auth\/|ai\/|agent-engine\/|elus360\/|mcp\/)|supabase\/|\.github\/|deploy\/|hostgator-setup-kit\/|proxy\.ts$|Dockerfile|package\.json$|pnpm-lock\.yaml$|\.env)/;

export function assertSafePath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('\\') ||
      /[\x00-\x1f\x7f]/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..' || s === '.git')) {
    throw new Error(`INVALID_GIT_PATH: ${JSON.stringify(p)}`);
  }
  return p;
}

export function parseChanges(raw) {
  const fields = Buffer.isBuffer(raw) ? raw.toString('utf8').split('\0') : String(raw).split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 2) throw new Error('BAD_GIT_DIFF_NAME_STATUS');
  const changes = new Map();
  for (let i = 0; i < fields.length; i += 2) {
    const status = fields[i], path = assertSafePath(fields[i + 1]);
    if (!/^[AMDT]$/.test(status) || changes.has(path)) throw new Error(`BAD_OR_DUPLICATE_GIT_STATUS: ${status} ${path}`);
    changes.set(path, status);
  }
  return changes;
}

export function parseTree(raw) {
  const tree = new Map();
  const records = Buffer.isBuffer(raw) ? raw.toString('utf8').split('\0') : String(raw).split('\0');
  for (const record of records) {
    if (!record) continue;
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(record);
    if (!match) throw new Error('BAD_GIT_TREE_RECORD');
    const path = assertSafePath(match[4]);
    if (tree.has(path)) throw new Error('DUPLICATE_TREE_ENTRY');
    tree.set(path, { mode: match[1], type: match[2], sha: match[3] });
  }
  return tree;
}

const regular = entry => entry == null || (entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755'));
const identical = (a, b) => !!a && !!b && a.mode === b.mode && a.sha === b.sha && a.type === b.type;

export function planOverlay({ forkChanges, upstreamChanges, baseTree, forkTree, targetTree }) {
  const staged = [], review = [], alreadyIncluded = [], requiresValidation = [];
  for (const [path, status] of forkChanges) {
    const base = baseTree.get(path), fork = forkTree.get(path), target = targetTree.get(path);
    const upstreamStatus = upstreamChanges.get(path);
    if (identical(fork, target)) { alreadyIncluded.push(path); continue; }
    if (upstreamStatus) { review.push({ path, reason: 'both_changed', fork_status: status, upstream_status: upstreamStatus }); continue; }
    if (!regular(base) || !regular(fork) || !regular(target) || status === 'D' || status === 'T') {
      review.push({ path, reason: 'deletion_or_unsupported_mode', fork_status: status }); continue;
    }
    // A versão oficial preservou esse caminho exatamente; o delta local pode ser reaplicado.
    if (base && !identical(base, target)) {
      review.push({ path, reason: 'inconsistent_upstream_delta' }); continue;
    }
    if (!fork && status !== 'D') { review.push({ path, reason: 'missing_fork_blob' }); continue; }
    staged.push(path);
    if (RISK.test(path)) requiresValidation.push(path);
  }
  return {
    staged: staged.sort(),
    review: review.sort((a, b) => a.path.localeCompare(b.path)),
    alreadyIncluded: alreadyIncluded.sort(),
    requiresValidation: requiresValidation.sort(),
  };
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options });
}
function argsToMap(argv) {
  const result = new Map();
  if (argv.length % 2) throw new Error('EXPECTED_FLAG_VALUE_PAIRS');
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--[a-z-]+$/.test(argv[i]) || result.has(argv[i])) throw new Error('INVALID_OR_DUPLICATED_FLAG');
    result.set(argv[i], argv[i + 1]);
  }
  return result;
}
export function run(argv) {
  const flags = argsToMap(argv);
  if ([...flags.keys()].some(k => !['--base', '--target', '--fork', '--out', '--reports'].includes(k))) throw new Error('UNKNOWN_FLAG');
  const base = flags.get('--base'), target = flags.get('--target'), fork = flags.get('--fork');
  const out = flags.get('--out'), reports = flags.get('--reports');
  if (![base, target, fork].every(v => SHA.test(v ?? ''))) throw new Error('UNPINNED_SHA');
  if (!out || !reports || !isAbsolute(out) || !isAbsolute(reports) || resolve(out) === resolve(reports)) throw new Error('INVALID_OUTPUT_PATH');
  if (existsSync(out)) throw new Error('OUTPUT_ALREADY_EXISTS');
  const root = git(['rev-parse', '--show-toplevel']).toString().trim();
  if (resolve(out) === resolve(root) || resolve(out).startsWith(resolve(root) + '/')) throw new Error('OUTPUT_INSIDE_SOURCE_REPO');
  for (const sha of [base, target, fork]) git(['cat-file', '-e', `${sha}^{commit}`]);
  git(['merge-base', '--is-ancestor', base, target]);

  const changed = (a, b) => parseChanges(git(['diff', '--no-renames', '--name-status', '-z', a, b]));
  const tree = sha => parseTree(git(['ls-tree', '-r', '-z', sha]));
  const delta = changed(base, fork), upstreamDelta = changed(base, target);
  const plan = planOverlay({ forkChanges: delta, upstreamChanges: upstreamDelta,
    baseTree: tree(base), forkTree: tree(fork), targetTree: tree(target) });

  // A árvore inicial é SEMPRE exatamente o commit oficial de destino.
  git(['worktree', 'add', '--detach', out, target]);
  mkdirSync(reports, { recursive: true });
  const patch = plan.staged.length ? git(['diff', '--no-ext-diff', '--no-renames', '--binary', base, fork, '--', ...plan.staged]) : Buffer.alloc(0);
  if (patch.length) git(['-C', out, 'apply', '--index', '--binary', '-'], { input: patch });
  // git apply --index inclui arquivos novos; nunca exportar só git diff do working tree.
  const stagedRaw = git(['-C', out, 'diff', '--cached', '--name-only', '-z']).toString('utf8');
  const stagedNames = stagedRaw.split('\0').filter(Boolean).sort();
  if (JSON.stringify(stagedNames) !== JSON.stringify(plan.staged)) throw new Error('STAGED_PATH_MISMATCH');
  const candidatePatch = git(['-C', out, 'diff', '--cached', '--no-ext-diff', '--binary']);
  const sha256 = createHash('sha256').update(candidatePatch).digest('hex');
  writeFileSync(join(reports, 'elus360-clean-base.patch'), candidatePatch);
  const report = {
    schema_version: 1,
    stage: 'PREPARED_NOT_VALIDATED',
    upstream_base_sha: base, upstream_target_sha: target, fork_sha: fork,
    counts: { fork_delta: delta.size, upstream_delta: upstreamDelta.size, staged: plan.staged.length,
      conflicts: plan.review.length, already_in_upstream: plan.alreadyIncluded.length,
      staged_requiring_validation: plan.requiresValidation.length },
    ...plan,
    patch: { bytes: candidatePatch.length, sha256 },
    gates: { overlay_complete: plan.review.length === 0, security: 'NOT_RUN',
      database_upgrade: 'NOT_RUN', e2e: 'NOT_RUN', deploy: 'FORBIDDEN' },
  };
  writeFileSync(join(reports, 'elus360-clean-base-report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ stage: report.stage, counts: report.counts, patch_sha256: sha256 }) + '\n');
  return report;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { run(process.argv.slice(2)); }
  catch (error) { console.error(`ELUS_CLEAN_BASE_NO_GO: ${error.message}`); process.exitCode = 1; }
}
