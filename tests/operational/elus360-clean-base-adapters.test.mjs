import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, OFFICIAL_TARGET, adaptText, planChanges, composeOptionalBuildPolicy } from '../../scripts/elus360-clean-base-adapters.mjs';

// Testes compactos usam seis adaptadores de baixa complexidade;
// AgentForm, dicionário e teste do preâmbulo exigem o conteúdo upstream real.
const FIXTURE_ADAPTERS = ADAPTERS.filter((adapter) => !['agent_form_managed','i18n_elus_entries','ci_timeout_same_step'].includes(adapter.kind));

function sourceFixture() {
  const byPath={};
  for(const adapter of FIXTURE_ADAPTERS) {
    // O sentinela precisa existir mesmo quando o adaptador possui uma única âncora.
    // Ele comprova que a substituição aditiva preserva linhas do upstream.
    byPath[adapter.path]=adapter.edits.map(([needle])=>needle).join('\n')+'\n// UPSTREAM_FEATURE_PRESERVED\n';
  }
  const officialBlobByPath=Object.fromEntries(FIXTURE_ADAPTERS.map(x=>[x.path,x.officialBlob]));
  const report={schema_version:1,stage:'PREPARED_NOT_VALIDATED',
    upstream_target_sha:OFFICIAL_TARGET,
    counts:{conflicts:FIXTURE_ADAPTERS.length+1,staged:393},
    review:[
      ...FIXTURE_ADAPTERS.map(a=>({path:a.path,reason:'both_changed',fork_status:'M',upstream_status:'M'})),
      {path:'app/app/ai/agents/[id]/_components/AgentForm.tsx',reason:'both_changed',fork_status:'M',upstream_status:'M'},
    ]};
  return {report,sourceByPath:byPath,officialBlobByPath};
}
test('seis adaptadores só aceitam blob oficial fixado e conflito explícito',()=>{
  assert.equal(ADAPTERS.length,9);
  assert.equal(FIXTURE_ADAPTERS.length,6);
  const f=sourceFixture();
  const planned=planChanges({...f,targetSha:OFFICIAL_TARGET,adapters:FIXTURE_ADAPTERS});
  assert.equal(planned.changed.length,6);
  assert.equal(planned.remaining.length,1);
  assert.match(planned.remaining[0].path,/AgentForm/);
  for(const item of planned.changed) {
    assert.match(item.content,/UPSTREAM_FEATURE_PRESERVED/);
    assert.match(item.sha256,/^[a-f0-9]{64}$/);
    assert.ok(item.content.includes(ADAPTERS.find(x=>x.path===item.path).edits.at(-1)[1]));
  }
  assert.match(planned.changed.find(x=>x.path.endsWith('AgentsList.tsx')).content,/mostrarModelo=\{mostrarModelo\}/);
  assert.match(planned.changed.find(x=>x.path==='lib/env.ts').content,/CHUTES_API_KEY: z\.string\(\)\.optional\(\)\.default/);
  assert.match(planned.changed.find(x=>x.path==='lib/audit/actions.ts').content,/platform_admin\.ai_default_updated/);
});
test('blob, stage, release ou registro alterados bloqueiam sem gerar patch parcial',()=>{
  const f=sourceFixture();
  assert.throws(()=>planChanges({...f,targetSha:'0'.repeat(40),adapters:FIXTURE_ADAPTERS}),/UNVERIFIED_CLEAN_BASE_REPORT/);
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,adapters:FIXTURE_ADAPTERS,report:{...f.report,stage:'VALIDATED'}}),/UNVERIFIED_CLEAN_BASE_REPORT/);
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,adapters:FIXTURE_ADAPTERS,officialBlobByPath:{...f.officialBlobByPath,'lib/env.ts':'1'.repeat(40)}}),/OFFICIAL_BLOB_CHANGED/);
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,adapters:FIXTURE_ADAPTERS,sourceByPath:{...f.sourceByPath,'lib/env.ts':'different upstream'}}),/ADAPTER_ANCHOR_MISMATCH/);
  const altered={...f.report,review:f.report.review.filter(x=>x.path!=='package.json'),counts:{...f.report.counts,conflicts:f.report.review.length-1}};
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,adapters:FIXTURE_ADAPTERS,report:altered}),/ADAPTER_OUTSIDE_REVIEW/);
});
test('âncora duplicada ou modificada falha fechada',()=>{
  const a=ADAPTERS.find(x=>x.path==='lib/env.ts');
  const orig=a.edits[0][0];
  assert.throws(()=>adaptText(orig+'\n'+orig,a),/ADAPTER_ANCHOR_MISMATCH/);
  assert.throws(()=>adaptText('upstream mudou a linha',a),/ADAPTER_ANCHOR_MISMATCH/);
});

test('AgentForm mantém grants ELUS e preserva o fonte oficial pinado',()=>{
  const adapter=ADAPTERS.find((x)=>x.kind==='agent_form_managed');
  assert.ok(adapter);
  assert.equal(adapter.officialBlob,'956e6ff33a369e2a9a7f5df3c8aae81125b49992');
  assert.equal(adapter.edits.length,25);
  const additions=adapter.edits.map(([,v])=>v).join('\n');
  for(const guard of ['AUTONOMIA_IA_PADRAO','autonomiaTecnica','modeloPadrao','credencialPadrao',
       'autonomia.provider','autonomia.model','autonomia.credentials','autonomia.operator_model','elus-ia-gerenciada'])
    assert.ok(additions.includes(guard),'falta controle técnico: '+guard);
  for(const [before,after] of adapter.edits){
    assert.notEqual(before,after);
    assert.equal(adaptText(before,{path:adapter.path,edits:[[before,after]]}),after);
  }
});

test('Dicionário ELUS insere 48 entradas sem suprimir o catálogo da v1.108',()=>{
  const adapter=ADAPTERS.find((a)=>a.kind==='i18n_elus_entries');
  assert.ok(adapter);
  assert.equal(adapter.officialBlob,'7884118824fb6fb17b420e9038e1ede60dbe33b6');
  assert.equal(adapter.edits.length,1);
  const [needle, replacement]=adapter.edits[0];
  assert.ok(needle.startsWith('};\n\n/**'));
  assert.match(needle,/Traduz, ou devolve o próprio texto/);
  const keys=[...replacement.matchAll(/^  ("[^"]+"):\s*\{\s*es:/gm)].map((m)=>JSON.parse(m[1]));
  assert.equal(keys.length,48);
  assert.equal(new Set(keys).size,48,'nenhuma tradução ELUS pode repetir chave');
  assert.ok(keys.includes('IA ELUS360 gerenciada'));
  assert.ok(keys.includes('Inteligência artificial ELUS360'));
  const original='  ...TEXTOS_CADENCIAS,\n'+needle;
  const applied=adaptText(original,adapter);
  assert.match(applied,/\.\.\.TEXTOS_CADENCIAS,/);
  assert.match(applied,/Inteligência artificial ELUS360/);
  assert.match(applied,/Traduz, ou devolve o próprio texto/);
  assert.throws(()=>adaptText(original+needle,adapter),/ADAPTER_ANCHOR_MISMATCH/);
});

test('reconciliador mantém timeout oficial de 45min e não aceita timeout aninhado no CI',()=>{
  const adapter=ADAPTERS.find(x=>x.kind==='ci_timeout_same_step');
  assert.ok(adapter);
  assert.equal(adapter.officialBlob,'82a077ad8897ccf96a6dae09f88b1e8688aab655');
  assert.equal(adapter.edits.length,4);
  const additions=adapter.edits.map(([,v])=>v).join('\n');
  assert.ok(additions.includes('temTimeoutDoMesmoPasso'));
  assert.ok(additions.includes('timeoutNoRecuoDaAction'));
  assert.ok(additions.includes('aninhado'));
  assert.ok(additions.includes('no mesmo passo'));
  for(const [original,updated] of adapter.edits) {
    assert.notEqual(original,updated);
    assert.equal(adaptText(original,{path:adapter.path,edits:[[original,updated]]}),updated);
  }
  assert.equal(adapter.edits.some(([,v])=>v.includes('minutos: 30,')),false);
});

test('distribuição: build local exige pedido expresso, preservando fonte oficial e origem ELUS',()=>{
  const fixtureNamespace='ghcr.io/'+'oaranha';
  const official=[
    'arquitetura_suportada_pelo_kit() {',
    '  case "${1:-}" in x86_64|amd64|aarch64|arm64) return 0 ;; *) return 1 ;; esac',
    '}',
    'veredito_da_arquitetura() {',
    '  case "\${1:-}" in x86_64|amd64) printf amd64 ;; *) printf nao_suportada ;; esac',
    '}',
    'verificar_arquitetura_do_kit() {',
    '  arquitetura_suportada_pelo_kit "$(uname -m)"',
    '}',
    'imagem_waha_padrao_para_host() {',
    '  case "$(uname -m)" in aarch64|arm64) printf arm-waha ;; *) printf x86-waha ;; esac',
    '}',
    'preflight_plataforma_atualizacao() {',
    '  preflight_imagens_crm "$1" "$2" || return 1',
    '}',
    'veredito_das_imagens_da_release() {',
    '  local versao="${1:-}" img total=0 achadas=0',
    '  versao="${versao#v}"',
    '  for img in "$IMG_APP" "$IMG_WORKER" "$IMG_SCHEDULER" "$IMG_VOICE_AGENT"; do',
    '    if com_prazo 20 docker buildx imagetools inspect "${img}:${versao}" >/dev/null 2>&1; then',
    '      achadas=$((achadas + 1))',
    '    fi',
    '  done',
    '  printf prontas',
    '}',
    'build_local_pedido() {',
    '  test "${DESKCOMM_BUILD_LOCAL:-}" = 1',
    '}',
    'build_local_permitido() {',
    '  return 0',
    '}',
    'construir_aqui_e_subir() {',
    '  dc -f "$COMPOSE_BUILD" build && dc -f "$COMPOSE_BUILD" up -d',
    '}',
    'IMG_NS="'+fixtureNamespace+'"',
    'elus360_origem_confiavel() { return 0; }',
    '# --no-build',
  ].join('\n')+'\n';
  const merged=official
    .replace('x86_64|amd64|aarch64|arm64','x86_64|amd64')
    .replace('  return 0\n}\nconstruir_aqui_e_subir', '  return 1\n}\nconstruir_aqui_e_subir');
  const result=composeOptionalBuildPolicy(merged,official,fixtureNamespace);
  assert.match(result,/x86_64\|amd64\|aarch64\|arm64/);
  assert.match(result,/aarch64\|arm64\) printf 'arm64'/);
  assert.match(result,/exige Linux amd64 ou arm64/);
  assert.match(result,/DESKCOMM_BUILD_LOCAL:-/);
  assert.match(result,/build_local_permitido\(\) \{\n  build_local_pedido\n\}/);
  assert.match(result,/construir_aqui_e_subir\(\) \{\n  if ! build_local_pedido; then/);
  assert.ok(result.includes('IMG_NS="'+fixtureNamespace+'"'));
  assert.match(result,/preflight_imagens_crm/);
  assert.match(result,/plataforma=linux\/arm64/);
  assert.match(result,/manifesto_tem_plataforma/);
  assert.doesNotMatch(result,/linux\/amd64 exclusivo/);
  assert.throws(()=>composeOptionalBuildPolicy(merged.replace('IMG_NS="'+fixtureNamespace+'"','IMG_NS="ghcr.io/other"'),official,fixtureNamespace),/PROVENANCE_MISSING/);
  assert.throws(()=>composeOptionalBuildPolicy(merged.replace('construir_aqui_e_subir()', 'funcao_renomeada()'),official,fixtureNamespace),/FUNCTION_ANCHOR/);
});
