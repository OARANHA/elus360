import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTrees } from '../../scripts/elus360-migration-delta-audit.mjs';

const sql = (oid) => ({ oid, mode: '100644' });
const baseline = 'supabase/baseline.sql';
const migration = (name) => 'supabase/migrations/' + name;

test('alteração igual nos dois lados não cria conflito SQL falso', () => {
  const path = migration('20261112120000_example.sql');
  const base = new Map([[baseline, sql('a')], [path, sql('old')]]);
  const fork = new Map([[baseline, sql('b')], [path, sql('same')]]);
  const target = new Map([[baseline, sql('b')], [path, sql('same')]]);
  const result = inspectTrees(base, fork, target);
  assert.deepEqual(result.overlapping_paths, []);
  assert.deepEqual(result.already_identical_paths, [baseline, path]);
  assert.equal(result.baseline.same_bytes, true);
  assert.equal(result.decision, 'NO_GO_PENDING_SCHEMA_RLS_FRESH_DB_AND_UPGRADE_PROOF');
});

test('mesma versão timestamp do Supabase em arquivos diferentes é sinalizada', () => {
  const base = new Map([[baseline, sql('base')]]);
  const fork = new Map([[baseline, sql('base')], [migration('20261112120000_elus.sql'), sql('fork')]]);
  const target = new Map([[baseline, sql('base')], [migration('20261112120000_deskcomm.sql'), sql('official')]]);
  const result = inspectTrees(base, fork, target);
  assert.equal(result.migration_prefix_collisions.length, 1);
  assert.equal(result.migration_prefix_collisions[0].fork_path, migration('20261112120000_elus.sql'));
});

test('mudanças diferentes no mesmo caminho e baseline não são aprovadas', () => {
  const path = migration('20261112120000_change.sql');
  const base = new Map([[baseline, sql('one')], [path, sql('one')]]);
  const fork = new Map([[baseline, sql('two')], [path, sql('fork')]]);
  const target = new Map([[baseline, sql('three')], [path, sql('official')]]);
  const result = inspectTrees(base, fork, target);
  assert.deepEqual(result.overlapping_paths.map(x => x.path), [baseline, path]);
  assert.equal(result.baseline.same_bytes, false);
});
