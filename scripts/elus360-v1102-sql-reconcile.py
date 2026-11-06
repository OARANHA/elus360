#!/usr/bin/env python3
"""Rebuild the ELUS360 v1.102 baseline from the official baseline + verified ELUS appendix.

No production DB access, no edits to historic migration files. Fail closed when
fork baseline contains edits other than an exact append to official v1.94.
"""
from __future__ import annotations
import hashlib
import json
import subprocess
from pathlib import Path

A="ba24d4d366b7caf056b88553e0ed434cb0fb46de"
B="749aaf8fbb25b46dddd9138219e2ac032cc83336"
C="4b5815721710c9b1e99078322593838fda1ee740"
FILE="supabase/baseline.sql"
MIGRATION="supabase/migrations/20261028235959_9037_elus_ai_autonomy_guarded.sql"

def git(*a):
    return subprocess.run(["git",*a],check=True,capture_output=True).stdout

def read(ref,path):
    return git("show",f"{ref}:{path}")

def hashbytes(data):
    return hashlib.sha256(data).hexdigest()

def main():
    # Fetch only the pinned official tag. No rebase and no mutation of upstream.
    git("fetch","--no-tags","https://github.com/melgarafael/DeskcommCRM.git",
        "+refs/tags/v1.94.0:refs/tags/elus-source-v1.94.0",
        "+refs/tags/v1.102.0:refs/tags/elus-source-v1.102.0")
    sha_a=git("rev-parse","refs/tags/elus-source-v1.94.0^{commit}").decode().strip()
    sha_c=git("rev-parse","refs/tags/elus-source-v1.102.0^{commit}").decode().strip()
    if (sha_a,sha_c)!=(A,C):
        raise SystemExit("BLOCKED: official release SHAs differ from the verified source")
    if git("status","--porcelain").strip():
        raise SystemExit("BLOCKED: dirty working tree")
    old=read(A,FILE)
    fork=read(B,FILE)
    official=read(C,FILE)
    migration=read("HEAD",MIGRATION)
    if not fork.startswith(old):
        raise SystemExit("BLOCKED: ELUS v1.94 baseline is not a pure append to official baseline")
    appendix=fork[len(old):]
    if not (len(migration)<=len(appendix)<=len(migration)+500):
        raise SystemExit("BLOCKED: unexpected ELUS baseline appendix size")
    # The original SQL must survive verbatim, not a rewrite of historic migrations.
    if migration not in appendix:
        raise SystemExit("BLOCKED: ELUS migration is not present unchanged inside appendix")
    signatures=(b"fn_elus_ai_version_patch_guarded",b"fn_elus_ai_draft_save_guarded",
                b"fn_guard_organizations_ai_autonomy")
    if not all(s in appendix for s in signatures):
        raise SystemExit("BLOCKED: missing mandatory ELUS guard in appendix")
    if any(s in official for s in signatures):
        raise SystemExit("BLOCKED: official schema already contains colliding ELUS function")
    final=official+appendix
    if not final.startswith(official) or not final.endswith(appendix):
        raise SystemExit("BLOCKED: baseline join invariant")
    Path(FILE).write_bytes(final)
    reportpath=Path("docs/elus360/upgrade-v1102-candidate.json")
    report=json.loads(reportpath.read_text(encoding="utf-8"))
    report["baseline_status"]="CONSTRUCTED_NOT_DATABASE_VALIDATED"
    report["baseline_official_sha256"]=hashbytes(official)
    report["baseline_elus_appendix_sha256"]=hashbytes(appendix)
    report["baseline_combined_sha256"]=hashbytes(final)
    report["baseline_bytes"]=len(final)
    report["tests"]="PENDING"
    reportpath.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k.startswith("baseline_")},indent=2))

if __name__=="__main__":
    main()
