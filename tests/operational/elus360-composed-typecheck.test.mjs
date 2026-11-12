import test from 'node:test';
import assert from 'node:assert/strict';
import { planTypecheck, sharedVitestTypeRoots } from '../../scripts/elus360-composed-typecheck.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('compartilha a raiz de tipos Vitest em TODO shard sem remover ou duplicar ownership',()=>{
  const source=[...roots,'tests/setup/vitest.setup.ts'];
  const parts=planTypecheck({fullRoots:source,productionRoots:roots.slice(0,3),
    declarations:['next-env.d.ts','tests/fixtures.d.ts'],
    sharedTestRoots:['tests/setup/vitest.setup.ts'],shards:3});
  const shared='tests/setup/vitest.setup.ts';
  assert.equal(parts.length,4);
  assert.ok(parts.slice(1).every(p=>p.files.includes(shared)));
  assert.ok(!parts[0].files.includes(shared));
  assert.equal(parts.flatMap(p=>p.owned).filter(x=>x===shared).length,1);
  assert.equal(new Set(parts.flatMap(p=>p.owned)).size,source.length);
});
test('um setup duplicado, ausente ou de produção não autoriza o shard',()=>{
  assert.throws(()=>planTypecheck({fullRoots:roots,productionRoots:roots.slice(0,3),
    declarations:[],sharedTestRoots:['nao-existe.ts']}),/INVALID_ROOT_SETS/);
  assert.throws(()=>planTypecheck({fullRoots:roots,productionRoots:roots.slice(0,3),
    declarations:[],sharedTestRoots:['src/a.ts']}),/INVALID_ROOT_SETS/);
  assert.throws(()=>planTypecheck({fullRoots:roots,productionRoots:roots.slice(0,3),
    declarations:[],sharedTestRoots:['tests/a.test.ts','tests/a.test.ts']}),/INVALID_ROOT_SETS/);
});
test('descobre setup do Vitest e falha fechado se import de matchers sumir',()=>{
  const dir=mkdtempSync(join(tmpdir(),'elus-vitest-type-roots-'));
  const setup='tests/setup/vitest.setup.ts';
  try{
    mkdirSync(join(dir,'tests/setup'),{recursive:true});
    writeFileSync(join(dir,'vitest.config.ts'),
      'test: { setupFiles: ["./tests/setup/vitest.setup.ts"], globals: true }\n');
    writeFileSync(join(dir,setup),'import "@testing-library/jest-dom/vitest";\n');
    assert.deepEqual(sharedVitestTypeRoots(dir,[setup,'tests/example.test.ts'],[]),[setup]);
    assert.throws(()=>sharedVitestTypeRoots(dir,[setup], [setup]),/NOT_EXTRA_ROOT/);
    writeFileSync(join(dir,setup),'import { expect } from "vitest";\n');
    assert.throws(()=>sharedVitestTypeRoots(dir,[setup],[]),/TYPE_IMPORT_MISSING/);
    writeFileSync(join(dir,'vitest.config.ts'),'test: { globals: true }\n');
    assert.throws(()=>sharedVitestTypeRoots(dir,[setup],[]),/SETUP_UNVERIFIED/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
