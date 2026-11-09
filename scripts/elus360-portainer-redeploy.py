#!/usr/bin/env python3
"""Fail-closed ELUS360 Portainer Git stack upgrade.

Sequence: official fork release -> live schema gate -> preserve stack Env ->
pin 3 image digests -> Portainer Git redeploy with Prune=false -> inspect
containers. No database mutations occur here: schema must be reconciled FIRST.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

REPO = "OARANHA/elus360"
def image_namespace() -> str:
    source = (Path(__file__).resolve().parents[1] / "hostgator-setup-kit" / "_common.sh").read_text(encoding="utf-8")
    match = re.search(r'^IMG_NS="(ghcr\.io/[a-z0-9_-]+)"$', source, re.MULTILINE)
    if match is None:
        raise ValueError("IMG_NS nao encontrado no kit canonico")
    return match.group(1)


IMAGE_NS = image_namespace()
PORTAINER = "https://ops-vigia.wandora.com.br"
STACK_ID = 5
ENDPOINT_ID = 3
TAG = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
PACKAGES = ("elus360", "elus360-worker", "elus360-scheduler", "elus360-voice-agent")
SERVICES = (("APP_IMAGE", "elus360", "elus-app"),
            ("WORKER_IMAGE", "elus360-worker", "elus-worker"),
            ("SCHEDULER_IMAGE", "elus360-scheduler", "elus-scheduler"))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_json(url: str, *, key: str | None = None, method: str = "GET",
              payload: dict | None = None, timeout: int = 25) -> dict | list:
    # URLs are constructed only from fixed trusted origins in this file.
    headers = {"Accept": "application/json"}
    if key:
        headers["X-API-Key"] = key
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = Request(url, headers=headers, method=method,
                  data=json.dumps(payload).encode() if payload is not None else None)
    with build_opener(NoRedirect()).open(req, timeout=timeout) as response:
        if response.status not in (200, 201, 204):
            raise ValueError(f"HTTP {response.status} from trusted provider")
        if response.status == 204:
            return {}
        return json.load(response)


def digest_refs(notes: str, tag: str) -> dict[str, str]:
    version = tag[1:]
    refs = {}
    for name in PACKAGES:
        pattern = rf"(?m)^{re.escape(IMAGE_NS)}/{re.escape(name)}:{re.escape(version)}@(sha256:[0-9a-f]{{64}})$"
        found = re.findall(pattern, notes)
        if len(found) != 1 or not DIGEST.fullmatch(found[0]):
            raise ValueError(f"release sem digest unico para {name}")
        refs[name] = f"{IMAGE_NS}/{name}:{version}@{found[0]}"
    return refs


def official_release(tag: str) -> tuple[dict[str, str], str]:
    if not TAG.fullmatch(tag):
        raise ValueError("release deve ser vN.N.N")
    release = http_json(f"https://api.github.com/repos/{REPO}/releases/tags/{tag}")
    if (release.get("tag_name") != tag or release.get("draft") is not False or
        release.get("prerelease") is not False or not release.get("published_at")):
        raise ValueError("GitHub Release nao publicada, invalida ou prerelease")
    compare = http_json(f"https://api.github.com/repos/{REPO}/compare/main...{tag}")
    if compare.get("status") not in ("behind", "identical"):
        raise ValueError("tag nao esta contida em main")
    # Only current main can be deployed by an unpinned Portainer Git main stack.
    branch = http_json(f"https://api.github.com/repos/{REPO}/branches/main")
    actual_main = branch.get("commit", {}).get("sha", "")
    # Compare API base_commit identifies the common ancestor for a tag behind main.
    # For immutable exact-deploy, resolve the tag commit through the API.
    tag_ref = http_json(f"https://api.github.com/repos/{REPO}/git/ref/tags/{tag}")
    tag_sha = tag_ref.get("object", {}).get("sha", "")
    if not re.fullmatch(r"[0-9a-f]{40}", tag_sha):
        raise ValueError("tag Git invalida")
    if tag_ref.get("object", {}).get("type") != "commit":
        raise ValueError("tags anotadas exigem validacao adicional")
    if actual_main != tag_sha:
        raise ValueError("main divergiu da release; publique uma nova release antes do GitOps")
    return digest_refs(release.get("body") or "", tag), tag_sha


def stack_environment(stack: dict, refs: dict[str, str]) -> tuple[list[dict], dict[str, str]]:
    if (stack.get("Id") != STACK_ID or stack.get("Name") != "elus" or
        stack.get("EndpointId") != ENDPOINT_ID or stack.get("Type") != 2 or
        stack.get("GitConfig", {}).get("URL") != f"https://github.com/{REPO}" or
        stack.get("GitConfig", {}).get("ReferenceName") != "refs/heads/main"):
        raise ValueError("stack fora do destino permitido")
    old = stack.get("Env")
    if not isinstance(old, list) or not all(isinstance(e, dict) and
        isinstance(e.get("name"), str) and isinstance(e.get("value"), str) for e in old):
        raise ValueError("Portainer Env incompleto; nao substituir")
    names = [e["name"] for e in old]
    if len(names) != len(set(names)):
        raise ValueError("Portainer Env contem chaves duplicadas")
    previous = {}
    changed = []
    by_var = {v: refs[package] for v, package, _ in SERVICES}
    for e in old:
        name = e["name"]
        if name in by_var:
            previous[name] = e["value"]
            changed.append({**e, "value": by_var[name]})
        else:
            changed.append(dict(e))
    if set(previous) != set(by_var):
        raise ValueError("Portainer Env nao possui todos os pins de imagem")
    for image in previous.values():
        if not re.fullmatch(rf"{re.escape(IMAGE_NS)}/[a-z0-9_-]+(?::[a-z0-9._-]+)?@sha256:[0-9a-f]{{64}}", image):
            raise ValueError("imagem atual nao tem digest OCI confiavel; interromper")
    return changed, previous


def deployed_commit_hash(stack: dict) -> str:
    """ConfigHash is the LAST deployed Git commit, not the release being deployed."""
    git_config = stack.get("GitConfig")
    deployed = git_config.get("ConfigHash") if isinstance(git_config, dict) else None
    if not isinstance(deployed, str) or not re.fullmatch(r"[0-9a-f]{40}", deployed):
        raise ValueError("Portainer nao informa SHA do ultimo deploy; bloquear atualizacao")
    return deployed


def assert_stack_unchanged(before: dict, after: dict) -> None:
    """Prevent overwriting a concurrent Portainer edit after the first preflight."""
    identity = ("Id", "Name", "EndpointId", "Type", "GitConfig", "Env")
    if any(before.get(field) != after.get(field) for field in identity):
        raise ValueError("Portainer mudou durante o preflight; reconciliar antes de atualizar")


def schema_gate(tag: str) -> None:
    gate = Path(__file__).with_name("elus360-portainer-schema-gate.py")
    result = subprocess.run([sys.executable, str(gate), "--release", tag],
                            check=False, timeout=180)
    if result.returncode != 0:
        raise ValueError("Supabase nao compativel com contrato da release; nada implantado")


def inspect_containers(key: str, refs: dict[str, str]) -> bool:
    containers = http_json(
        f"{PORTAINER}/api/endpoints/{ENDPOINT_ID}/docker/containers/json?all=1", key=key)
    for var, name, container_name in SERVICES:
        rows = [c for c in containers if f"/{container_name}" in c.get("Names", [])]
        if len(rows) != 1:
            return False
        row = rows[0]
        wanted = refs[name].split("@", 1)[1]
        if (row.get("State") != "running" or "(healthy)" not in row.get("Status", "") or
                not row.get("Image", "").endswith("@" + wanted)):
            return False
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True)
    parser.add_argument("--execute", action="store_true", help="Mutacao protegida; exige aprovacao exata")
    parser.add_argument("--pre-migration", action="store_true", help="Somente release+Portainer; sem schema, sem mutacao")
    args = parser.parse_args(argv)
    try:
        if args.execute and args.pre_migration:
            raise ValueError("nao e permitido pular schema gate durante redeploy")
        refs, sha = official_release(args.release)
        if not args.pre_migration:
            schema_gate(args.release)
        key = os.environ.get("ELUS360_PORTAINER_API_KEY", "")
        if not key:
            raise ValueError("ELUS360_PORTAINER_API_KEY ausente")
        stack = http_json(f"{PORTAINER}/api/stacks/{STACK_ID}", key=key)
        env, previous = stack_environment(stack, refs)
        actual_db = next((e["value"] for e in stack["Env"] if e["name"] == "NEXT_PUBLIC_SUPABASE_URL"), "")
        if actual_db.rstrip("/") != os.environ.get("ELUS360_SUPABASE_URL", "").rstrip("/"):
            raise ValueError("gate de schema aponta a banco diferente da stack")
        # The old deployed SHA must be valid, but naturally differs on an upgrade.
        # The target SHA is checked against GitHub main before mutation and
        # against Portainer AFTER its Git redeploy finishes.
        deployed_before = deployed_commit_hash(stack)
        print(f"ELUS360_PREFLIGHT: {args.release} SHA {sha[:12]}" if args.pre_migration else f"ELUS360_SCHEMA_GREEN: {args.release} SHA {sha[:12]}")
        for name, old in previous.items():
            # Image digests are public; never print any other Portainer variable.
            print(f"rollback {name}={old}")
        if not args.execute:
            print("PREFLIGHT_ONLY: nenhuma alteracao no Portainer")
            return 0
        if os.environ.get("ELUS360_DEPLOY_APPROVAL") != f"DEPLOY-ELUS360:{args.release}":
            raise ValueError("aprovacao exata do redeploy ausente")
        # Recheck the public main SHA immediately before changing Portainer.
        current_main = http_json(f"https://api.github.com/repos/{REPO}/branches/main")["commit"]["sha"]
        if current_main != sha:
            raise ValueError("main mudou durante o preflight; redeploy recusado")
        latest_stack = http_json(f"{PORTAINER}/api/stacks/{STACK_ID}", key=key)
        assert_stack_unchanged(stack, latest_stack)
        if deployed_commit_hash(latest_stack) != deployed_before:
            raise ValueError("SHA da stack alterado; reconciliar antes de atualizar")
        print("Atualizacao autorizada; Git redeploy Prune=false")
        http_json(f"{PORTAINER}/api/stacks/{STACK_ID}/git/redeploy?endpointId={ENDPOINT_ID}",
                  key=key, method="PUT",
                  payload={"Env": env, "PullImage": False, "Prune": False},
                  timeout=180)
        # Limited runtime verification. Never retry the mutation after a timeout.
        for _ in range(15):
            if inspect_containers(key, refs):
                deployed_after = http_json(f"{PORTAINER}/api/stacks/{STACK_ID}", key=key)
                if deployed_commit_hash(deployed_after) != sha:
                    # Portainer may accept the request before finishing the deploy.
                    # A healthy old container is not proof of the target commit.
                    time.sleep(12)
                    continue
                public_health = http_json("https://elus.wandora.com.br/api/v1/health", timeout=15)
                health = public_health.get("data", {})
                if health.get("version") != sha or health.get("status") != "healthy":
                    raise ValueError("health/version publica nao confirma SHA da release")
                print("ELUS360_IMAGES_HEALTHY: app, worker, scheduler; health/version confirmada")
                return 0
            time.sleep(12)
        raise ValueError("redeploy foi aceito, mas runtime nao convergiu; reconciliar antes de repetir")
    except HTTPError as err:
        print(f"ELUS_DISTRIBUTION_NO_GO: API HTTP {err.code}; nao repetir deploy cegamente",
              file=sys.stderr)
    except (URLError, TimeoutError, OSError, ValueError, subprocess.TimeoutExpired) as err:
        # Never print raw HTTP bodies, tokens, credentials or connection strings.
        safe = str(err) if isinstance(err, ValueError) else "erro de transporte ou timeout"
        print(f"ELUS_DISTRIBUTION_NO_GO: {safe}", file=sys.stderr)
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
