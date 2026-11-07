#!/usr/bin/env python3
"""ELUS360 release attestation and rollback planner (offline, read-only).

No HTTP/Docker/SQL/git calls; only verifies supplied artifacts. A positive
result is NOT permission to publish, merge or deploy. Used by disposable tests.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO = "OARANHA/elus360"
SOURCE = "https://github.com/OARANHA/elus360"
NAMESPACE = "ghcr.io/oaranha"
NAMES = ("elus360", "elus360-worker", "elus360-scheduler", "elus360-voice-agent")
PLATFORMS = ("linux/amd64",)
SHA = re.compile(r"^[a-f0-9]{40}$")
DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
VERSION = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


class DistributionRejected(ValueError):
    """A candidate failed its release or rollback security gate."""


def require(value: bool, reason: str) -> None:
    if not value:
        raise DistributionRejected(reason)


def record(obj: Any, label: str) -> dict[str, Any]:
    require(isinstance(obj, dict), f"{label}: expected object")
    return obj


def release_attestation(release: Any, manifest: Any, expected_tag: str, expected_sha: str) -> dict[str, str]:
    """Validate offline evidence, not an unverified registry query."""
    rel = record(release, "release")
    m = record(manifest, "manifest")
    require(bool(VERSION.fullmatch(expected_tag)), "tag must be immutable numeric vX.Y.Z")
    require(bool(SHA.fullmatch(expected_sha)), "expected commit must be 40-char lowercase SHA")
    version = expected_tag[1:]
    require(rel.get("repository") == REPO, "foreign release repository")
    require(rel.get("tag_name") == expected_tag, "release tag mismatch")
    require(rel.get("sha") == expected_sha, "release commit mismatch")
    require(rel.get("draft") is False and rel.get("prerelease") is False, "unpublished release")
    require(rel.get("contained_in_main") is True, "tag ancestry not verified")
    require(rel.get("approved") is True, "release approval not recorded")
    require(rel.get("published_at") not in (None, ""), "release publication not attested")
    require(m.get("repository") == REPO and m.get("tag") == version, "foreign image manifest")
    images = record(m.get("images"), "images")
    require(set(images) == set(NAMES), "four-image manifest incomplete or has unexpected packages")
    for name in NAMES:
        img = record(images[name], name)
        require(img.get("repository") == f"{NAMESPACE}/{name}", f"{name}: foreign image registry")
        require(img.get("source") == SOURCE, f"{name}: wrong OCI source")
        require(img.get("revision") == expected_sha, f"{name}: image revision mismatch")
        require(img.get("version") == version, f"{name}: version mismatch")
        require(bool(DIGEST.fullmatch(str(img.get("digest", "")))), f"{name}: invalid manifest digest")
        arch = record(img.get("platforms"), f"{name}: platforms")
        require(set(arch) == set(PLATFORMS), f"{name}: platform set must be exactly linux/amd64")
        for platform in PLATFORMS:
            entry = record(arch[platform], f"{name}: {platform}")
            require(bool(DIGEST.fullmatch(str(entry.get("digest", "")))),
                    f"{name}: {platform} digest missing")
            require(entry.get("revision") == expected_sha, f"{name}: {platform} revision mismatch")
    return {"release": expected_tag, "sha": expected_sha, "repository": REPO, "verified_images": "4"}


def rollback_plan(previous: Any, attested: Any, schema_strategy: str) -> dict[str, Any]:
    """Compute a plan without writing pins, running migrations or touching Docker."""
    prior = record(previous, "previous")
    new = record(attested, "attested")
    require(schema_strategy in ("forward_compatible", "isolated_restore_verified"),
            "schema rollback requires verified forward compatibility or isolated restore")
    require(prior.get("repository") == REPO, "foreign previous installation requires manual migration")
    require(bool(SHA.fullmatch(str(prior.get("revision", "")))), "previous revision unverified")
    pins = record(prior.get("pins"), "previous pins")
    require(set(pins) == set(NAMES), "previous checkpoint must contain all four services")
    for name in NAMES:
        require(isinstance(pins[name], str)
                and pins[name].startswith(f"{NAMESPACE}/{name}@")
                and bool(DIGEST.fullmatch(pins[name].split("@", 1)[-1])),
                f"{name}: previous image must be ELUS digest pin")
    require(new.get("repository") == REPO and bool(SHA.fullmatch(str(new.get("sha", "")))),
            "new release attestation missing")
    require(new.get("verified_images") == "4", "new four-image verification missing")
    # The database is intentionally NEVER modified by this planner.
    return {
        "status": "plan_only",
        "candidate_sha": new["sha"],
        "previous_sha": prior["revision"],
        "restore_pins": {name: pins[name] for name in NAMES},
        "schema_strategy": schema_strategy,
        "database_rollback_performed": False,
        "auto_apply": False,
        "requires_separate_human_approval": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--previous", type=Path)
    parser.add_argument("--schema-strategy", default="")
    opts = parser.parse_args(argv)
    try:
        release = json.loads(opts.release.read_text(encoding="utf-8"))
        manifest = json.loads(opts.manifest.read_text(encoding="utf-8"))
        attested = release_attestation(release, manifest, opts.tag, opts.sha)
        if opts.previous is not None:
            previous = json.loads(opts.previous.read_text(encoding="utf-8"))
            output = rollback_plan(previous, attested, opts.schema_strategy)
        else:
            output = {"status": "verified_offline_only", **attested, "auto_apply": False}
    except (DistributionRejected, OSError, ValueError) as exc:
        print(f"ELUS_DISTRIBUTION_NO_GO: {exc}", file=sys.stderr)
        return 3
    print(json.dumps(output, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
