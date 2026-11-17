#!/usr/bin/env python3
"""Prepare an isolated ELUS360 PostgreSQL rehearsal; never run SQL or Docker.

A valid preflight is NOT a completed restore/replay, and never authorizes DDL
against the operational Supabase.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "scripts/elus360-schema-catalog-readonly.sql"
BASELINE = ROOT / "supabase/baseline.sql"
MIGRATIONS = ROOT / "supabase/migrations"

# Minimum known dependencies; this list is NOT a complete migration plan.
REVIEW = (
    "20261026220000_0801_setores_de_atendimento.sql",
    "20261029091541_9043_ficha_com_varios_telefones.sql",
    "20261030004122_9048_tornar_telefone_principal.sql",
    "20261031180000_9062_fila_de_atendimento_destino_e_horario.sql",
    "20261103024120_9084_cor_da_fila.sql",
    "20261105191500_9214_conversas_do_setor.sql",
    "20261106204449_9241_marca_de_apagamento_cobre_todos_os_telefones.sql",
)

class NoGo(ValueError):
    pass

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def catalog_contract() -> set[tuple[str, str]]:
    pairs = re.findall(
        r"(?m)^\s*\('(table|column|function|policy|policy_contains|trigger|foreign_key|primary_key|index|rls)',\s*'([^']+)'",
        CATALOG.read_text(encoding="utf-8"),
    )
    if len(pairs) != 32 or len(set(pairs)) != 32:
        raise NoGo("contrato de catalogo nao possui 32 objetos unicos")
    return set(pairs)

def validate_catalog(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise NoGo("export de catalogo ausente ou symlink")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise NoGo("catalogo nao e JSON valido") from exc
    if not isinstance(data, list) or len(data) != 32:
        raise NoGo("catalogo deve conter exatamente 32 linhas")
    seen: set[tuple[str, str]] = set()
    absent: list[str] = []
    for entry in data:
        if not isinstance(entry, dict) or set(entry) != {"kind", "label", "present"}:
            raise NoGo("catalogo aceita apenas kind, label, present")
        kind, label, present = entry["kind"], entry["label"], entry["present"]
        if not isinstance(kind, str) or not isinstance(label, str) or type(present) is not bool:
            raise NoGo("tipos invalidos no catalogo")
        pair = (kind, label)
        if pair in seen:
            raise NoGo("catalogo duplicado")
        seen.add(pair)
        if not present:
            absent.append(f"{kind}:{label}")
    if seen != catalog_contract():
        raise NoGo("catalogo diverge dos 32 objetos versionados")
    return {"present": 32 - len(absent), "absent": len(absent),
            "missing_objects": sorted(absent)}

def validate_snapshot(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.suffix != ".dump":
        raise NoGo("snapshot .dump privado ausente ou symlink")
    if path.resolve().is_relative_to(ROOT):
        raise NoGo("snapshot nao pode ficar dentro do repositorio")
    size = path.stat().st_size
    with path.open("rb") as stream:
        magic = stream.read(5)
    if size < 1024 or magic != b"PGDMP":
        raise NoGo("snapshot nao parece dump custom PostgreSQL")
    return {"bytes": size, "sha256": sha256(path),
            "verified_scope": "header-only; restore e schema-only nao comprovados"}

def git_sha() -> str:
    p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                       capture_output=True, text=True, check=False, timeout=8)
    if p.returncode or not re.fullmatch("[0-9a-f]{40}", p.stdout.strip()):
        raise NoGo("checkout git nao verificavel")
    return p.stdout.strip()

def sources() -> dict:
    if not BASELINE.is_file() or BASELINE.stat().st_size < 100_000:
        raise NoGo("baseline ausente ou incompleto")
    all_files = sorted(x.name for x in MIGRATIONS.glob("*.sql"))
    if len(all_files) < 50 or any(x not in all_files for x in REVIEW):
        raise NoGo("cadeia de migrations incompleta")
    return {"baseline_sha256": sha256(BASELINE),
            "migration_files": len(all_files),
            "known_migrations_to_review": [
                {"file": x, "sha256": sha256(MIGRATIONS / x)} for x in REVIEW],
            "complete_reconciliation": "NOT PROVEN: audit entire chain and runtime"}

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["plan", "validate"], default="plan")
    parser.add_argument("--schema-snapshot", type=Path)
    parser.add_argument("--catalog-json", type=Path)
    parser.add_argument("--expected-sha")
    args = parser.parse_args(argv)
    try:
        out = sources()
        out.update({"catalog_contract": len(catalog_contract()),
                    "db_connections": 0, "sql_executed": 0, "replay_executed": False,
                    "production_mutations": 0})
        if args.mode == "plan":
            out["status"] = "PLAN_ONLY_NO_REPLAY"
        else:
            if not args.schema_snapshot or not args.catalog_json or not args.expected_sha:
                raise NoGo("validate exige snapshot, catalog-json e expected-sha")
            if not re.fullmatch("[0-9a-f]{40}", args.expected_sha) or git_sha() != args.expected_sha:
                raise NoGo("HEAD diferente do SHA de referencia")
            out["source_sha"] = args.expected_sha
            out["snapshot"] = validate_snapshot(args.schema_snapshot)
            out["catalog"] = validate_catalog(args.catalog_json)
            out["status"] = "INPUTS_VALIDATED_RESTORE_NOT_EXECUTED"
        print(json.dumps(out, indent=2, sort_keys=True))
        return 0
    except (OSError, NoGo, subprocess.TimeoutExpired) as exc:
        print("ELUS_REHEARSAL_NO_GO: " + str(exc), file=sys.stderr)
        return 3

if __name__ == "__main__":
    raise SystemExit(main())
