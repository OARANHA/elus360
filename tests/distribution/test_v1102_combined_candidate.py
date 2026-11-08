"""Regression checks for v1.102.0 + ELUS360 distribution candidate.

No external Docker, database or registry operation is performed.
"""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "hostgator-setup-kit"


class IntegratedCandidate(unittest.TestCase):
    def test_official_upstream_guards_preserved(self):
        self.assertTrue((ROOT / "scripts/elus360-v1102-sql-reconcile.py").is_file())
        self.assertTrue((ROOT / "supabase/baseline.sql").is_file())
        upstream = (ROOT / "tests/unit/tag-so-nasce-da-main.test.ts").read_text()
        fork = (ROOT / "tests/unit/elus360-tag-so-nasce-da-main.test.ts").read_text()
        self.assertIn("a-tag-veio-da-main", upstream)
        self.assertIn("ELUS360", fork)

    def test_updater_network_notice_after_provenance(self):
        script = (KIT / "update.sh").read_text()
        proof = script.index('ELUS_VEREDITO_IMAGENS="$(veredito_das_imagens_da_release "$TARGET_TAG")"')
        acceptance = script.index('[ "$ELUS_VEREDITO_IMAGENS" = "prontas" ]')
        notice = script.index("\naviso_rede_do_supabase\n")
        cron = script.index("\nsetup_update_agent_cron\n")
        self.assertLess(proof, acceptance)
        self.assertLess(acceptance, notice)
        self.assertLess(notice, cron)
        self.assertEqual(script.count("\naviso_rede_do_supabase\n"), 1)

    def test_no_publication_and_amd64_only(self):
        smoke = (ROOT / ".github/workflows/build-elus360.yml").read_text()
        self.assertIn("pull_request:", smoke)
        self.assertIn("push: false", smoke)
        self.assertIn("platforms: linux/amd64", smoke)
        self.assertNotIn("packages: write", smoke)
        self.assertNotIn("docker/login-action", smoke)
        for name in ("elus360", "elus360-worker", "elus360-scheduler", "elus360-voice-agent"):
            self.assertIn("name: " + name + ", file:", smoke)
        candidate = (ROOT / ".github/workflows/elus360-v1102-candidate.yml").read_text()
        self.assertIn("pull_request:", candidate)

    def test_merged_bash_syntax(self):
        for name in ("_common.sh", "_manifestos.sh", "install.sh", "update.sh", "agent.sh"):
            with self.subTest(script=name):
                check = subprocess.run(["bash", "-n", str(KIT / name)],
                                       capture_output=True, text=True, check=False)
                self.assertEqual(check.returncode, 0, check.stderr)


if __name__ == "__main__":
    unittest.main()
