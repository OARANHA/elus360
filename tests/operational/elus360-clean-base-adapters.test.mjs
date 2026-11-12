import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, OFFICIAL_TARGET, adaptText, planChanges } from '../../scripts/elus360-clean-base-adapters.mjs';

function sourceFixture() {
  const byPath={};
  for(const adapter of ADAPTERS) {
    byPath[adapter.path]=adapter.edits.map(([needle])=>needle).join('\n// UPSTREAM_FEATURE_PRESERVED\n')+'\n';
  }
  const officialBlobByPath=Object.fromEntries(ADAPTERS.map(x=>[x.path,x.officialBlob]));
  const report={schema_version:1,stage:'PREPARED_NOT_VALIDATED',
    upstream_target_sha:OFFICIAL_TARGET,
    counts:{conflicts:ADAPTERS.length+1,staged:393},
    review:[
      ...ADAPTERS.map(a=>({path:a.path,reason:'both_changed',fork_status:'M',upstream_status:'M'})),
      {path:'app/app/ai/agents/[id]/_components/AgentForm.tsx',reason:'both_changed',fork_status:'M',upstream_status:'M'},
    ]};
  return {report,sourceByPath:byPath,officialBlobByPath};
}
test('seis adaptadores só aceitam blob oficial fixado e conflito explícito',()=>{
  assert.equal(ADAPTERS.length,6);
  const f=sourceFixture();
  const planned=planChanges({...f,targetSha:OFFICIAL_TARGET});
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
  assert.throws(()=>planChanges({...f,targetSha:'0'.repeat(40)}),/UNVERIFIED_CLEAN_BASE_REPORT/);
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,report:{...f.report,stage:'VALIDATED'}}),/UNVERIFIED_CLEAN_BASE_REPORT/);
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,officialBlobByPath:{...f.officialBlobByPath,'lib/env.ts':'1'.repeat(40)}}),/OFFICIAL_BLOB_CHANGED/);
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,sourceByPath:{...f.sourceByPath,'lib/env.ts':'different upstream'}}),/ADAPTER_ANCHOR_MISMATCH/);
  const altered={...f.report,review:f.report.review.filter(x=>x.path!=='package.json'),counts:{...f.report.counts,conflicts:f.report.review.length-1}};
  assert.throws(()=>planChanges({...f,targetSha:OFFICIAL_TARGET,report:altered}),/ADAPTER_OUTSIDE_REVIEW/);
});
test('âncora duplicada ou modificada falha fechada',()=>{
  const a=ADAPTERS.find(x=>x.path==='lib/env.ts');
  const orig=a.edits[0][0];
  assert.throws(()=>adaptText(orig+'\n'+orig,a),/ADAPTER_ANCHOR_MISMATCH/);
  assert.throws(()=>adaptText('upstream mudou a linha',a),/ADAPTER_ANCHOR_MISMATCH/);
});
