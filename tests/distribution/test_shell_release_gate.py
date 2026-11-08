"""Bash release gate with synthetic GitHub API; no network or mutable systems."""
from __future__ import annotations
import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMON = ROOT / "hostgator-setup-kit" / "_common.sh"
UPDATER = ROOT / "hostgator-setup-kit" / "update.sh"
INSTALLER = ROOT / "hostgator-setup-kit" / "install.sh"
SCRIPT = ROOT / "scripts" / "elus360-distribution-guard.py"
IMG_NS = next(line.split('"')[1] for line in COMMON.read_text().splitlines() if line.startswith('IMG_NS="'))
TAG = "a" * 40

SHELL = r'''
source "$ELUS_COMMON"
git() {
  case "$1" in
    config) printf '%s\n' "${ELUS_TEST_ORIGIN}" ;;
    rev-parse) printf '%s\n' "${ELUS_TEST_LOCAL}" ;;
    ls-remote) printf '%s\trefs/tags/v1.102.0\n' "${ELUS_TEST_REMOTE}" ;;
    *) return 4 ;;
  esac
}
curl() {
  if [ "${ELUS_TEST_HTTP_FAIL:-0}" = "1" ]; then return 22; fi
  case "$*" in
    *"/releases/tags/"*)
      printf '{\n "tag_name": "v1.102.0",\n "draft": %s,\n "prerelease": %s,\n "published_at": "2026-11-06T13:30:00Z"\n}\n' "$ELUS_TEST_DRAFT" "$ELUS_TEST_PRE" ;;
    *"/compare/main..."*)
      printf '{\n "status": "%s"\n}\n' "$ELUS_TEST_STATUS" ;;
    *) return 23 ;;
  esac
}
elus360_release_tag_comprovada "$ELUS_TEST_TAG"
'''


def call_gate(**changes):
    env = {
        **os.environ,
        "ELUS_COMMON": str(COMMON),
        "ELUS_TEST_ORIGIN": "https://github.com/OARANHA/elus360.git",
        "ELUS_TEST_LOCAL": TAG,
        "ELUS_TEST_REMOTE": TAG,
        "ELUS_TEST_DRAFT": "false",
        "ELUS_TEST_PRE": "false",
        "ELUS_TEST_STATUS": "behind",
        "ELUS_TEST_TAG": "v1.102.0",
    }
    env.update({k: str(v) for k, v in changes.items()})
    return subprocess.run(["bash", "-c", SHELL], env=env, cwd=ROOT,
                          text=True, capture_output=True, check=False)


class ReleaseGateShell(unittest.TestCase):
    def test_installer_library_import_does_not_require_published_release(self):
        """Apenas importar validadores não instala nem consulta GitHub/GHCR."""
        script = r'''
curl() { echo "network was called" >&2; return 91; }
git() { echo "git was called" >&2; return 92; }
INSTALL_SH_LIB=1 . ./hostgator-setup-kit/install.sh
declare -F v_domain >/dev/null
declare -F v_email >/dev/null
declare -F v_supabase_url >/dev/null
'''
        result = subprocess.run(
            ["bash", "-c", "set -euo pipefail\n" + script],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("network was called", result.stderr)
        self.assertNotIn("git was called", result.stderr)

    def test_install_has_no_legacy_local_build_branch(self):
        """No caminho feliz, nenhuma variável legada indefinida derruba o install."""
        source = INSTALLER.read_text()
        self.assertNotIn("CONSTRUIU_AQUI", source)
        self.assertIn("if ! dc pull; then", source)
        self.assertIn("if ! dc up -d --no-build; then", source)

    def test_valid_synthetic_tag(self):
        self.assertEqual(call_gate().returncode, 0)

    def test_identical_with_main_also_valid(self):
        self.assertEqual(call_gate(ELUS_TEST_STATUS="identical").returncode, 0)

    def test_other_repository_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_ORIGIN="https://github.com/melgarafael/DeskcommCRM.git").returncode, 1)

    def test_tag_object_mismatch_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_REMOTE="b" * 40).returncode, 1)

    def test_draft_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_DRAFT="true").returncode, 1)

    def test_prerelease_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_PRE="true").returncode, 1)

    def test_not_in_main_rejected(self):
        for status in ("ahead", "diverged", ""):
            with self.subTest(status=status):
                self.assertEqual(call_gate(ELUS_TEST_STATUS=status).returncode, 1)

    def test_github_release_404_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_HTTP_FAIL="1").returncode, 1)

    def test_no_mutable_or_prerelease_tag(self):
        for tag in ("latest", "stable", "main", "v1.102.0-beta"):
            with self.subTest(tag=tag):
                self.assertEqual(call_gate(ELUS_TEST_TAG=tag).returncode, 1)

    def test_missing_origin_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_ORIGIN="").returncode, 1)

    def test_updater_gates_before_mutation(self):
        source = UPDATER.read_text()
        origin = source.index('elus360_origem_confiavel "$(git config')
        release = source.index('elus360_release_publicada_no_main "$TARGET_TAG"')
        tag = source.index('elus360_release_tag_comprovada "$TARGET_TAG"')
        registry = source.index('ELUS_VEREDITO_IMAGENS="$(veredito_das_imagens_da_release')
        cron = source.index("setup_update_agent_cron", origin)
        gotrue = source.index("sincronizar_signup_mode_do_gotrue", origin)
        vapid = source.index("completar_par_vapid .env", origin)
        backup = source.index('step "Backup de segurança', tag)
        for gate in (origin, release, tag, registry):
            self.assertLess(gate, cron)
            self.assertLess(gate, gotrue)
            self.assertLess(gate, vapid)
            self.assertLess(gate, backup)
        # The agent must not mistake pre-mutation NO-GO for a failed upgrade
        # and attempt to undo already-running containers.
        self.assertIn('|| refuse "ELUS_DISTRIBUTION_NO_GO', source[:registry])

    def test_installer_has_no_fallback(self):
        source = INSTALLER.read_text()
        # The version MUST come from the published ELUS fork release preflight,
        # not from legacy ultima_release_estavel() or any mutable channel.
        resolve = source.index('ELUS_RELEASE_PREVALIDADA="$(elus360_ultima_release_do_fork)"')
        provenance = source.index(
            'elus360_release_publicada_no_main "$ELUS_RELEASE_PREVALIDADA" "$REPO_URL"'
        )
        quartet = source.index('trio_publicado "$ELUS_RELEASE_NUMERICA"')
        clone = source.index('git clone --depth 1')
        self.assertLess(resolve, provenance)
        self.assertLess(provenance, quartet)
        self.assertLess(quartet, clone)
        # The published tag is vX.Y.Z; Docker image tags must be X.Y.Z.
        self.assertIn('VERSAO_ALVO="${ELUS_RELEASE_PREVALIDADA#v}"', source)
        self.assertNotIn('VERSAO_ALVO="$ELUS_RELEASE_PREVALIDADA"', source)
        self.assertIn('|| ! trio_publicado "$VERSAO_ALVO"', source)
        self.assertIn('git fetch --no-tags --quiet origin "refs/tags/v', source)
        self.assertIn('elus360_release_tag_comprovada "v${VERSAO_ALVO}"', source)
        self.assertNotIn('VERSAO_ALVO="$(ultima_release_estavel)"', source)
        self.assertNotIn('VERSAO_ALVO="latest"', source)
        self.assertNotIn('VERSAO_ALVO="stable"', source)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO", source)

    def test_no_host_build_in_install_or_update(self):
        install = INSTALLER.read_text()
        update = UPDATER.read_text()
        common = COMMON.read_text()
        self.assertIn("if ! dc up -d --no-build; then", install)
        self.assertIn("if ! dc pull; then", install)
        self.assertIn("if ! subir_o_parque; then", update)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO: pull incompleto", update)
        self.assertIn('dc up -d --no-build', common)
        self.assertIn('return 1\n}', common[common.index('build_local_permitido()'):][:140])
        self.assertIn("construir_aqui_e_subir()", common)
        self.assertIn("imagens só podem vir do CI", common)

    def test_four_own_image_defaults_in_compose_and_env(self):
        compose = (ROOT / "docker-compose.prod.yml").read_text()
        env = (ROOT / ".env.hostgator.example").read_text()
        for key, name in (("APP", "elus360"), ("WORKER", "elus360-worker"),
                          ("SCHEDULER", "elus360-scheduler"),
                          ("VOICE_AGENT", "elus360-voice-agent")):
            self.assertIn(f"{IMG_NS}/{name}:stable", compose)
            self.assertIn(f"{key}_IMAGE={IMG_NS}/{name}:stable", env)

    def test_exclusive_amd64_ci_and_oci_contract(self):
        workflow = (ROOT / ".github/workflows/build-elus360.yml").read_text()
        manifest = (ROOT / "hostgator-setup-kit" / "_manifestos.sh").read_text()
        guard_src = SCRIPT.read_text()
        self.assertIn("arch: [amd64]", workflow)
        self.assertIn("platforms: linux/amd64", workflow)
        self.assertNotIn("arm64]", workflow)
        self.assertNotIn("setup-qemu-action", workflow)
        self.assertIn('PLATFORMS = ("linux/amd64",)', guard_src)
        self.assertIn("linux/amd64) ;;", manifest)
        self.assertNotIn("linux/amd64|linux/arm64", manifest)

    def test_runtime_amd64_restriction_has_no_dangling_arm_reference(self):
        common = COMMON.read_text()
        manifest = (ROOT / "hostgator-setup-kit" / "_manifestos.sh").read_text()
        self.assertNotIn("waha_amd64_conhecido_em_arm", common)
        self.assertIn('sistema="$(uname -s', common)
        self.assertIn('manifesto_tem_plataforma "${img}:${versao}" linux/amd64 exclusivo', common)
        self.assertIn('manifesto_tem_plataforma "$ref" "$plataforma" exclusivo', manifest)
        self.assertIn('modo="${3:-compativel}"', manifest)
        self.assertIn('[ "$sistema" = Linux ]', manifest)

    def test_no_publication_permissions_in_smoke_workflow(self):
        smoke = (ROOT / ".github/workflows/build-elus360.yml").read_text()
        self.assertIn("push: false", smoke)
        self.assertIn("pull_request:", smoke)
        self.assertIn("permissions:\n  contents: read", smoke)
        self.assertNotIn("packages: write", smoke)
        self.assertNotIn("docker/login-action", smoke)
        self.assertNotIn("promover-stable:", smoke)


    def test_untrusted_release_override_rejected_early(self):
        install = INSTALLER.read_text()
        update = UPDATER.read_text()
        self.assertLess(install.index('DESKCOMM_RELEASES_LATEST_URL'), install.index('git clone --depth 1'))
        self.assertLess(update.index('DESKCOMM_RELEASES_LATEST_URL'), update.index('setup_update_agent_cron'))

    def test_release_tag_is_pinned_before_installer_schema_changes(self):
        install = INSTALLER.read_text()
        tag_fetch = install.index('git fetch --no-tags --quiet origin "refs/tags/v')
        verify = install.index('elus360_release_tag_comprovada "v')
        checkout = install.index('git checkout --quiet "v')
        baseline = install.index('supabase/baseline.sql', checkout)
        self.assertLess(tag_fetch, verify)
        self.assertLess(verify, checkout)
        self.assertLess(checkout, baseline)


if __name__ == "__main__":
    unittest.main()
