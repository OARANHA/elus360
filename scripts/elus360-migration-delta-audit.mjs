#!/usr/bin/env node
/**
 * ELUS360: inspeção SOMENTE LEITURA do delta SQL entre duas releases oficiais
 * e o fork. Não compõe baseline, não aplica DDL e não afirma upgrade seguro.
 *
 * node scripts/elus360-migration-delta-audit.mjs \
 *   --repo . --base <sha-v1.102> --fork <sha-elus> --target <sha-v1.108>
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function argsOf(argv) {
  if (argv.length !== 8) throw new Error('USO: --repo PATH --base SHA --fork SHA --target SHA');
  const m = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--repo', '--base', '--fork', '--target'].includes(argv[i]) || m.has(argv[i]))
      throw new Error('ARGUMENTO_INVALIDO');
    m.set(argv[i], argv[i + 1]);
  }
  for (const k of ['--repo', '--base', '--fork', '--target']) if (!m.get(k)) throw new Error('ARGUMENTO_AUSENTE: ' + k);
  for (const k of ['--base', '--fork', '--target'])
    if (!/^[0-9a-f]{40}$/.test(m.get(k))) throw new Error('SHA_NAO_FIXADO: ' + k);
  return m;
}

function git(repo, argv) {
  return execFileSync('git', ['-C', repo, ...argv], {
    encoding: 'buffer', maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tree(repo, sha) {
  // OID e modo vêm do objeto Git, não do checkout ou do banco instalado.
  const raw = git(repo, ['ls-tree', '-r', '-z', sha, '--', 'supabase/migrations', 'supabase/baseline.sql']);
  const entries = new Map();
  for (const line of raw.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw new Error('TREE_ENTRY_INVALIDA');
    const [, mode, type, oid, path] = match;
    if (type !== 'blob' || !['100644', '100755'].includes(mode))
      throw new Error('SQL_TIPO_GIT_NAO_SUPORTADO: ' + path);
    if (!(path === 'supabase/baseline.sql' || /^supabase\/migrations\/[^/]+\.sql$/.test(path)))
      throw new Error('CAMINHO_SQL_NAO_ESPERADO: ' + path);
    entries.set(path, { oid, mode });
  }
  if (!entries.has('supabase/baseline.sql')) throw new Error('BASELINE_AUSENTE: ' + sha);
  return entries;
}

function delta(from, to) {
  return [...new Set([...from.keys(), ...to.keys()])].sort().flatMap(path => {
    const a = from.get(path), b = to.get(path);
    if (a?.oid === b?.oid && a?.mode === b?.mode) return [];
    return [{ path, status: !a ? 'added' : !b ? 'deleted' : 'changed',
      before_oid: a?.oid ?? null, after_oid: b?.oid ?? null }];
  });
}

function semanticPrefix(path) {
  const basename = path.split('/').at(-1);
  // Detecta apenas padrões reconhecidos, sem pressupor que números próximos
  // representam a ordem real de execução ou a mesma migration.
  const m = /^(\d{8,14})_(\d{4})_/.exec(basename);
  return m ? { timestamp: m[1], sequence: m[2] } : null;
}

function checkPrefixes(entries) {
  const grouped = new Map();
  for (const path of entries.keys()) {
    if (!path.startsWith('supabase/migrations/')) continue;
    const prefix = semanticPrefix(path);
    if (!prefix) continue;
    const key = prefix.timestamp + '_' + prefix.sequence;
    grouped.set(key, [...(grouped.get(key) || []), path]);
  }
  return [...grouped.entries()].filter(([, paths]) => paths.length > 1)
    .map(([prefix, paths]) => ({prefix, paths: paths.sort()}));
}

export function inspectTrees(base, fork, target) {
  const localDelta = delta(base, fork), upstreamDelta = delta(base, target);
  const upstreamPaths = new Set(upstreamDelta.map(x => x.path));
  const overlap = localDelta.filter(x => upstreamPaths.has(x.path));
  const localNew = localDelta.filter(x => x.status === 'added' && x.path.endsWith('.sql'));
  const targetNew = upstreamDelta.filter(x => x.status === 'added' && x.path.endsWith('.sql'));
  const upstreamByPrefix = new Map();
  for (const x of targetNew) {
    const p = semanticPrefix(x.path);
    if (p) upstreamByPrefix.set(p.timestamp + '_' + p.sequence,
      [...(upstreamByPrefix.get(p.timestamp + '_' + p.sequence) || []), x.path]);
  }
  const prefixCollisions = localNew.flatMap(x => {
    const p = semanticPrefix(x.path);
    const paths = p && upstreamByPrefix.get(p.timestamp + '_' + p.sequence);
    return paths?.some(other => other !== x.path)
      ? [{ fork_path: x.path, upstream_paths: paths }] : [];
  });
  return {
    stage: 'SQL_DELTA_AUDITED_NOT_APPLIED',
    local_delta_count: localDelta.length,
    upstream_delta_count: upstreamDelta.length,
    overlapping_paths: overlap,
    migration_prefix_collisions: prefixCollisions,
    duplicate_fork_prefixes: checkPrefixes(fork),
    duplicate_target_prefixes: checkPrefixes(target),
    baseline: {
      fork_oid: fork.get('supabase/baseline.sql')?.oid,
      upstream_oid: target.get('supabase/baseline.sql')?.oid,
      same_bytes: fork.get('supabase/baseline.sql')?.oid === target.get('supabase/baseline.sql')?.oid,
    },
    decision: 'NO_GO_PENDING_SCHEMA_RLS_FRESH_DB_AND_UPGRADE_PROOF',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const flags = argsOf(process.argv.slice(2));
    const repo = resolve(flags.get('--repo'));
    const result = inspectTrees(
      tree(repo, flags.get('--base')),
      tree(repo, flags.get('--fork')),
      tree(repo, flags.get('--target')),
    );
    process.stdout.write(JSON.stringify({
      refs: { base: flags.get('--base'), fork: flags.get('--fork'), target: flags.get('--target') },
      ...result,
    }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('ELUS_SQL_AUDIT_NO_GO: ' + error.message + '\n');
    process.exitCode = 3;
  }
}
