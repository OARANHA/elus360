#!/usr/bin/env python3
"""ELUS360 hosted Supabase schema preflight for Portainer image upgrades.

Read-only: SELECT with limit=0 through PostgREST. Never returns tenant rows.
Exit 0 means only the listed schema contract was checked successfully;
it does NOT prove all migrations applied or authorize bypassing CI/release gates.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

CONTRACT = Path(__file__).resolve().parents[1] / "deploy" / "elus360-schema-contract.json"
IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
RELEASE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+$")


def validate_contract(contract: dict, release: str) -> dict[str, list[str]]:
    if not RELEASE.fullmatch(release):
        raise ValueError("release invalida; use vN.N.N")
    if contract.get("release") != release or contract.get("schema_version") != 1:
        raise ValueError("schema contract da release ausente ou divergente; fail closed")
    tables = contract.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise ValueError("schema contract sem tabelas")
    for name, columns in tables.items():
        if not isinstance(name, str) or not IDENTIFIER.fullmatch(name):
            raise ValueError("nome de tabela invalido")
        if not isinstance(columns, list) or not columns or any(
            not isinstance(c, str) or not IDENTIFIER.fullmatch(c) for c in columns
        ):
            raise ValueError("colunas invalidas no schema contract")
        if len(set(columns)) != len(columns):
            raise ValueError("colunas duplicadas")
    return tables


def check_schema(base_url: str, service_key: str, tables: dict[str, list[str]], opener=urlopen) -> list[str]:
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("URL do Supabase deve ser HTTPS sem usuario/query/fragmento")
    if not service_key.strip():
        raise ValueError("chave de servico ausente")
    base = base_url.rstrip("/")
    failed: list[str] = []
    for table, columns in tables.items():
        endpoint = f"{base}/rest/v1/{table}?" + urlencode({"select": ",".join(columns), "limit": 0})
        request = Request(endpoint, headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Accept": "application/json",
            "Accept-Profile": "public",
        }, method="GET")
        try:
            with opener(request, timeout=12) as response:
                if response.status not in (200, 206):
                    failed.append(f"{table}: HTTP {response.status}")
        except HTTPError as err:
            failed.append(f"{table}: HTTP {err.code}")
        except (URLError, TimeoutError, OSError):
            failed.append(f"{table}: comunicacao indisponivel")
    return failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, help="Release publicada, ex.: v1.102.0")
    parser.add_argument("--contract", type=Path, default=CONTRACT)
    args = parser.parse_args(argv)
    try:
        tables = validate_contract(json.loads(args.contract.read_text(encoding="utf-8")), args.release)
        base = os.environ.get("ELUS360_SUPABASE_URL", "")
        key = os.environ.get("ELUS360_SUPABASE_SERVICE_ROLE_KEY", "")
        failed = check_schema(base, key, tables)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"ELUS360_SCHEMA_NO_GO: {exc}", file=sys.stderr)
        return 3
    if failed:
        for failure in failed:
            print(f"ELUS360_SCHEMA_NO_GO: {failure}", file=sys.stderr)
        return 3
    print(f"ELUS360_SCHEMA_GREEN: {args.release} ({len(tables)} tabelas; consultas read-only)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
