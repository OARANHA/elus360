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
