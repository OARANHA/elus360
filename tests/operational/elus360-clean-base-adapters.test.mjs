import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ADAPTERS, OFFICIAL_TARGET, ELUS_STRUCTURAL_DOCS, keepOfficialStructuralDocument, adaptText, planChanges, composeOptionalBuildPolicy, composeOptionalInstallEntrypoint, composeOptionalUpdateEntrypoint } from '../../scripts/elus360-clean-base-adapters.mjs';

// Testes compactos incluem adaptadores de CI, E2E, instruções ELUS e demais casos;
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
test('adaptadores declarados só aceitam blob oficial fixado e conflito explícito',()=>{
  assert.equal(ADAPTERS.length,13);
  assert.equal(FIXTURE_ADAPTERS.length,10);
  const f=sourceFixture();
  const planned=planChanges({...f,targetSha:OFFICIAL_TARGET,adapters:FIXTURE_ADAPTERS});
  assert.equal(planned.changed.length,10);
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

test('T03: CI e E2E do ELUS sobre workflows oficiais preservam isolamento e seeds',()=>{
  const ci=ADAPTERS.find(a=>a.kind==='elus_ci_guard');
  const e2e=ADAPTERS.find(a=>a.kind==='elus_e2e_identity');
  assert.ok(ci && e2e);
  assert.equal(ci.officialBlob,'feb805850e0c160e3d86eb4cb5c4fbca17411fe3');
  assert.equal(e2e.officialBlob,'37aeecfd141afe326c8f984da72ca91dabf00e11');
  const c=ci.edits.map(x=>x[1]).join('\n');
  assert.match(c,/ELUS operational tests/);
  assert.match(c,/run: pnpm test:operational/);
  assert.match(c,/timeout-minutes: 45/,'manter timeout oficial do pg15/17');
  assert.match(c,/runs-on: ubuntu-24\.04/);
  assert.doesNotMatch(c,/deskcomm-proprio|CONFERENCIA_KIT_RELEASE: v1\.102/);
  const e=e2e.edits.map(x=>x[1]).join('\n');
  assert.match(e,/runs-on: ubuntu-latest/);
  assert.match(e,/seed-e2e-system-update\.ts/);
  assert.match(e,/matrix\.parte != 4/);
  for(const adapter of [ci,e2e]){
    for(const [before,after] of adapter.edits){
      assert.equal(adaptText(before,{path:adapter.path,edits:[[before,after]]}),after);
      assert.throws(()=>adaptText(before+'\n'+before,{path:adapter.path,edits:[[before,after]]}),/ADAPTER_ANCHOR_MISMATCH/);
    }
  }
});
test('T03: documentação estrutural mantém upstream apenas com caminhos e motivos pinados',()=>{
  assert.deepEqual(Object.keys(ELUS_STRUCTURAL_DOCS).sort(),['AGENTS.md','CLAUDE.md','docs/index.md']);
  for(const [path,blobs] of Object.entries(ELUS_STRUCTURAL_DOCS)){
    assert.match(blobs.officialBlob,/^[a-f0-9]{40}$/);
    assert.match(blobs.forkBlob,/^[a-f0-9]{40}$/);
    const item={path,reason:'both_changed',fork_status:'M',upstream_status:'M'};
    assert.equal(keepOfficialStructuralDocument(item),true);
    assert.equal(keepOfficialStructuralDocument({...item,reason:'deletion_or_unsupported_mode'}),false);
    assert.equal(keepOfficialStructuralDocument({...item,fork_status:'D'}),false);
  }
  assert.equal(keepOfficialStructuralDocument({path:'README.md',reason:'both_changed',fork_status:'M',upstream_status:'M'}),false);
  const f=sourceFixture();
  for(const path of Object.keys(ELUS_STRUCTURAL_DOCS))
    f.report.review.push({path,reason:'both_changed',fork_status:'M',upstream_status:'M'});
  f.report.counts.conflicts=f.report.review.length;
  const planned=planChanges({...f,targetSha:OFFICIAL_TARGET,adapters:FIXTURE_ADAPTERS});
  assert.equal(planned.officialKept.length,3);
  assert.equal(planned.remaining.length,1);
});
test('T04: README do ELUS aponta para o fork sem substituir o manual oficial completo',()=>{
  for(const kind of ['elus_install_guide','elus_repo_guide']){
    const adapter=ADAPTERS.find(a=>a.kind===kind);
    assert.ok(adapter);
    const all=adapter.edits.map(([,to])=>to).join('\n');
    assert.match(all,/OARANHA\/elus360/);
    assert.match(all,/elus360-instalar/);
  }
});

test('T06-C: entrypoints já compostos preservam opt-in e recusam reaplicar adaptador',()=>{
  const install=readFileSync(new URL('../../hostgator-setup-kit/install.sh',import.meta.url),'utf8');
  const update=readFileSync(new URL('../../hostgator-setup-kit/update.sh',import.meta.url),'utf8');
  for(const sh of [install,update]) {
    assert.equal(spawnSync('bash',['-n'],{input:sh,encoding:'utf8'}).status,0);
    assert.match(sh,/construir_aqui_e_subir "\$VERSAO_ALVO"/);
    assert.match(sh,/manifesto_tem_plataforma "\$WAHA_EFETIVA" "\$PLATAFORMA_HOST"/);
    assert.match(sh,/ELUS_DISTRIBUTION_NO_GO/);
  }
  assert.match(install,/if ! build_local_pedido && ! trio_publicado/);
  assert.match(update,/if ! build_local_pedido && ! dc pull/);
  // Evitar dupla adaptação, que criaria portões divergentes sem sinalizar erro.
  assert.throws(()=>composeOptionalInstallEntrypoint(install),/ELUS_ENTRYPOINT_CONTRACT_CHANGED/);
  assert.throws(()=>composeOptionalUpdateEntrypoint(update),/ELUS_ENTRYPOINT_CONTRACT_CHANGED/);
  assert.doesNotMatch(install,/ghcr.io\/melgarafael/);
  assert.doesNotMatch(update,/ghcr.io\/melgarafael/);
});
test('T07: release compatível reutiliza os adaptadores; contrato mudado falha fechado',()=>{
  const f=sourceFixture(),nextSha='a'.repeat(40),report={...f.report,upstream_target_sha:nextSha};
  const result=planChanges({...f,report,targetSha:nextSha,adapters:FIXTURE_ADAPTERS});
  assert.equal(result.changed.length,FIXTURE_ADAPTERS.length);
  assert.equal(result.remaining.length,1);
  assert.throws(()=>planChanges({...f,report,targetSha:nextSha,adapters:FIXTURE_ADAPTERS,officialBlobByPath:{...f.officialBlobByPath,'lib/env.ts':'0'.repeat(40)}}),/OFFICIAL_BLOB_CHANGED/);
  assert.throws(()=>planChanges({...f,report,targetSha:'b'.repeat(40),adapters:FIXTURE_ADAPTERS}),/UNVERIFIED_CLEAN_BASE_REPORT/);
});
