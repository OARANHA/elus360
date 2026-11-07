import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const smoke = readFileSync(join(root, ".github/workflows/build-elus360.yml"), "utf8");
const common = readFileSync(join(root, "hostgator-setup-kit/_common.sh"), "utf8");
const update = readFileSync(join(root, "hostgator-setup-kit/update.sh"), "utf8");
const install = readFileSync(join(root, "hostgator-setup-kit/install.sh"), "utf8");

describe("ELUS360 — release não nasce em PR nem em workflow sem autorização", () => {
  it("build de PR não pode publicar imagem, tag, release ou stable", () => {
    expect(smoke).toContain("pull_request:");
    expect(smoke).toContain("push: false");
    expect(smoke).toContain("contents: read");
    expect(smoke).not.toContain("packages: write");
    expect(smoke).not.toContain("docker/login-action");
    expect(smoke).not.toContain("promover-stable:");
    expect(smoke).not.toMatch(/^  (?:push|workflow_dispatch|release):/m);
  });

  it("a tag publicada deve corresponder ao fork e estar contida na main", () => {
    const start = common.indexOf("elus360_release_tag_comprovada()");
    const end = common.indexOf("ultima_versao_publicada()", start);
    expect(start).toBeGreaterThan(0);
    const guard = common.slice(start, end);
    expect(guard).toContain("https://api.github.com/repos/OARANHA/elus360/releases/tags/$tag");
    expect(guard).toContain("https://api.github.com/repos/OARANHA/elus360/compare/main...$tag");
    expect(guard).toMatch(/identical\|behind/);
    expect(guard).toContain('DESKCOMM_RELEASES_LATEST_URL');
  });

  it("o atualizador exige release comprovada antes do backup e do DDL", () => {
    const gate = update.indexOf('elus360_release_tag_comprovada "$TARGET_TAG"');
    const backup = update.indexOf('step "Backup de segurança', gate);
    expect(gate).toBeGreaterThan(0);
    expect(backup).toBeGreaterThan(gate);
    expect(install).toContain("ELUS_DISTRIBUTION_NO_GO");
    expect(install).not.toContain('VERSAO_ALVO="latest"');
  });

  it("quatro nomes próprios são o contrato: app, worker, scheduler e voz", () => {
    for (const img of ["elus360", "elus360-worker", "elus360-scheduler", "elus360-voice-agent"]) {
      expect(common).toContain(img);
      expect(smoke).toContain(`name: ${img}, file:`);
    }
  });
});
