"""Offline integration harness for the ELUS360 Portainer upgrade controller.

Exercises the actual entrypoint from release verification through schema gate,
stack preflight, immutable image pins, redeploy and post-deploy checks.
All network, Supabase and Portainer calls are deliberately mocked: this is
NOT a substitute for a disposable-stack test with real PostgreSQL and Docker.
"""
from __future__ import annotations

import contextlib
import copy
import importlib.util
import io
import os
import subprocess
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "elus_redeploy_integration", ROOT / "scripts" / "elus360-portainer-redeploy.py"
)
assert SPEC is not None and SPEC.loader is not None
redeploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(redeploy)

TARGET_SHA = "a" * 40
OLD_SHA = "b" * 40
CONCURRENT_SHA = "c" * 40
TAG = "v1.102.0"
SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co"
NEW_DIGEST = "sha256:" + "1" * 64
OLD_DIGEST = "sha256:" + "2" * 64


def official_images():
    return {
        name: f"{redeploy.IMAGE_NS}/{name}:1.102.0@{NEW_DIGEST}"
        for name in redeploy.PACKAGES
    }


def initial_stack():
    return {
        "Id": 5,
        "Name": "elus",
        "Type": 2,
        "EndpointId": 3,
        "GitConfig": {
            "URL": "https://github.com/OARANHA/elus360",
            "ReferenceName": "refs/heads/main",
            "ConfigHash": OLD_SHA,
        },
        "Env": [
            {"name": "APP_IMAGE", "value": f"{redeploy.IMAGE_NS}/elus360:1.101.0@{OLD_DIGEST}"},
            {"name": "WORKER_IMAGE", "value": f"{redeploy.IMAGE_NS}/elus360-worker:1.101.0@{OLD_DIGEST}"},
            {"name": "SCHEDULER_IMAGE", "value": f"{redeploy.IMAGE_NS}/elus360-scheduler:1.101.0@{OLD_DIGEST}"},
            {"name": "NEXT_PUBLIC_SUPABASE_URL", "value": SUPABASE_URL},
            {"name": "SUPABASE_SERVICE_ROLE_KEY", "value": "fixture-only-not-real"},
        ],
    }


class FakePortainer:
    def __init__(self):
        self.refs = official_images()
        self.before = initial_stack()
        self.after = copy.deepcopy(self.before)
        self.mutations = []
        self.reads = 0
        self.installed = False
        self.concurrent_edit = False
        self.failed_mutation = False
        self.target_sha_changed = False
        self.health_version = TARGET_SHA

    def transport(self, url, *, key=None, method="GET", payload=None, timeout=25):
        if url == f"{redeploy.PORTAINER}/api/stacks/{redeploy.STACK_ID}":
            assert method == "GET"
            self.reads += 1
            if self.installed:
                return copy.deepcopy(self.after)
            stack = copy.deepcopy(self.before)
            if self.concurrent_edit and self.reads >= 2:
                stack["Env"][0]["value"] = "concurrent-operator-update"
            return stack
        if url.startswith(f"{redeploy.PORTAINER}/api/stacks/{redeploy.STACK_ID}/git/redeploy"):
            assert method == "PUT"
            self.mutations.append(copy.deepcopy(payload))
            if self.failed_mutation:
                raise TimeoutError("simulated ambiguous network result")
            assert payload["Prune"] is False
            assert {e["name"] for e in payload["Env"]} == {
                e["name"] for e in self.before["Env"]
            }
            env = {e["name"]: e["value"] for e in payload["Env"]}
            assert env["APP_IMAGE"] == self.refs["elus360"]
            assert env["WORKER_IMAGE"] == self.refs["elus360-worker"]
            assert env["SCHEDULER_IMAGE"] == self.refs["elus360-scheduler"]
            assert env["SUPABASE_SERVICE_ROLE_KEY"] == "fixture-only-not-real"
            self.after["Env"] = copy.deepcopy(payload["Env"])
            self.after["GitConfig"]["ConfigHash"] = TARGET_SHA
            self.installed = True
            return {}
        if url.endswith("/docker/containers/json?all=1"):
            assert self.installed, "Containers must only be checked after redeploy"
            return [
                {
                    "Names": [f"/{container_name}"],
                    "State": "running",
                    "Status": "Up 20 seconds (healthy)",
                    "Image": self.refs[package],
                }
                for _, package, container_name in redeploy.SERVICES
            ]
        if url.endswith("/branches/main"):
            return {"commit": {"sha": CONCURRENT_SHA if self.target_sha_changed else TARGET_SHA}}
        if url == "https://elus.wandora.com.br/api/v1/health":
            return {"data": {"status": "healthy", "version": self.health_version}}
        raise AssertionError(f"Unexpected endpoint or method: {method} {url}")


class OfflineUpgradeFlowTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakePortainer()

    def run_controller(self, *, execute=True, schema_error=None):
        calls = []
        def check_schema(tag):
            calls.append(tag)
            if schema_error:
                raise ValueError("schema mismatch; no deploy")
        with patch.dict(os.environ, {
            "ELUS360_PORTAINER_API_KEY": "fixture-only-token",
            "ELUS360_SUPABASE_URL": SUPABASE_URL,
            "ELUS360_DEPLOY_APPROVAL": f"DEPLOY-ELUS360:{TAG}",
        }):
            with patch.object(redeploy, "official_release", return_value=(self.fake.refs, TARGET_SHA)):
                with patch.object(redeploy, "schema_gate", side_effect=check_schema):
                    with patch.object(redeploy, "http_json", side_effect=self.fake.transport):
                        with patch.object(redeploy.time, "sleep", return_value=None):
                            with contextlib.redirect_stdout(io.StringIO()):
                                with contextlib.redirect_stderr(io.StringIO()):
                                    rc = redeploy.main(["--release", TAG] + (["--execute"] if execute else []))
        return rc, calls

    def test_contract_version_mismatch_blocks_before_remote_or_schema(self):
        # v1.108.0 publicada com contrato antigo: a validacao da tag
        # precisa impedir DDL antes de contactar GitHub, Supabase ou Portainer.
        script = (ROOT / 'scripts/elus360-portainer-upgrade.sh').read_text(encoding='utf-8')
        self.assertLess(script.index('contrato de esquema diverge da release'),
                        script.index('reaplicar_baseline'))
        self.assertLess(script.index('contrato de esquema diverge da release'),
                        script.index('python3 scripts/elus360-portainer-redeploy.py --release'))
        env = dict(os.environ)
        env.update({
            'ELUS360_SUPABASE_URL': SUPABASE_URL,
            'ELUS360_SUPABASE_SERVICE_ROLE_KEY': 'fixture-only-not-real',
            'ELUS360_PORTAINER_API_KEY': 'fixture-only-not-real',
        })
        result = subprocess.run(
            ['bash', str(ROOT / 'scripts/elus360-portainer-upgrade.sh'), 'v1.108.0', '--execute'],
            cwd=ROOT, env=env, capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 3)
        self.assertIn('contrato de esquema diverge da release; sem DDL ou redeploy', result.stderr)

    def test_workflow_validates_release_before_untrusted_tag_checkout(self):
        """An attacker-supplied ref cannot execute tagged code with deploy secrets."""
        workflow = (ROOT / ".github/workflows/elus360-portainer-upgrade.yml").read_text(encoding="utf-8")
        before = workflow.index("name: Validar release e SHA antes de executar codigo da tag")
        checkout = workflow.index("ref: ${{ inputs.release }}")
        privileged = workflow.index("name: Reconciliar esquema e validar contrato; sem deploy Portainer")
        self.assertLess(before, checkout)
        self.assertLess(checkout, privileged)
        preflight = workflow[before:checkout]
        self.assertIn('repos/$REPO/releases/tags/$TAG', preflight)
        self.assertIn('repos/$REPO/git/ref/tags/$TAG', preflight)
        self.assertIn('repos/$REPO/branches/main', preflight)
        self.assertIn('test "$tag_sha" = "$EXPECTED_SHA"', preflight)
        self.assertIn('test "$main_sha" = "$EXPECTED_SHA"', preflight)
        self.assertIn('test "$tag_type" = commit', preflight)
        self.assertNotIn("ELUS360_SUPABASE_SERVICE_ROLE_KEY", preflight)
        self.assertNotIn("ELUS360_PORTAINER_API_KEY", preflight)

    def test_production_workflow_delegates_portainer_to_remote_ops_mcp(self):
        workflow = (ROOT / ".github/workflows/elus360-portainer-upgrade.yml").read_text(encoding="utf-8")
        script = (ROOT / "scripts/elus360-portainer-upgrade.sh").read_text(encoding="utf-8")
        self.assertIn('bash scripts/elus360-portainer-upgrade.sh "$RELEASE" --schema-only', workflow)
        self.assertNotIn('bash scripts/elus360-portainer-upgrade.sh "$RELEASE" --execute', workflow)
        self.assertNotIn("ELUS360_PORTAINER_API_KEY: ${{ secrets.", workflow)
        self.assertIn('if [ "$MODE" = --schema-only ]; then', script)
        self.assertIn("ELUS360_SCHEMA_GREEN:", script)
        self.assertIn("nenhuma imagem ou stack modificada", script)
        # A tag divergente falha ANTES de qualquer verificacao, DDL ou acesso Portainer.
        env = dict(os.environ)
        env.pop("ELUS360_PORTAINER_API_KEY", None)
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/elus360-portainer-upgrade.sh"),
             "v1.108.0", "--schema-only"],
            cwd=ROOT, env=env, capture_output=True, text=True, timeout=10, check=False
        )
        self.assertEqual(result.returncode, 3)
        self.assertIn("contrato de esquema diverge da release", result.stderr)

    def test_schema_only_rejects_unverified_backup_policy_before_ddl(self):
        workflow = (ROOT / ".github/workflows/elus360-portainer-upgrade.yml").read_text(encoding="utf-8")
        self.assertIn("options: [verified]", workflow)
        self.assertNotIn("options: [verified, waived]", workflow)
        self.assertNotIn("waiver_confirmation:", workflow)
        self.assertNotIn("DISPENSO-BACKUP", workflow)
        # Um valor legado/forjado nao pode liberar um script com DDL. A URL e
        # a chave sao dubles locais; nenhuma requisicao ocorre antes da guarda.
        env = dict(os.environ)
        env.update({
            "ELUS360_SUPABASE_URL": "https://example.supabase.co",
            "ELUS360_SUPABASE_SERVICE_ROLE_KEY": "fixture-not-a-secret",
            "ELUS360_DEPLOY_APPROVAL": "DEPLOY-ELUS360:v1.108.3",
            "ELUS360_BACKUP_POLICY": "waived",
        })
        env.pop("ELUS360_PORTAINER_API_KEY", None)
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/elus360-portainer-upgrade.sh"),
             "v1.108.3", "--schema-only"],
            cwd=ROOT, env=env, capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 3)
        self.assertIn("backup restauravel verificado e obrigatorio", result.stderr)
        self.assertNotIn("ELUS360_SCHEMA_GREEN", result.stdout)

    def test_integrated_lab_uses_read_only_github_token(self):
        script = (ROOT / "scripts/elus360-homologacao-integrada.sh").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/elus360-homologacao-integrada.yml").read_text(encoding="utf-8")
        self.assertIn("GH_TOKEN: ${{ github.token }}", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn('Authorization: Bearer $GH_TOKEN', script)
        self.assertIn("token de leitura do GitHub ausente no laboratorio", script)
        self.assertIn(".target_commitish == $s", script)
        self.assertIn("digest nao coincide com release oficial", script)

    def test_e2e_preflights_supabase_port_without_killing_other_processes(self):
        workflow = (ROOT / ".github/workflows/e2e.yml").read_text(encoding="utf-8")
        self.assertIn('sockets="$(ss -Htan)"', workflow)
        self.assertIn("$4 ~ /:54322$/", workflow)
        self.assertIn("porta ocupada apos 60s", workflow)
        self.assertIn("supabase start -x studio,postgres-meta", workflow)

    def test_happy_path_upgrades_from_previous_sha_and_preserves_secrets(self):
        rc, gates = self.run_controller()
        self.assertEqual(rc, 0)
        self.assertEqual(gates, [TAG])
        self.assertEqual(len(self.fake.mutations), 1)
        self.assertEqual(self.fake.reads, 3)  # before, race check, after
        self.assertEqual(self.fake.after["GitConfig"]["ConfigHash"], TARGET_SHA)
        self.assertEqual(self.fake.after["Env"][-1]["value"], "fixture-only-not-real")

    def test_preflight_is_read_only(self):
        rc, gates = self.run_controller(execute=False)
        self.assertEqual(rc, 0)
        self.assertEqual(gates, [TAG])
        self.assertEqual(self.fake.mutations, [])
        self.assertEqual(self.fake.before["GitConfig"]["ConfigHash"], OLD_SHA)

    def test_schema_mismatch_prevents_portainer_access(self):
        rc, gates = self.run_controller(schema_error=True)
        self.assertEqual(rc, 3)
        self.assertEqual(gates, [TAG])
        self.assertEqual(self.fake.mutations, [])
        self.assertEqual(self.fake.reads, 0)

    def test_concurrent_stack_edit_blocks_mutation(self):
        self.fake.concurrent_edit = True
        rc, _ = self.run_controller()
        self.assertEqual(rc, 3)
        self.assertEqual(self.fake.mutations, [])
        self.assertEqual(self.fake.reads, 2)

    def test_main_advancing_during_preflight_blocks_mutation(self):
        self.fake.target_sha_changed = True
        rc, _ = self.run_controller()
        self.assertEqual(rc, 3)
        self.assertEqual(self.fake.mutations, [])

    def test_failed_http_mutation_is_not_retried(self):
        self.fake.failed_mutation = True
        rc, _ = self.run_controller()
        self.assertEqual(rc, 3)
        self.assertEqual(len(self.fake.mutations), 1)
        self.assertEqual(self.fake.installed, False)

    def test_mismatched_health_version_does_not_claim_success(self):
        self.fake.health_version = "v1.102.0"
        rc, _ = self.run_controller()
        self.assertEqual(rc, 3)
        self.assertEqual(len(self.fake.mutations), 1)
        self.assertTrue(self.fake.installed)


if __name__ == "__main__":
    unittest.main()
