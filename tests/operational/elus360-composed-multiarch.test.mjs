import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { composeOptionalPlatformManifest } from '../../scripts/elus360-clean-base-adapters.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const path=resolve(ROOT,'hostgator-setup-kit/_manifestos.sh');
const original=readFileSync(path,'utf8');
// Este checkout já contém o manifesto composto; o adaptador é para fonte oficial não adaptada.
const composed=original;
const common=readFileSync(resolve(ROOT,'hostgator-setup-kit/_common.sh'),'utf8');
const imgNs=/^IMG_NS="([^"]+)"$/m.exec(common)?.[1];
assert.ok(imgNs,'IMG_NS do fork ausente');
const FAKE_REGISTRY=[
  'docker() {',
  '  test "$1" = buildx && test "$2" = imagetools && test "$3" = inspect || return 99',
  '  if [ "$4" = "--raw" ]; then',
  '    test "$TEST_REGISTRY_FAIL" != 1 || return 1',
  '    printf \'%s\\n\' \'{"schemaVersion":2,"manifests":[{"platform":{"os":"linux","architecture":"amd64"}}]}\'',
  '  elif [ "$4" = "--format" ]; then',
  '    printf \'%s\\n\' "$TEST_PLATFORMS"',
  '  else return 99; fi',
  '}',
  'ghcr_status() { printf \'%s\' "$TEST_HTTP_STATUS"; }',
  'IMG_NS='+imgNs,
].join('\n');
function run(script,env={}) {
  return spawnSync('bash',['-c',composed+'\n'+FAKE_REGISTRY+'\n'+script],{
    encoding:'utf8',timeout:10000,
    env:{...process.env,TEST_PLATFORMS:'linux/amd64\nlinux/arm64',TEST_REGISTRY_FAIL:'0',TEST_HTTP_STATUS:'200',...env}
  });
}
test('T06-C: apenas manifesto de fork pinado pode ser adaptado',()=>{
  assert.match(composed,/linux\/amd64\|linux\/arm64/);
  assert.throws(()=>composeOptionalPlatformManifest(original.replace('elus360-voice-agent','voice-another')),
    /ELUS_PLATFORM_MANIFEST_ANCHOR_CHANGED|ELUS_PLATFORM_MANIFEST_SOURCE_CONTRACT_MISSING/);
  assert.throws(()=>composeOptionalPlatformManifest(composed),
    /ELUS_PLATFORM_MANIFEST_ANCHOR_CHANGED/);
  assert.equal(spawnSync('bash',['-n'],{input:composed,encoding:'utf8'}).status,0);
});
test('T06-C: Linux amd64 e arm64 exigem manifesto OCI das quatro imagens',()=>{
  for(const arch of ['x86_64','amd64','aarch64','arm64']){
    const platform=arch==='x86_64'||arch==='amd64'?'linux/amd64':'linux/arm64';
    const v=run('p="$(plataforma_oci_do_host "$ARCH" Linux)" || exit 1; test "$p" = "$EXPECTED" && preflight_imagens_crm 1.108.0 "$p"',{
      ARCH:arch,EXPECTED:platform
    });
    assert.equal(v.status,0,'arch '+arch+' status '+v.status+': '+v.stderr);
  }
});
test('T06-C: falha fechada para SO não Linux, arquitetura errada e registry recusado',()=>{
  assert.notEqual(run('plataforma_oci_do_host arm64 Darwin').status,0);
  assert.notEqual(run('plataforma_oci_do_host riscv64 Linux').status,0);
  assert.notEqual(run('preflight_imagens_crm 1.108.0 linux/riscv64').status,0);
  assert.notEqual(run('preflight_imagens_crm 1.108.0 linux/arm64',{TEST_PLATFORMS:'linux/amd64'}).status,0);
  assert.notEqual(run('preflight_imagens_crm 1.108.0 linux/arm64',{TEST_PLATFORMS:'linux/amd64\nlinux/arm64\nlinux/arm64'}).status,0);
  assert.notEqual(run('preflight_imagens_crm 1.108.0 linux/arm64',{TEST_HTTP_STATUS:'403'}).status,0);
  assert.notEqual(run('preflight_imagens_crm 1.108.0 linux/arm64',{TEST_REGISTRY_FAIL:'1'}).status,0);
});
test('T06-C: preflight apenas consulta OCI, sem criar ou construir containers',()=>{
  const success=run('preflight_imagens_crm 1.108.0 linux/arm64');
  assert.equal(success.status,0,success.stderr);
  assert.doesNotMatch(composed,/\bdocker\s+(?:build|run|push|pull|compose)\b/);
  assert.match(composed,/manifesto_tem_plataforma "\$ref" "\$plataforma" compativel/);
  assert.match(composed,/ghcr_status "\$img" "\$tag"/);
});
