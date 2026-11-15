#!/usr/bin/env python3
"""Proof of v1.108.0 official baseline + ELUS append before the final anon ACL sweep.

Pure inspection of checkout and two immutable Git objects. Never changes DB, SQL,
source refs or release. Can be run on CI after checkout of an exact PR SHA.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

OFFICIAL_TAG = 'v1.108.0'
OFFICIAL_SHA = '0b60c5abaace17922ae645399a6a6183a5f5c357'
BASELINE = Path('supabase/baseline.sql')
MIGRATIONS = [
    'supabase/migrations/20261028235959_9900_elus_ai_autonomy_guarded.sql',
    'supabase/migrations/20261106140000_9901_elus_ai_agent_create_fields.sql',
    'supabase/migrations/20261106160000_9902_elus_molde_chutes_pt409.sql',
    'supabase/migrations/20261106170000_9903_elus_agent_version_columns.sql',
]
ACL_BEGIN = b'-- ---- VARREDURA anon:'
ACL_END = '-- ---- Criador provisório sai'.encode()


def fail(message: str):
    raise SystemExit('ELUS_V1108_BASELINE_NO_GO: ' + message)


def git(*args: str) -> bytes:
    return subprocess.run(['git', *args], capture_output=True, check=True).stdout


def reconcile(official: bytes, custom: list[bytes]) -> bytes:
    begin = official.find(ACL_BEGIN)
    end = official.find(ACL_END, begin)
    if begin < 0 or end <= begin or official.count(ACL_BEGIN) != 1:
        fail('ACL sweep missing or not unique in official source')
    sweep = official[begin:end]
    if b'anon' not in sweep.lower() or b'revoke' not in sweep.lower():
        fail('ACL sweep no longer carries the security revocations')
    source = official[:begin] + official[end:]
    for path, data in zip(MIGRATIONS, custom, strict=True):
        if not data.startswith(b'-- manifest:'):
            fail('migration missing manifest: ' + path)
        source += ('\n-- ELUS360_FORWARD_BEGIN ' + path + '\n').encode() + data
        source += ('\n-- ELUS360_FORWARD_END ' + path + '\n').encode()
    return source + sweep


def verify_security(sql: bytes):
    pos = sql.find(ACL_BEGIN)
    if pos < 0 or sql.count(ACL_BEGIN) != 1:
        fail('final ACL sweep missing or duplicated')
    remainder = sql[pos:]
    if re.search(rb'^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function', remainder, re.I | re.M):
        fail('new function created after final ACL sweep')
    if re.search(rb'^[ \t]*grant[ \t][^;]*\bto\b[^;]*\banon\b', remainder, re.I | re.M):
        fail('anon EXECUTE privilege granted after final sweep')
    guard_symbols = (
        b'fn_guard_organizations_ai_autonomy', b'fn_elus_ai_agent_create_guarded',
        b'fn_elus_ai_version_patch_guarded', b'fn_elus_ai_version_create_guarded',
        b'fn_elus_ai_draft_save_guarded', b'fn_elus_ai_credential_write_guarded',
    )
    for symbol in guard_symbols:
        if symbol not in sql[:pos]:
            fail('missing ELUS authorization guard: ' + symbol.decode())
    if not sql.rstrip().endswith(b'grant execute on function public.fn_update_budget_consumption() to service_role;'):
        fail('ACL sweep must be the final executable block')


def main():
    if git('status', '--porcelain').strip():
        fail('checkout dirty; cannot attest source')
    # Source the published official tag; reject a re-tag or unexpected SHA.
    git('fetch', '--no-tags', '--depth=1', 'https://github.com/melgarafael/DeskcommCRM.git',
        f'+refs/tags/{OFFICIAL_TAG}:refs/elus-v1108-official')
    actual = git('rev-parse', 'refs/elus-v1108-official^{commit}').decode().strip()
    if actual != OFFICIAL_SHA:
        fail('upstream tag commit differs from independently pinned SHA')
    official = git('show', f'{actual}:supabase/baseline.sql')
    custom = [Path(path).read_bytes() for path in MIGRATIONS]
    result = reconcile(official, custom)
    committed = BASELINE.read_bytes()
    if committed != result:
        fail('baseline differs from official v1.108 + four byte-exact ELUS migrations + final ACL sweep')
    verify_security(committed)
    print(json.dumps({
        'stage': 'ELUS_V1108_SQL_SOURCE_PARITY_PASSED_NOT_APPLIED',
        'official_commit': actual,
        'baseline_bytes': len(committed),
        'baseline_sha256': hashlib.sha256(committed).hexdigest(),
        'migration_count': len(MIGRATIONS),
        'final_acl_sweep': True,
    }, indent=2))


if __name__ == '__main__':
    main()
