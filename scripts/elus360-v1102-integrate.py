#!/usr/bin/env python3
"""Three-way file integration: official 1.94 -> ELUS fork -> official 1.102.

Upstream-only changes are restored exactly. ELUS-only edits are preserved.
Dual edits are accepted only after a clean diff3 merge. Unresolved paths keep
their original ELUS contents and appear in the review report.
"""
from __future__ import annotations
import json, os, subprocess, tempfile
from pathlib import Path

BASE="ba24d4d366b7caf056b88553e0ed434cb0fb46de"
TARGET="4b5815721710c9b1e99078322593838fda1ee740"
MAIN="749aaf8fbb25b46dddd9138219e2ac032cc83336"
UPSTREAM="https://github.com/melgarafael/DeskcommCRM.git"

def git(*args, check=True):
    return subprocess.run(["git", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)

def entries(ref):
    result={}
    for item in git("ls-tree","-rz","--full-tree",ref).stdout.split(b"\0"):
        if item:
            meta, path = item.split(b"\t",1)
            mode,kind,sha = meta.decode("ascii").split(" ")
            if kind=="blob":
                result[path.decode("utf-8","surrogateescape")] = (mode,sha)
    return result

def blob(sha):
    return git("cat-file","blob",sha).stdout

def merge(ours_sha,base_sha,new_sha):
    contents=[blob(x) for x in [ours_sha,base_sha,new_sha]]
    if max(map(len,contents))>12000000 or any(b"\0" in x[:8192] for x in contents):
        return None
    with tempfile.TemporaryDirectory(prefix="elus-diff3-") as temp:
        paths=[str(Path(temp)/x) for x in ("ours","base","new")]
        for path,data in zip(paths,contents):
            Path(path).write_bytes(data)
        outcome=git("merge-file","-p","--diff3","-L","ELUS360","-L","Deskcomm v1.94","-L","Deskcomm v1.102",*paths,check=False)
        return outcome.stdout if outcome.returncode==0 else None

def main():
    if git("status","--porcelain").stdout.strip():
        raise SystemExit("STOP: working tree dirty")
    head=git("rev-parse","HEAD").stdout.decode().strip()
    fork_main=git("rev-parse","origin/main").stdout.decode().strip()
    if fork_main!=MAIN:
        raise SystemExit("STOP: main advanced; reconcile before applying")
    if git("merge-base","--is-ancestor",MAIN,head,check=False).returncode:
        raise SystemExit("STOP: branch is not based on verified main")
    git("fetch","--no-tags",UPSTREAM,
        "+refs/tags/v1.94.0:refs/tags/elus-source-v1.94.0",
        "+refs/tags/v1.102.0:refs/tags/elus-source-v1.102.0")
    a=git("rev-parse","refs/tags/elus-source-v1.94.0^{commit}").stdout.decode().strip()
    c=git("rev-parse","refs/tags/elus-source-v1.102.0^{commit}").stdout.decode().strip()
    if (a,c)!=(BASE,TARGET):
        raise SystemExit(f"STOP: unexpected release tags {a} -> {c}")
    A,B,C=entries(a),entries("HEAD"),entries(c)
    upstream_only=[];fork_only=[];merged=[];unresolved=[];equivalent=[];workflows_pending=[]
    for path in sorted(set(A)|set(B)|set(C)):
        old,ours,new=A.get(path),B.get(path),C.get(path)
        if old==new:
            if old!=ours: fork_only.append(path)
            continue
        if ours==old:
            if path.startswith(".github/workflows/"):
                workflows_pending.append(path)
            else:
                upstream_only.append(path)
            continue
        if ours==new:
            equivalent.append(path)
            continue
        if old and ours and new and all(x[0]!="120000" for x in (old,ours,new)):
            result=merge(ours[1],old[1],new[1])
            if result is not None:
                dest=Path(path)
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(result)
                dest.chmod(0o755 if new[0]=="100755" else 0o644)
                merged.append(path)
                continue
        unresolved.append(path)
    if upstream_only:
        with tempfile.NamedTemporaryFile(prefix="elus-paths-",delete=False) as temp:
            filename=temp.name
            temp.write(b"\0".join(x.encode("utf-8","surrogateescape") for x in upstream_only)+b"\0")
        try:
            git("restore",f"--source={c}","--staged","--worktree","--no-overlay",
                f"--pathspec-from-file={filename}","--pathspec-file-nul")
        finally:
            os.unlink(filename)
    report={
        "status":"INTEGRATED_CODE_UNVALIDATED",
        "base_tag":"v1.94.0","base_commit":a,
        "target_tag":"v1.102.0","target_commit":c,
        "fork_main":MAIN,"initial_candidate_commit":head,
        "upstream_only_applied":len(upstream_only),
        "fork_only_preserved":len(fork_only),
        "auto_merged":len(merged),
        "already_equivalent":len(equivalent),
        "merged_paths":merged,
        "unresolved":unresolved,
        "upstream_workflows_pending_review":workflows_pending,
        "production_changed":False,
        "tests":"PENDING",
    }
    dest=Path("docs/elus360/upgrade-v1102-candidate.json")
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="merged_paths"},ensure_ascii=False,indent=2))
    print("Applied actual upstream code; unresolved ELUS-overlap retained and listed.")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
