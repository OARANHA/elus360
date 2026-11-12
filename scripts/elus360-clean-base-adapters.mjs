#!/usr/bin/env node
/**
 * Adaptadores ELUS360 para a árvore OFICIAL v1.108.0, com blob pinado e falha fechada.
 * NUNCA modifica o checkout de origem: só o worktree detached montado pelo prepare.
 * É composição de código, NÃO valida autorização, schema nem aptidão para deploy.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafePath } from './elus360-clean-base-prepare.mjs';

export const OFFICIAL_TARGET = '0b60c5abaace17922ae645399a6a6183a5f5c357';
const digest = data => createHash('sha256').update(data).digest('hex');
const git = (argv, options={}) => execFileSync('git', argv, { encoding: 'utf8', maxBuffer: 128*1024*1024, ...options }).trim();

/** Definições explícitas; o SHA é o blob do DeskcommCRM oficial v1.108.0. */
export const ADAPTERS = [
  {
    path: 'app/app/ai/agents/_components/AgentsList.tsx',
    officialBlob: '0e369e8d944fd45c3d646c2bcc1a7d6dc9e49a57',
    kind: 'controlled_ui',
    edits: [
      ['  canWrite: boolean;\n}', '  canWrite: boolean;\n  mostrarModelo?: boolean;\n}'],
      ['export function AgentsList({ initialData, canWrite }: Props) {',
       'export function AgentsList({ initialData, canWrite, mostrarModelo = false }: Props) {'],
      ['<AgentCard agent={agent} canWrite={canWrite} />',
       '<AgentCard agent={agent} canWrite={canWrite} mostrarModelo={mostrarModelo} />'],
    ],
  },
  {
    path: 'lib/agent-engine/env.ts',
    officialBlob: 'a416453186b478a20e8aece937ae51f6c78dc7e0',
    kind: 'worker_env',
    edits: [
      ['  OPENROUTER_API_KEY: z.string().min(1).optional(),',
       '  OPENROUTER_API_KEY: z.string().min(1).optional(),\n  // ELUS360: credencial opcional de plataforma; vazia nunca bloqueia boot.\n  CHUTES_API_KEY: z.string().min(1).optional(),'],
    ],
  },
  {
    path: 'lib/env.ts',
    officialBlob: '6e3dd8230639aa5250d6413ce6e67a8464143558',
    kind: 'app_env',
    edits: [
      ['  OPENROUTER_API_KEY: z.string().optional().default(""),',
       '  OPENROUTER_API_KEY: z.string().optional().default(""),\n  // ELUS360: opcional, chave nunca deve ser registrada ou devolvida ao navegador.\n  CHUTES_API_KEY: z.string().optional().default(""),'],
    ],
  },
  {
    path: 'lib/audit/actions.ts',
    officialBlob: '9dca646b31bb987c8ba9aae05684418fb53042ef',
    kind: 'audit_actions',
    edits: [
      ['  "platform_admin.platform_admins_listed",',
       '  "platform_admin.platform_admins_listed",\n  // ELUS360: mutações técnicas de IA gerenciada por tenant.\n  "platform_admin.ai_autonomy_updated",\n  "platform_admin.ai_default_updated",'],
    ],
  },
  {
    path: '.env.example',
    officialBlob: 'e74d2cf665da729e5ca5042879d56ad64cb9c6df',
    kind: 'documented_env',
    edits: [
      ['OPENROUTER_API_KEY=\n',
       'OPENROUTER_API_KEY=\n# ELUS360: chave de plataforma opcional. Nunca registre uma chave real neste arquivo.\nCHUTES_API_KEY=\n# ELUS360: habilitar chutes somente após catálogo e governança validados.\nELUS_DEFAULT_AI_PROVIDER=\n'],
    ],
  },
  {
    path: 'package.json',
    officialBlob: '7ac090cbde0c9de373c34b19e21c31454efd2518',
    kind: 'package_scripts_only',
    edits: [
      ['    "test:unit": "vitest run",',
       '    "test:unit": "vitest run",\n    "test:operational": "node --test tests/operational/*.test.mjs",'],
    ],
  },
];

function exactReplace(text, oldValue, nextValue, path) {
  const chunks = text.split(oldValue);
  if (chunks.length !== 2) throw new Error('ADAPTER_ANCHOR_MISMATCH: '+path);
  if (nextValue === oldValue) throw new Error('ADAPTER_NO_CHANGE: '+path);
  return chunks.join(nextValue);
}

export function adaptText(original, adapter) {
  if (typeof original !== 'string' || !adapter || !Array.isArray(adapter.edits))
    throw new Error('BAD_ADAPTER');
  let result = original;
  for (const [oldValue,nextValue] of adapter.edits)
    result = exactReplace(result, oldValue, nextValue, adapter.path);
  return result;
}

export function planChanges({report, targetSha, sourceByPath, officialBlobByPath}) {
  if (report?.schema_version !== 1 || report?.stage !== 'PREPARED_NOT_VALIDATED' ||
      report.upstream_target_sha !== OFFICIAL_TARGET || targetSha !== OFFICIAL_TARGET ||
      !Array.isArray(report.review) || report.review.length !== report.counts?.conflicts) 
    throw new Error('UNVERIFIED_CLEAN_BASE_REPORT');
  const originalReview = new Map();
  for (const item of report.review) {
    const path = assertSafePath(item.path);
    if (originalReview.has(path)) throw new Error('DUPLICATE_CONFLICT_PATH');
    originalReview.set(path, item);
  }
  const changed = [];
  for (const adapter of ADAPTERS) {
    const item = originalReview.get(adapter.path);
    if (!item || item.reason !== 'both_changed') throw new Error('ADAPTER_OUTSIDE_REVIEW: '+adapter.path);
    if (officialBlobByPath[adapter.path] !== adapter.officialBlob)
      throw new Error('OFFICIAL_BLOB_CHANGED: '+adapter.path);
    const oldContent = sourceByPath[adapter.path];
    if (typeof oldContent !== 'string') throw new Error('MISSING_OFFICIAL_FILE: '+adapter.path);
    const content = adaptText(oldContent, adapter);
    changed.push({path: adapter.path, kind: adapter.kind,
      official_blob: adapter.officialBlob, content,
      sha256: digest(content)});
  }
  const remaining = report.review.filter(r => !changed.some(c => c.path === r.path));
  return {changed, remaining};
}

function parseFlags(argv) {
  if (argv.length!==6) throw new Error('USO: --candidate /abs/worktree --source-report /abs/report.json --reports /abs/destino');
  const f = new Map();
  for (let i=0;i<argv.length;i+=2){
    if(!['--candidate','--source-report','--reports'].includes(argv[i]) || f.has(argv[i]))
      throw new Error('BAD_FLAG');
    f.set(argv[i],argv[i+1]);
  }
  for(const k of ['--candidate','--source-report','--reports'])
    if(!f.has(k) || !isAbsolute(f.get(k))) throw new Error('REQUIRE_ABSOLUTE_PATH: '+k);
  return f;
}

export function run(argv) {
  const flags = parseFlags(argv), candidate = resolve(flags.get('--candidate'));
  const reportPath = resolve(flags.get('--source-report')), reports = resolve(flags.get('--reports'));
  const report = JSON.parse(readFileSync(reportPath,'utf8'));
  const actualHead = git(['-C',candidate,'rev-parse','HEAD']);
  // A árvore composta não pode ser a branch da PR nem a main; checkout detached.
  if (git(['-C',candidate,'branch','--show-current']) !== '') 
    throw new Error('CANDIDATE_MUST_BE_DETACHED');
  const sourceByPath = {}, officialBlobByPath = {};
  for(const adapter of ADAPTERS){
    assertSafePath(adapter.path);
    sourceByPath[adapter.path]=readFileSync(join(candidate,adapter.path),'utf8');
    officialBlobByPath[adapter.path]=git(['-C',candidate,'hash-object','--',adapter.path]);
  }
  // Preflight integral, SEM ESCRITA, antes de modificar qualquer arquivo.
  const plan=planChanges({report,targetSha:actualHead,sourceByPath,officialBlobByPath});
  for(const c of plan.changed) writeFileSync(join(candidate,c.path),c.content);
  git(['-C',candidate,'add','--',...plan.changed.map(x=>x.path)]);
  const patch=execFileSync('git',['-C',candidate,'diff','--cached','--binary'],{maxBuffer:128*1024*1024});
  mkdirSync(reports,{recursive:true});
  const composed={
    schema_version:1, stage:'COMPOSED_NOT_VALIDATED',
    upstream_target_sha:actualHead, fork_sha:report.fork_sha,
    source_report_sha256:digest(readFileSync(reportPath)),
    adapted:plan.changed.map(({content,...metadata})=>metadata),
    counts:{safe_overlay:report.counts.staged, adaptations:plan.changed.length, unresolved:plan.remaining.length},
    unresolved:plan.remaining,
    candidate_patch:{sha256:digest(patch),bytes:patch.length},
    gates:{source_blobs_pinned:true, authorization:'NOT_RUN',typecheck:'NOT_RUN',build:'NOT_RUN',
      tenant_isolation:'NOT_RUN',db_upgrade:'NOT_RUN',functional_e2e:'NOT_RUN',merge_deploy:'FORBIDDEN'}
  };
  writeFileSync(join(reports,'elus360-composed.patch'),patch);
  writeFileSync(join(reports,'elus360-composed-report.json'),JSON.stringify(composed,null,2)+'\n');
  process.stdout.write(JSON.stringify({stage:composed.stage,counts:composed.counts,sha256:composed.candidate_patch.sha256})+'\n');
  return composed;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{run(process.argv.slice(2));}catch(e){console.error('ELUS_ADAPTER_NO_GO: '+e.message);process.exitCode=1;}
}
