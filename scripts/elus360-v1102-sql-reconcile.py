#!/usr/bin/env python3
"""Read-only verification of official v1.102.0 baseline + unmodified ELUS SQL.

No historical migration edits, no database connections and no working-tree writes.
GitHub Actions checks the committed file byte-for-byte against the recombination.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

BASE = "ba24d4d366b7caf056b88553e0ed434cb0fb46de"
FORK = "749aaf8fbb25b46dddd9138219e2ac032cc83336"
TARGET = "4b5815721710c9b1e99078322593838fda1ee740"
FILE = "supabase/baseline.sql"
MIGRATION = "supabase/migrations/20261028235959_9037_elus_ai_autonomy_guarded.sql"
GUARDS = (
    b"fn_elus_ai_version_patch_guarded",
    b"fn_elus_ai_version_create_guarded",
    b"fn_elus_ai_agent_create_guarded",
    b"fn_elus_ai_draft_save_guarded",
    b"fn_elus_ai_credential_write_guarded",
    b"fn_guard_organizations_ai_autonomy",
)


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def read(ref: str, path: str) -> bytes:
    return git("show", f"{ref}:{path}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise SystemExit("BASELINE NO-GO: " + reason)


def main() -> None:
    require(not git("status", "--porcelain").strip(), "worktree has changes before SQL check")
    # Fetch only the tagged commits; peel and compare against the independently pinned SHAs.
    git(
        "fetch", "--no-tags", "--depth=1",
        "https://github.com/melgarafael/DeskcommCRM.git",
        "+refs/tags/v1.94.0:refs/tags/elus-source-v1.94.0",
        "+refs/tags/v1.102.0:refs/tags/elus-source-v1.102.0",
    )
    old_ref = git("rev-parse", "refs/tags/elus-source-v1.94.0^{commit}").decode().strip()
    new_ref = git("rev-parse", "refs/tags/elus-source-v1.102.0^{commit}").decode().strip()
    require((old_ref, new_ref) == (BASE, TARGET), "official tag provenance changed")
    require(bool(git("cat-file", "-e", f"{FORK}^{{commit}}") == b""), "fork anchor missing")

    old = read(BASE, FILE)
    fork = read(FORK, FILE)
    upstream = read(TARGET, FILE)
    elus_migration = read(FORK, MIGRATION)
    committed = Path(FILE).read_bytes()

    require(fork.startswith(old), "v1.94 fork baseline is not an exact official prefix")
    appendix = fork[len(old):]
    require(len(elus_migration) <= len(appendix) <= len(elus_migration) + 500,
            "ELUS appendix has unexpected size")
    require(elus_migration in appendix, "ELUS migration is not preserved verbatim")
    for symbol in GUARDS:
        require(symbol in appendix, "ELUS guard missing from appendix: " + symbol.decode())
        require(symbol not in upstream, "ELUS SQL collides with official upstream: " + symbol.decode())

    expected = upstream + appendix
    require(committed == expected,
            "committed baseline does not equal exact official v1.102 baseline + ELUS v1.94 appendix")

    report = json.loads(Path("docs/elus360/upgrade-v1102-candidate.json").read_text())
    hashes = {
        "baseline_official_sha256": sha256(upstream),
        "baseline_elus_appendix_sha256": sha256(appendix),
        "baseline_combined_sha256": sha256(expected),
    }
    for field, expected_hash in hashes.items():
        require(report.get(field) == expected_hash, "manifest checksum mismatch: " + field)
    require(report.get("baseline_bytes") == len(expected), "manifest length mismatch")
    print(json.dumps({
        "status": "SOURCE_PARITY_PASS_POSTGRESQL_NOT_YET_PROVEN",
        "v194": BASE,
        "v1102": TARGET,
        "bytes": len(expected),
        "migration_byte_exact": True,
        "guards_present": len(GUARDS),
        **hashes,
    }, indent=2))


if __name__ == "__main__":
    main()
