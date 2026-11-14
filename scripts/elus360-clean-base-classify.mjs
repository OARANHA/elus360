#!/usr/bin/env node
/**
 * Classifica a fila COMPLETA de sobreposições no clean-base; não aprova patches.
 * Entrada: artifact JSON produzido por elus360-clean-base-prepare.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafePath } from './elus360-clean-base-prepare.mjs';

const TYPES = {
  upstream_docs_candidate: {
    label: 'Documentação/skills: considerar manter upstream oficial',
    decision: 'Conferir referências ELUS; candidato a manter a versão oficial, nunca aprovar silenciosamente',
  },
  upstream_scripts_security_review: {
    label: 'Scripts e hooks upstream anteriormente excluídos',
    decision: 'Revisão obrigatória de execução, side effects, segurança e integração com o ambiente ELUS',
  },
  runtime_adapter: {
    label: 'Núcleo de IA, agentes, auditoria, ambiente e tradução',
    decision: 'Comparar as três versões, reintroduzir somente comportamento ELUS sem perder funções/correções oficiais',
  },
  database_schema_review: {
    label: 'Migrations e baseline Supabase',
    decision: 'Reconciliação de schema e migrations com upgrade de banco existente e RLS; não copiar baseline antigo',
  },
  distribution_review: {
    label: 'Instalador e distribuição',
    decision: 'Adaptar instalação/atualização para release oficial, preserve Linux AMD64 e rollback',
  },
  workflow_review: {
    label: 'Workflows de CI/E2E',
    decision: 'Preservar testes oficiais e gates ELUS; conferir triggers/permissões e nenhum skipped indevido',
  },
  config_review: {
    label: 'Variáveis de ambiente e dependências',
    decision: 'Conciliar de forma aditiva e validar compatibilidade de package/lock e valores de ambiente',
  },
  policy_document_review: {
    label: 'Doutrina e documentação estrutural',
    decision: 'Manter instruções oficiais atualizadas, com adendos ELUS controlados',
  },
  test_review: {
    label: 'Testes upstream alterados',
    decision: 'Rebase do teste original com cobertura ELUS; comprovar no CI',
  },
  other_manual_review: {
    label: 'Outra colisão não categorizada',
    decision: 'Parada conservadora até revisão específica',
  },
};

const RUNTIME = /^(?:app\/app\/ai\/agents\/|lib\/(?:agent-engine\/env\.ts|audit\/actions\.ts|env\.ts|i18n\/dicionario\.ts)$)/;
const SCRIPT = /\/scripts\//;

export function classifyConflict(item) {
  if (!item || typeof item !== 'object') throw new Error('BAD_CONFLICT_RECORD');
  const path = assertSafePath(item.path), reason = item.reason;
  if (!['both_changed', 'deletion_or_unsupported_mode'].includes(reason)) throw new Error('UNKNOWN_CONFLICT_REASON: ' + path);
  let category = 'other_manual_review';
  if (/^\.(?:agents|claude)\/skills\//.test(path)) {
    category = reason === 'deletion_or_unsupported_mode' && SCRIPT.test(path)
      ? 'upstream_scripts_security_review' : 'upstream_docs_candidate';
  } else if (RUNTIME.test(path)) category = 'runtime_adapter';
  else if (path.startsWith('supabase/')) category = 'database_schema_review';
  else if (path.startsWith('hostgator-setup-kit/') || /^Dockerfile/.test(path)) category = 'distribution_review';
  else if (path.startsWith('.github/workflows/')) category = 'workflow_review';
  else if (path === '.env.example' || path === 'package.json' || path === 'pnpm-lock.yaml') category = 'config_review';
  else if (['CLAUDE.md', 'AGENTS.md', 'README.md', 'docs/index.md'].includes(path)) category = 'policy_document_review';
  else if (path.startsWith('tests/')) category = 'test_review';
  return { path, reason, fork_status: item.fork_status,
    upstream_status: item.upstream_status ?? null,
    category,
    authorization: 'none', ...TYPES[category] };
}

export function classifyReport(source, sourceBytes) {
  if (source?.schema_version !== 1 || source?.stage !== 'PREPARED_NOT_VALIDATED' ||
      !Array.isArray(source.review) || !Number.isSafeInteger(source?.counts?.conflicts) ||
      source.review.length !== source.counts.conflicts) throw new Error('INVALID_SOURCE_REPORT');
  const seen = new Set(), items = [];
  for (const record of source.review) {
    const item = classifyConflict(record);
    if (seen.has(item.path)) throw new Error('DUPLICATE_CONFLICT: ' + item.path);
    seen.add(item.path);
    items.push(item);
  }
  const categories = Object.fromEntries(Object.entries(TYPES).map(([id, meta]) => [id, {
    label: meta.label, decision: meta.decision, count: items.filter(x => x.category === id).length,
    paths: items.filter(x => x.category === id).map(x => x.path),
  }]));
  const counts = Object.fromEntries(Object.entries(categories).map(([id, val]) => [id, val.count]));
  return {
    schema_version: 1, stage: 'CLASSIFIED_NOT_RESOLVED',
    upstream_target_sha: source.upstream_target_sha, fork_sha: source.fork_sha,
    provenance: { source_artifact_sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      source_patch_sha256: source.patch?.sha256 ?? null },
    totals: { reviewed: items.length, by_category: counts,
      keep_official_candidates: counts.upstream_docs_candidate,
      scripts_needing_security_review: counts.upstream_scripts_security_review,
      runtime_adapters_to_analyze: counts.runtime_adapter,
      uncategorized: counts.other_manual_review },
    categories, items,
    gates: { classified: true, collisions_resolved: false, security: 'NOT_RUN',
      database_upgrade: 'NOT_RUN', product_e2e: 'NOT_RUN', merge_deploy: 'FORBIDDEN' },
  };
}

export function markdownOf(result) {
  const header = [
    '# ELUS360 — conflitos do overlay v1.108.0 (triagem, sem autorização)',
    '',
    'Upstream oficial: `' + result.upstream_target_sha + '`',
    'Fork SHA: `' + result.fork_sha + '`',
    'Relatório de origem SHA-256: `' + result.provenance.source_artifact_sha256 + '`',
    '',
    'Nenhum item classificado é automaticamente aplicado, aceito ou homologado.',
    '',
    '| Classe | Arquivos | Decisão necessária |', '| --- | ---: | --- |',
  ];
  for (const { label, decision, count } of Object.values(result.categories)) {
    if (count) header.push('| ' + label + ' | ' + count + ' | ' + decision.replaceAll('|', '/') + ' |');
  }
  header.push('', '## Inventário completo');
  for (const [id, obj] of Object.entries(result.categories)) {
    if (!obj.count) continue;
    header.push('', '### ' + obj.label + ' (' + obj.count + ')');
    for (const path of obj.paths) header.push('- `' + path.replaceAll('`', '\\`') + '`');
  }
  header.push('', '### Gates pendentes', '',
    'Adaptadores, migrations e testes de produto ainda exigem implementação/validação.',
    'Nenhum merge, publicação ou deploy é autorizado por este documento.', '');
  return header.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 5) throw new Error('USO: node script.mjs report.json classificacao.json classificacao.md');
    const bytes = readFileSync(process.argv[2]);
    const result = classifyReport(JSON.parse(bytes.toString('utf8')), bytes);
    writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
    writeFileSync(process.argv[4], markdownOf(result));
    console.log(JSON.stringify({ stage: result.stage, totals: result.totals }));
  } catch (e) { console.error('ELUS_CLASSIFY_NO_GO: ' + e.message); process.exitCode = 1; }
}
