#!/usr/bin/env node
/**
 * ELUS360: TypeScript completo por processos menores, sem excluir arquivos.
 * O conjunto de raízes vem do TypeScript da árvore composta, não de glob manual.
 * O build Next.js continua sendo gate separado.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');

function rootRelative(base, filename) {
  const part=relative(base,resolve(filename));
  if (!part || part==='..' || part.startsWith('..'+sep) || isAbsolute(part))
    throw new Error('ELUS_TYPECHECK_ROOT_OUTSIDE_CANDIDATE: '+filename);
  return part.replaceAll(sep,'/');
}

export function planTypecheck({fullRoots,productionRoots,declarations,sharedTestRoots=[],shards=12,sizeOf=()=>1}) {
  if (!Number.isInteger(shards) || shards<2 || shards>32) throw new Error('ELUS_TYPECHECK_BAD_SHARD_COUNT');
  const full=new Set(fullRoots),prod=new Set(productionRoots),decl=new Set(declarations);
  const shared=new Set(sharedTestRoots);
  if (!full.size || full.size!==fullRoots.length || !prod.size || prod.size!==productionRoots.length ||
      [...prod].some(x=>!full.has(x)) || [...decl].some(x=>!full.has(x)||!x.endsWith('.d.ts')) ||
      shared.size!==sharedTestRoots.length ||
      [...shared].some(x=>!full.has(x)||prod.has(x)||decl.has(x)||!x.endsWith('.ts')))
    throw new Error('ELUS_TYPECHECK_INVALID_ROOT_SETS');
  const extras=fullRoots.filter(x=>!prod.has(x) && !decl.has(x));
  if (!extras.length) throw new Error('ELUS_TYPECHECK_NO_EXTRA_TEST_ROOTS');
  const bins=Array.from({length:Math.min(shards,extras.length)},(_,i)=>({
    name:'tests-'+String(i+1).padStart(2,'0'),owned:[],weight:0
  }));
  for(const item of [...extras].sort((a,b)=>(sizeOf(b)-sizeOf(a))||a.localeCompare(b))) {
    const bin=bins.reduce((best,next)=>next.weight<best.weight?next:best,bins[0]);
    bin.owned.push(item);
    bin.weight+=Math.max(1,sizeOf(item));
  }
  const first=fullRoots.filter(x=>prod.has(x)||decl.has(x));
  const parts=[{name:'production',owned:first,files:first},
    ...bins.map(bin=>({name:bin.name,owned:bin.owned,files:[...new Set([...decl,...shared,...bin.owned])]}))];
  const counted=new Map();
  for(const group of parts) for(const file of group.owned)
    counted.set(file,(counted.get(file)||0)+1);
  if (counted.size!==full.size || [...full].some(x=>counted.get(x)!==1))
    throw new Error('ELUS_TYPECHECK_INCOMPLETE_ROOT_COVERAGE');
  return parts;
}

function parseConfig(ts,base,name) {
  const diagnostics=[];
  const opts=ts.getParsedCommandLineOfConfigFile(join(base,name),{},{
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic:d=>diagnostics.push(ts.flattenDiagnosticMessageText(d.messageText,'\n'))
  });
  if(!opts || opts.errors.length || diagnostics.length)
    throw new Error('ELUS_TYPECHECK_BAD_CONFIG: '+[
      ...diagnostics,...(opts?.errors||[]).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n'))
    ].join('; '));
  if(opts.options.strict!==true||opts.options.noEmit!==true)
    throw new Error('ELUS_TYPECHECK_WEAK_COMPILER_OPTIONS');
  const roots=opts.fileNames.map(file=>rootRelative(base,file)).sort();
  if(new Set(roots).size!==roots.length)throw new Error('ELUS_TYPECHECK_DUPLICATE_ROOTS');
  return roots;
}

// Vitest registra os matchers DOM por import em um setup .ts (não um .d.ts).
// TypeScript em shards não executa setupFiles: deve incluí-lo como raiz de
// contexto em TODOS os shards, ou Assertion perde toBeInTheDocument etc.
export function sharedVitestTypeRoots(candidate,all,production) {
  const source=readFileSync(join(candidate,'vitest.config.ts'),'utf8');
  const matches=[...source.matchAll(/setupFiles:\s*\[\s*["']\.\/([^"']+\.tsx?)["']\s*\]/g)];
  if(matches.length!==1)throw new Error('ELUS_TYPECHECK_VITEST_SETUP_UNVERIFIED');
  const relativePath=matches[0][1];
  const root=rootRelative(candidate,join(candidate,relativePath));
  if(!all.includes(root)||production.includes(root))
    throw new Error('ELUS_TYPECHECK_VITEST_SETUP_NOT_EXTRA_ROOT: '+root);
  const setup=readFileSync(join(candidate,root),'utf8');
  if(!/import\s+["']@testing-library\/jest-dom\/vitest["']\s*;/.test(setup))
    throw new Error('ELUS_TYPECHECK_JEST_DOM_TYPE_IMPORT_MISSING: '+root);
  return [root];
}

function save(file,obj){writeFileSync(file,JSON.stringify(obj,null,2)+'\n');}

export function run(args) {
  if(args.length!==4 || args[0]!=='--candidate'||args[2]!=='--reports'||
     !isAbsolute(args[1])||!isAbsolute(args[3]))
    throw new Error('USO: --candidate /abs/worktree --reports /abs/reports');
  const candidate=resolve(args[1]),reports=resolve(args[3]);
  if(!existsSync(join(candidate,'package.json'))||!existsSync(join(candidate,'tsconfig.typecheck.json')))
    throw new Error('ELUS_TYPECHECK_MISSING_COMPOSED_TREE');
  const ts=createRequire(join(candidate,'package.json'))('typescript');
  const all=parseConfig(ts,candidate,'tsconfig.typecheck.json');
  const prod=parseConfig(ts,candidate,'tsconfig.json');
  const declarations=all.filter(x=>x.endsWith('.d.ts'));
  const sharedTestRoots=sharedVitestTypeRoots(candidate,all,prod);
  const parts=planTypecheck({fullRoots:all,productionRoots:prod,declarations,sharedTestRoots,
    shards:12,sizeOf:file=>statSync(join(candidate,file)).size});
  const target=join(candidate,'.elus-typecheck');
  if(existsSync(target))throw new Error('ELUS_TYPECHECK_REUSE_FORBIDDEN');
  mkdirSync(target);
  mkdirSync(reports,{recursive:true});
  const report={schema_version:1,stage:'TYPES_SHARDED_NOT_VALIDATED',
    ts_version:ts.version,source_config:'tsconfig.typecheck.json',
    original_roots:all.length,production_roots:prod.length,
    extra_test_roots:all.filter(x=>!prod.includes(x)).length,
    shared_declarations:declarations.length,
    shared_test_type_context:sharedTestRoots,
    shared_type_context_in_every_test_shard:parts.slice(1).every(p=>
      sharedTestRoots.every(root=>p.files.includes(root))),
    roots_sha256:hash(all.join('\n')+'\n'),root_coverage_complete:true,shards:[]};
  for(const part of parts){
    const file='tsconfig.'+part.name+'.json',config='.elus-typecheck/'+file;
    // No change to strict, skipLibCheck, module resolution, flags or project defaults.
    // include:[] means the explicit files are the entire root-set of this shard.
    // O setup é raiz de contexto repetida, mas tem um único owner na cobertura.
    save(join(target,file),{extends:'../tsconfig.typecheck.json',
      compilerOptions:{incremental:false,noEmit:true},
      files:part.files.map(x=>'../'+x),include:[]});
    report.shards.push({name:part.name,config,owned_roots:part.owned.length,
      root_files:part.files.length,status:'pending'});
  }
  const output=join(reports,'elus360-composed-typecheck.json');
  save(output,report);
  for(const part of report.shards){
    process.stdout.write('ELUS_TYPECHECK_RUNNING '+part.name+
      ' owned='+part.owned_roots+' files='+part.root_files+'\n');
    const start=Date.now();
    const child=spawnSync('pnpm',['exec','tsc','--noEmit','-p',part.config,
      '--pretty','false','--extendedDiagnostics'],
      {cwd:candidate,env:process.env,stdio:'inherit'});
    part.duration_ms=Date.now()-start;
    part.exit_code=child.status;
    part.status=!child.error&&!child.signal&&child.status===0?'passed':'failed';
    save(output,report);
    if(part.status!=='passed'){
      report.stage='TYPES_SHARDED_FAILED';
      save(output,report);
      throw new Error('ELUS_TYPECHECK_SHARD_FAILED: '+part.name+' exit='+child.status+
        ' signal='+(child.signal||'none')+' '+(child.error?.message||''));
    }
  }
  report.stage='TYPES_SHARDED_PASSED';
  save(output,report);
  process.stdout.write('ELUS_TYPECHECK_ALL_ROOTS_CHECKED: '+all.length+
    ' roots, '+parts.length+' TypeScript processes\n');
  return report;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{run(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
