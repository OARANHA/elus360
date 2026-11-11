/**
 * E2E Chrome is tested on a stable GitHub-hosted OS, not a moving ubuntu-latest.
 * A runner image change must be reviewed alongside Playwright + APT behavior.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const yaml = readFileSync(path.join(process.cwd(), ".github/workflows/e2e.yml"), "utf8");
const start = yaml.indexOf("\n  e2e-parte:\n");
const end = yaml.indexOf("\n  e2e:\n", start + 1);
const part = start >= 0 && end > start ? yaml.slice(start, end) : "";

describe("Playwright E2E pinned runner and coverage", () => {
  it("pinned Ubuntu 24.04 only in the GitHub-hosted E2E matrix", () => {
    expect(part, "missing e2e-partes job").not.toBe("");
    const real = part.split("\n").filter(line => !line.trimStart().startsWith("#")).join("\n");
    expect(real).toMatch(/^    runs-on: ubuntu-24\.04$/m);
    expect(real).not.toContain("self-hosted");
    expect(real).toMatch(/parte: \[1, 2, 3, 4, 5, 6, 7, 8\]/);
  });
  it("still installs exact Chromium with native dependencies, without bypasses", () => {
    expect(part).toContain("pnpm exec playwright install --with-deps chromium");
    expect(part).toContain("timeout-minutes: 30");
    expect(part).toContain("source scripts/ci/apt-e2e-failover.sh");
    expect(part).not.toMatch(/^\s+continue-on-error:/m);
  });
});
