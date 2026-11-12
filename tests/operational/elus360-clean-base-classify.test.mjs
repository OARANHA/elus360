import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyConflict, classifyReport, markdownOf } from '../../scripts/elus360-clean-base-classify.mjs';

const cases = [
  ['.agents/skills/deskcomm-cliente-novo/SKILL.md', 'deletion_or_unsupported_mode', 'upstream_docs_candidate'],
  ['.claude/skills/deskcomm-contribuir/scripts/hooks/pre-commit', 'deletion_or_unsupported_mode', 'upstream_scripts_security_review'],
  ['.agents/skills/deskcomm-instalar/references/supabase.md', 'both_changed', 'upstream_docs_candidate'],
  ['app/app/ai/agents/[id]/_components/AgentForm.tsx', 'both_changed', 'runtime_adapter'],
  ['lib/agent-engine/env.ts', 'both_changed', 'runtime_adapter'],
  ['supabase/baseline.sql', 'both_changed', 'database_schema_review'],
  ['hostgator-setup-kit/update.sh', 'both_changed', 'distribution_review'],
  ['.github/workflows/ci.yml', 'both_changed', 'workflow_review'],
  ['package.json', 'both_changed', 'config_review'],
  ['AGENTS.md', 'both_changed', 'policy_document_review'],
  ['tests/unit/preambulo-do-ci-nao-come-o-relogio.test.ts', 'both_changed', 'test_review'],
];
test('todas as famílias do inventário real têm destino de revisão sem auto aprovação', () => {
  for (const [path, reason, category] of cases) {
    const got = classifyConflict({ path, reason, fork_status: reason === 'both_changed' ? 'M' : 'D' });
    assert.equal(got.category, category);
    assert.equal(got.authorization, 'none');
    assert.ok(got.decision);
  }
});

test('contagem integral, proveniência e gates em estado não homologado', () => {
  const report = {
    schema_version: 1, stage: 'PREPARED_NOT_VALIDATED',
    upstream_target_sha: '0b60c5abaace17922ae645399a6a6183a5f5c357',
    fork_sha: '99a2d06613793edd742872f8bebe5e317d1cc1ca',
    counts: { conflicts: cases.length },
    review: cases.map(([path, reason]) => ({ path, reason, fork_status: reason === 'both_changed' ? 'M' : 'D' })),
    patch: { sha256: 'f'.repeat(64) },
  };
  const bytes = Buffer.from(JSON.stringify(report));
  const result = classifyReport(report, bytes);
  assert.equal(result.totals.reviewed, cases.length);
  assert.equal(Object.values(result.totals.by_category).reduce((a,b)=>a+b,0),cases.length);
  assert.equal(result.totals.runtime_adapters_to_analyze, 2);
  assert.equal(result.totals.uncategorized, 0);
  assert.equal(result.gates.collisions_resolved, false);
  assert.equal(result.gates.merge_deploy, 'FORBIDDEN');
  assert.match(result.provenance.source_artifact_sha256, /^[a-f0-9]{64}$/);
  assert.match(markdownOf(result), /Inventário completo/);
  assert.match(markdownOf(result), /AgentForm\.tsx/);
  assert.throws(() => classifyReport({ ...report, counts: { conflicts: 1 } }, bytes), /INVALID_SOURCE_REPORT/);
  assert.throws(() => classifyReport({ ...report, review: [...report.review, report.review[0]], counts: { conflicts: report.review.length+1 } }, bytes), /DUPLICATE_CONFLICT/);
});

test('novas classes não são declaradas seguras por engano', () => {
  assert.equal(classifyConflict({ path: 'unknown/new.ts', reason: 'both_changed', fork_status: 'M' }).category, 'other_manual_review');
  assert.throws(() => classifyConflict({ path: '../escape', reason: 'both_changed' }), /INVALID_GIT_PATH/);
  assert.throws(() => classifyConflict({ path: 'a.ts', reason: 'inexistente' }), /UNKNOWN_CONFLICT_REASON/);
});
