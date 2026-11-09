"""Offline tests for ELUS360 release/digest/stack checks; never touch production."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("redeploy", ROOT / "scripts" / "elus360-portainer-redeploy.py")
redeploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(redeploy)

SHA = "a" * 40
DIGEST = "sha256:" + "1" * 64
TAG = "v1.102.0"


def release_notes():
    return "\n".join(f"{redeploy.IMAGE_NS}/{name}:1.102.0@{DIGEST}" for name in redeploy.PACKAGES)


def portainer_stack():
    return {
        "Id": 5, "Name": "elus", "Type": 2, "EndpointId": 3,
        "GitConfig": {"URL": "https://github.com/OARANHA/elus360",
                      "ReferenceName": "refs/heads/main", "ConfigHash": SHA},
        "Env": [
            {"name": "APP_IMAGE", "value": f"{redeploy.IMAGE_NS}/elus360-app@{DIGEST}"},
            {"name": "WORKER_IMAGE", "value": f"{redeploy.IMAGE_NS}/elus360-worker@{DIGEST}"},
            {"name": "SCHEDULER_IMAGE", "value": f"{redeploy.IMAGE_NS}/elus360-scheduler@{DIGEST}"},
            {"name": "NEXT_PUBLIC_SUPABASE_URL", "value": "https://abcdefghijklmnopqrst.supabase.co"},
            {"name": "SUPABASE_SERVICE_ROLE_KEY", "value": "sensitive-value"},
        ],
    }


class RedeployTests(unittest.TestCase):
    def test_all_four_images_required_and_exact_digest(self):
        refs = redeploy.digest_refs(release_notes(), TAG)
        self.assertEqual(len(refs), 4)
        self.assertIn(f"{redeploy.IMAGE_NS}/elus360:1.102.0@sha256:", refs["elus360"])
        with self.assertRaises(ValueError):
            redeploy.digest_refs(release_notes().replace("elus360-voice-agent:", "other-voice:"), TAG)
        with self.assertRaises(ValueError):
            redeploy.digest_refs(release_notes() + "\n" + release_notes().splitlines()[0], TAG)

    def test_only_three_image_vars_change_and_secrets_preserved(self):
        stack = portainer_stack()
        refs = redeploy.digest_refs(release_notes(), TAG)
        env, before = redeploy.stack_environment(stack, refs)
        new = {v["name"]: v["value"] for v in env}
        self.assertEqual(new["APP_IMAGE"], refs["elus360"])
        self.assertEqual(new["WORKER_IMAGE"], refs["elus360-worker"])
        self.assertEqual(new["SCHEDULER_IMAGE"], refs["elus360-scheduler"])
        self.assertEqual(new["SUPABASE_SERVICE_ROLE_KEY"], "sensitive-value")
        self.assertEqual(set(before), {"APP_IMAGE", "WORKER_IMAGE", "SCHEDULER_IMAGE"})
        stack["Name"] = "wrong-stack"
        with self.assertRaises(ValueError):
            redeploy.stack_environment(stack, refs)

    def test_public_release_must_match_main_and_manifest(self):
        def answer(url, **kwargs):
            if "/releases/tags/" in url:
                return {"tag_name": TAG, "draft": False, "prerelease": False,
                        "published_at": "2026-11-09T01:00:00Z", "body": release_notes()}
            if "/compare/" in url:
                return {"status": "identical"}
            if "/branches/main" in url:
                return {"commit": {"sha": SHA}}
            if "/git/ref/tags/" in url:
                return {"object": {"sha": SHA, "type": "commit"}}
            raise AssertionError(url)
        with patch.object(redeploy, "http_json", side_effect=answer):
            refs, sha = redeploy.official_release(TAG)
        self.assertEqual(sha, SHA)
        self.assertEqual(len(refs), 4)

    def test_deploy_cannot_skip_schema_gate(self):
        with patch.object(redeploy, "official_release") as release:
            self.assertEqual(redeploy.main(["--release", TAG, "--execute", "--pre-migration"]), 3)
            release.assert_not_called()


if __name__ == "__main__":
    unittest.main()
