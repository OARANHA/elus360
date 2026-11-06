#!/usr/bin/env python3
"""Read-only verification of official v1.102.0 baseline + unmodified ELUS SQL.

No historical migration edits, no database connections and no working-tree writes.
GitHub Actions checks the committed file byte-for-byte against the recombination.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

BASE = "ba24d4d366b7caf056b88553e0ed434cb0fb46de"
FORK = "749aaf8fbb25b46dddd9138219e2ac032cc83336"
TARGET = "4b5815721710c9b1e99078322593838fda1ee740"
FILE = "supabase/baseline.sql"
ORIGINAL_MIGRATION = "supabase/migrations/20261028235959_9037_elus_ai_autonomy_guarded.sql"
RENAMED_MIGRATION = "supabase/migrations/20261028235959_9900_elus_ai_autonomy_guarded.sql"
FORWARD_MIGRATION = "supabase/migrations/20261106140000_9901_elus_ai_agent_create_fields.sql"
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
    elus_migration = read(FORK, ORIGINAL_MIGRATION)
    forward_migration = Path(FORWARD_MIGRATION).read_bytes()
    require(b"fn_elus_ai_agent_create_guarded" in forward_migration and
            b"security invoker" in forward_migration and
            b"to service_role;" in forward_migration,
            "9901 must preserve the service-only guarded RPC")
    require(not Path(ORIGINAL_MIGRATION).exists(), "legacy 9037 migration path still present")
    require(Path(RENAMED_MIGRATION).read_bytes() == elus_migration,
            "renamed 9900 migration differs from the original SQL bytes")

    # Upstream 9037 and ELUS legacy 9037 must not coexist under one number.
    # The Supabase execution identity (14-digit timestamp) was kept unchanged.
    number_paths: dict[str, list[str]] = {}
    timestamp_paths: dict[str, list[str]] = {}
    for migration in Path("supabase/migrations").glob("*.sql"):
        # Preserved upstream legacy bootstrap name predates timestamp_NNNN convention.
        if migration.name == "00001_initial_schema.sql":
            continue
        match = re.fullmatch(r"(\d{14})_(\d{4})_.+\.sql", migration.name)
        require(match is not None, "migration name violates timestamp_NNNN convention: " + migration.name)
        timestamp_paths.setdefault(match[1], []).append(migration.name)
        number_paths.setdefault(match[2], []).append(migration.name)
    for label, names in number_paths.items():
        require(len(names) == 1, "duplicate migration NNNN=" + label + ": " + ", ".join(names))
    for stamp, names in timestamp_paths.items():
        require(len(names) == 1, "duplicate migration timestamp=" + stamp + ": " + ", ".join(names))
    committed = Path(FILE).read_bytes()

    require(fork.startswith(old), "v1.94 fork baseline is not an exact official prefix")
    appendix = fork[len(old):]
    require(len(elus_migration) <= len(appendix) <= len(elus_migration) + 500,
            "ELUS appendix has unexpected size")
    require(elus_migration in appendix, "ELUS migration is not preserved verbatim")
    for symbol in GUARDS:
        require(symbol in appendix, "ELUS guard missing from appendix: " + symbol.decode())
        require(symbol not in upstream, "ELUS SQL collides with official upstream: " + symbol.decode())

    # The upstream anon ACL sweep must execute AFTER every custom ELUS function
    # in both fresh install and UPDATE. Preserve the official sweep SQL verbatim
    # and move only that contiguous block after the byte-identical ELUS appendix.
    scan_start_marker = b"-- ---- VARREDURA anon:"
    scan_end_marker = b"-- ---- Criador provis\xc3\xb3rio sai"
    scan_start = upstream.find(scan_start_marker)
    scan_end = upstream.find(scan_end_marker, scan_start)
    require(scan_start >= 0 and scan_end > scan_start, "official anon ACL sweep bounds not found")
    scan = upstream[scan_start:scan_end]
    require(b"revoke" in scan.lower() and b"anon" in scan.lower(),
            "official anon sweep has unexpected content")
    expected = upstream[:scan_start] + upstream[scan_end:] + appendix + forward_migration + scan
    require(committed == expected,
            "committed baseline must preserve upstream, untouched 9900 and byte-exact 9901 before final anon ACL sweep")
    after_sweep = committed[committed.find(scan_start_marker):]
    require(not re.search(rb"^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function", after_sweep, re.I | re.M),
            "functions created after final anon sweep")
    require(not re.search(rb"^[ \t]*grant[ \t][^;]*\bto\b[^;]*\banon\b", after_sweep, re.I | re.M),
            "grant to anon after final anon sweep")
    require(committed.count(scan_start_marker) == 1 and committed.endswith(scan),
            "anon ACL sweep must be unique and final")

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
        "migration_filename": RENAMED_MIGRATION,
        "forward_migration": FORWARD_MIGRATION,
        "migration_timestamp_unchanged": True,
        "guards_present": len(GUARDS),
        **hashes,
    }, indent=2))


if __name__ == "__main__":
    main()
