/**
 * Database concurrency tests must use the disposable PostgreSQL 16 service
 * without installing a client through network-dependent APT.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const yml = readFileSync(path.join(process.cwd(), ".github/workflows/elus360-ai-autonomy-triple.yml"), "utf8");
const start = yml.indexOf("\n  autonomy-postgres:");
const section = start >= 0 ? yml.slice(start) : "";

describe("ELUS360 — offline PostgreSQL client in disposable CI", () => {
  it("pins the supported GitHub-hosted runner and requires a real psql client", () => {
    expect(section).not.toBe("");
    const executable = section.split("\n").filter(line => !line.trimStart().startsWith("#")).join("\n");
    expect(executable).toMatch(/^    runs-on: ubuntu-24\.04$/m);
    expect(executable).toMatch(/command -v psql/);
    expect(executable).toMatch(/psql --version/);
    expect(executable).not.toMatch(/(?:apt-get|apt)\s+(?:update|install)/);
  });
  it("still executes SQL, migrations, and two concurrent connections in postgres:16", () => {
    expect(section).toContain("image: postgres:16");
    expect(section).toContain("tests/operational/elus360-ai-autonomy-postgres.sql");
    expect(section).toContain("tests/operational/elus360-ai-autonomy-concurrency.sh");
    expect(section).toContain("ON_ERROR_STOP=1");
  });
});
