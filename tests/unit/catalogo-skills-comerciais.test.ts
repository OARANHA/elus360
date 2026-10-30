import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261030120000_0700_catalogo_skills_comerciais.sql"),
  "utf8",
);

const runtime = readFileSync(resolve(process.cwd(), "lib/agent-engine/agent/skills.ts"), "utf8");

const names = [
  "diagnostico-consultivo",
  "qualificacao-comercial",
  "apresentacao-de-valor",
  "recomendacao-de-plano",
  "followup-contextual",
];

describe("catalogo comercial de skills de plataforma", () => {
  it("semeia cinco skills globais por ponteiro sem substituir as existentes", () => {
    for (const name of names) {
      expect(migration).toContain("organization_id is null and name = '" + name + "'");
      expect(migration).toContain("values (null, '" + name + "', v_id)");
      expect(migration).toContain("'"+name+"'");
    }
    expect((migration.match(/insert into public\.skill_versions/g) ?? []).length).toBe(5);
    expect((migration.match(/insert into public\.skill_pointers/g) ?? []).length).toBe(5);
    expect(migration).not.toMatch(/\b(update|delete|truncate)\s+public\.skill_(versions|pointers)/i);
  });
  it("mantem instrucao de fallback controlado e nao ativa envios", () => {
    expect(migration).toContain("add column if not exists catalog_only boolean not null default false");
    expect((migration.match(/true\n    \)/g) ?? []).length).toBe(5);
    expect(runtime).toContain("p.organization_id = $1 or (p.organization_id is null and v.catalog_only = false)");
    expect(migration).not.toMatch(/insert into public\.(messages|job_queue|followup_enrollments)/i);
  });
});
