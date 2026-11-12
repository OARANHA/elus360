import test from 'node:test';
import assert from 'node:assert/strict';
import { planTypecheck } from '../../scripts/elus360-composed-typecheck.mjs';

const roots=['next-env.d.ts','src/a.ts','src/b.tsx','tests/a.test.ts',
  'tests/b.test.ts','lib/c.test.ts','tests/fixtures.d.ts'];

test('cobre cada raiz declarada no tsconfig.typecheck exatamente uma vez',()=>{
  const parts=planTypecheck({fullRoots:roots,productionRoots:roots.slice(0,3),
    declarations:['next-env.d.ts','tests/fixtures.d.ts'],shards:2});
  assert.equal(parts.length,3);
  const counted=new Map();
  for(const p of parts)for(const file of p.owned)
    counted.set(file,(counted.get(file)||0)+1);
  for(const file of roots)assert.equal(counted.get(file),1,'perdeu raiz: '+file);
  assert.equal(counted.size,roots.length);
  assert.ok(parts.slice(1).every(p=>p.files.includes('next-env.d.ts')));
  assert.ok(parts.slice(1).every(p=>p.files.includes('tests/fixtures.d.ts')));
  assert.equal(parts[0].name,'production');
});

test('qualquer root de produção fora do conjunto original bloqueia a execução',()=>{
  assert.throws(()=>planTypecheck({fullRoots:roots,
    productionRoots:['src/a.ts','src/NAO_EXISTE.ts'],declarations:[]}),/INVALID_ROOT_SETS/);
});
test('lista vazia, duplicada ou sem testes falha fechada',()=>{
  assert.throws(()=>planTypecheck({fullRoots:[],productionRoots:[],declarations:[]}),/INVALID_ROOT_SETS/);
  assert.throws(()=>planTypecheck({fullRoots:['src/a.ts','src/a.ts'],
    productionRoots:['src/a.ts'],declarations:[]}),/INVALID_ROOT_SETS/);
  assert.throws(()=>planTypecheck({fullRoots:['src/a.ts'],
    productionRoots:['src/a.ts'],declarations:[]}),/NO_EXTRA_TEST_ROOTS/);
});
test('rejeita declarações fora da árvore e tamanho de shard inválido',()=>{
  assert.throws(()=>planTypecheck({fullRoots:roots,productionRoots:roots.slice(0,3),
    declarations:['unknown.d.ts']}),/INVALID_ROOT_SETS/);
  assert.throws(()=>planTypecheck({fullRoots:roots,productionRoots:roots.slice(0,3),
    declarations:[],shards:0}),/BAD_SHARD_COUNT/);
});

test('particionamento é determinístico e distribui testes por tamanho',()=>{
  const f={fullRoots:roots,productionRoots:roots.slice(0,3),
    declarations:['next-env.d.ts','tests/fixtures.d.ts'],shards:2,
    sizeOf:x=>x==='tests/a.test.ts'?100:1};
  const one=planTypecheck(f),two=planTypecheck(f);
  assert.deepEqual(one,two);
  assert.ok(one.slice(1).every(p=>p.owned.length>0));
  assert.equal(one.slice(1).flatMap(p=>p.owned).length,3);
});
