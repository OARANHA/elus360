/**
 * Gate 7: execute the REAL pinned fork/target TypeScript functions in isolated
 * Node VM contexts, with deterministic, deliberately limited I/O substitutes.
 * No source patching, no upstream prepare, no HTTP, no database or production.
 *
 * Inputs must be Git objects already verified by the official read-only runner.
 * Run inside its scratch repo after plan/Gate5/Gate6 evidence has been generated.
 * This is a comparative contract test, NOT runtime integration acceptance.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const PIN = Object.freeze({
  base: "ba24d4d366b7caf056b88553e0ed434cb0fb46de",
  target: "ca37cb7f2a35c1a0f6abc968139dd263b20ccb36",
  fork: "749aaf8fbb25b46dddd9138219e2ac032cc83336",
});
const PATHS = Object.freeze({
  tags: "lib/automation/actions/add-tag.ts",
  billing: "lib/cobranca/visao-geral.ts",
  demo: "curso/semear-demonstracao.ts",
});
const BLOBS = Object.freeze({
  tags: {
    base: "22354e3e992a117e11f44bb699a2562bfc2f7b39",
    fork: "22354e3e992a117e11f44bb699a2562bfc2f7b39",
    target: "45e507424de1e2bc581b0c9597d418c2f93f56a4",
  },
  billing: {
    base: "905ae3d957027828389293cf1c624b045b14eefc",
    fork: "905ae3d957027828389293cf1c624b045b14eefc",
    target: "3606e150a22f4ab4ce7cc0cc20664431d9d0d788",
  },
  demo: {
    fork: "efc36079668c67e56529113ee173e611e09ebd9b",
    target: "aa2c70106a6408eafe846e2543c0cf04420ee1d0",
  },
});
const gitRepo = process.env.ELUS_COMPARE_GIT_REPO;
const gate6Path = process.env.ELUS_GATE6_EVIDENCE;
function git(...args) {
  assert.ok(gitRepo && resolve(gitRepo) === gitRepo, "ELUS_COMPARE_GIT_REPO required (absolute path)");
  return execFileSync("git", ["-C", gitRepo, ...args], {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}
function gitFile(kind, revision) {
  const path = PATHS[kind];
  const expected = BLOBS[kind][revision];
  assert.ok(expected, "unapproved object: " + kind + "/" + revision);
  assert.equal(git("rev-parse", PIN[revision] + ":" + path), expected, "Git blob changed: " + path);
  return git("show", PIN[revision] + ":" + path);
}
function compile(source, filename, dependencies) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  const problems = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(problems.length, 0, "TypeScript transpile errors: " + filename);
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (name) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error("Unmocked module: " + name);
      return dependencies[name];
    },
  };
  runInNewContext(result.outputText, sandbox, { timeout: 3000, filename });
  return module.exports;
}
function tagAction(source) {
  let action = null;
  compile(source, PATHS.tags, {
    "@/lib/atendimento/origem-automacao": {
      originFromAutomationEvent: async () => null,
    },
    "@/lib/automation/actions": {
      registerAction: (x) => { action = x; },
    },
  });
  assert.equal(action?.type, "add_tag");
  assert.equal(typeof action.execute, "function");
  return action.execute;
}
function tagsBank() {
  const rows = new Map([
    ["lead-a", { org: "org-a", tags: ["existente"] }],
    ["lead-b", { org: "org-b", tags: ["privada"] }],
  ]);
  const emitted = [];
  const merged = [];
  const admin = {
    async rpc(name, args) {
      if (name === "emit_event") {
        emitted.push(args);
        return { data: null, error: null };
      }
      assert.ok(["fn_lead_adicionar_etiquetas", "fn_contato_adicionar_etiquetas"].includes(name));
      merged.push({ name, args });
      const id = name === "fn_lead_adicionar_etiquetas" ? args.p_lead : args.p_contato;
      const row = rows.get(id);
      if (!row || row.org !== args.p_org) return { data: null, error: null };
      const added = [...new Set(args.p_etiquetas.map(String))].filter((x) => !row.tags.includes(x));
      row.tags = [...row.tags, ...added];
      return { data: { tags: [...row.tags], adicionadas: added }, error: null };
    },
  };
  return { rows, emitted, merged, admin };
}
async function tagsScenario(source, ruleId, id = "lead-a", labels = ["nova"]) {
  const bank = tagsBank();
  const ctx = {
    admin: bank.admin,
    organizationId: "org-a",
    ruleId,
    ruleName: ruleId,
    event: { id: "event-a" },
    requestId: "request-a",
    context: { lead: { id, tags: [] } },
  };
  const result = await tagAction(source)(ctx, { tags: labels });
  return { result, ...bank, ctx };
}
function billingModule(source) {
  return compile(source, PATHS.billing, {
    "@/lib/cobranca/configuracao": { provedorDaInstalacao: async () => "stripe" },
    "@/lib/cobranca/provedores": { modoDoProvedor: async () => "teste" },
    "@/lib/cobranca/provedores/base-de-teste": { baseDeTesteDaCobranca: () => null },
    "@/lib/cobranca/url": { urlDoWebhookDaCobranca: () => "https://test.invalid/webhook" },
    "@/lib/email/roteador": { emailConfigurado: async () => false },
    "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://test.invalid" } },
    "@/lib/instalacao/config": { estadoParaTela: async () => ({ last4: "4242" }) },
  });
}
function billingBank(rows, rpcError = null) {
  const calls = [];
  const subscriptions = [];
  const admin = {
    rpc(name) {
      assert.equal(name, "fn_cobranca_reconciliaveis");
      const entry = { name, order: null, limit: null, returned: null };
      calls.push(entry);
      const builder = {
        order(column, options) {
          assert.equal(column, "relida_em");
          entry.order = { column, options: JSON.parse(JSON.stringify(options)) };
          return builder;
        },
        limit(n) {
          assert.equal(n, 1);
          entry.limit = n;
          return builder;
        },
        then(onSuccess, onFailure) {
          let values = rows.map((r) => ({ ...r }));
          if (entry.order) {
            values.sort((a, b) => {
              if (a.relida_em === null) return b.relida_em === null ? 0 : 1;
              if (b.relida_em === null) return -1;
              return b.relida_em.localeCompare(a.relida_em);
            });
          }
          if (entry.limit !== null) values = values.slice(0, entry.limit);
          entry.returned = values.length;
          return Promise.resolve({ data: values, error: rpcError }).then(onSuccess, onFailure);
        },
      };
      return builder;
    },
    from(table) {
      const filters = [];
      const builder = {};
      for (const name of ["select", "eq", "not", "in", "gte", "order", "limit", "is"]) {
        builder[name] = (...args) => {
          filters.push({ name, args });
          return builder;
        };
      }
      function response() {
        subscriptions.push({ table, filters });
        if (table === "cobranca_planos") return { data: { id: "plano" }, error: null };
        if (table === "cobranca_assinaturas") return { data: [], error: null };
        assert.equal(table, "webhook_events_log");
        const signed = filters.find((x) => x.name === "eq" && x.args[0] === "valid_signature");
        if (filters.some((x) => x.name === "order")) {
          assert.equal(signed?.args[1], true);
          return { data: { received_at: "2026-10-01T00:00:00Z" }, error: null };
        }
        return { count: signed?.args[1] === false ? 2 : 0, data: null, error: null };
      }
      builder.maybeSingle = async () => response();
      builder.then = (ok, error) => Promise.resolve(response()).then(ok, error);
      return builder;
    },
  };
  return { admin, calls, subscriptions };
}
async function billingScenario(source, rows, rpcError = null) {
  const db = billingBank(rows, rpcError);
  const result = await billingModule(source).lerVisaoGeral(db.admin);
  return { result, ...db };
}
const HEADERS = [
  ["lib/automation/texto-do-followup.ts", "requires_adaptation"],
  ["lib/channels/pos-entrada.ts", "requires_adaptation"],
  ["lib/channels/zernio/ingest.ts", "requires_adaptation"],
  ["lib/contacts/cliente-pela-agenda.ts", "requires_adaptation"],
  ["lib/crm-b2b/import-process.ts", "requires_adaptation"],
  ["lib/channels/adapters/meta-cloud.ts", "blocked_pending_contract_proof"],
  ["lib/cobranca/uso.ts", "blocked_pending_contract_proof"],
  ["lib/lgpd/pdf-renderer.tsx", "blocked_pending_contract_proof"],
  ["lib/messaging/presenca.ts", "blocked_pending_contract_proof"],
  ["lib/wacalls/events-bridge.ts", "blocked_pending_contract_proof"],
];

test("proveniência fixa: objetos Git da base, target e fork verificados (sem checkout de target)", () => {
  for (const kind of ["tags", "billing"]) {
    assert.equal(gitFile(kind, "base"), gitFile(kind, "fork"));
    assert.notEqual(gitFile(kind, "target"), gitFile(kind, "fork"));
  }
  gitFile("demo", "fork");
  gitFile("demo", "target");
});

test("add_tag: com ruleId, ambos emitem metadata, org e apenas etiquetas realmente adicionadas", async () => {
  const a = await tagsScenario(gitFile("tags", "fork"), "regra-1");
  const b = await tagsScenario(gitFile("tags", "target"), "regra-1");
  for (const x of [a, b]) {
    assert.equal(x.result.status, "success");
    assert.deepEqual(JSON.parse(JSON.stringify(x.result.detail)), { added: ["nova"] });
    assert.equal(x.merged.length, 1);
    assert.equal(x.merged[0].args.p_org, "org-a");
    assert.equal(x.emitted.length, 1);
    assert.equal(x.emitted[0].p_organization_id, "org-a");
    assert.equal(x.emitted[0].p_entity_id, "lead-a");
    assert.equal(x.emitted[0].p_metadata.caused_by_rule, "regra-1");
    assert.deepEqual(JSON.parse(JSON.stringify(x.emitted[0].p_payload.added_tags)), ["nova"]);
    assert.deepEqual(JSON.parse(JSON.stringify(x.ctx.context.lead.tags)), ["existente", "nova"]);
  }
  assert.equal(JSON.stringify(a.emitted), JSON.stringify(b.emitted));
});

test("add_tag: sem ruleId, target omite a chave; fork anterior tinha chave undefined", async () => {
  const a = await tagsScenario(gitFile("tags", "fork"), undefined);
  const b = await tagsScenario(gitFile("tags", "target"), undefined);
  assert.equal(a.emitted.length, 1);
  assert.equal(b.emitted.length, 1);
  assert.equal(Object.hasOwn(a.emitted[0].p_metadata, "caused_by_rule"), true);
  assert.equal(Object.hasOwn(b.emitted[0].p_metadata, "caused_by_rule"), false);
  assert.equal(JSON.stringify(a.emitted[0].p_metadata), "{}");
  assert.equal(JSON.stringify(b.emitted[0].p_metadata), "{}");
  assert.equal(a.result.status, b.result.status);
});

test("add_tag: deduplicação, não-evento e tenant B nunca recebem escrita de A", async () => {
  for (const revision of ["fork", "target"]) {
    const source = gitFile("tags", revision);
    const duplicate = await tagsScenario(source, "r", "lead-a", ["existente"]);
    assert.equal(duplicate.result.status, "success");
    assert.equal(duplicate.emitted.length, 0);
    const cross = await tagsScenario(source, "r", "lead-b", ["tentativa"]);
    assert.equal(cross.result.status, "skipped");
    assert.equal(cross.emitted.length, 0);
    assert.deepEqual(cross.rows.get("lead-b").tags, ["privada"]);
  }
});

test("sabotagem controlada add_tag: reintroduzir metadata unconditional reprovou o discriminador", async () => {
  const source = gitFile("tags", "target");
  const vulnerable = source.replace(
    "if (ctx.ruleId) metadata.caused_by_rule = ctx.ruleId;",
    "metadata.caused_by_rule = ctx.ruleId;",
  );
  assert.notEqual(vulnerable, source, "mutation site missing");
  const safe = await tagsScenario(source, undefined);
  const sabotaged = await tagsScenario(vulnerable, undefined);
  assert.equal(Object.hasOwn(safe.emitted[0].p_metadata, "caused_by_rule"), false);
  assert.equal(Object.hasOwn(sabotaged.emitted[0].p_metadata, "caused_by_rule"), true);
});

test("billing: equivalência do máximo relida_em para conjunto desordenado com NULL", async () => {
  const rows = [
    { relida_em: null }, { relida_em: "2026-10-01T08:00:00Z" },
    { relida_em: "2026-10-12T11:00:00Z" }, { relida_em: "2026-10-11T17:00:00Z" },
  ];
  const a = await billingScenario(gitFile("billing", "fork"), rows);
  const b = await billingScenario(gitFile("billing", "target"), rows);
  assert.equal(a.result.ultimaLeituraEm, "2026-10-12T11:00:00Z");
  assert.equal(b.result.ultimaLeituraEm, a.result.ultimaLeituraEm);
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
  assert.equal(a.calls[0].order, null);
  assert.equal(a.calls[0].limit, null);
  assert.equal(b.calls[0].order.column, "relida_em");
  assert.equal(b.calls[0].order.options.ascending, false);
  assert.equal(b.calls[0].order.options.nullsFirst, false);
  assert.equal(b.calls[0].limit, 1);
  assert.equal(a.calls[0].returned, 4);
  assert.equal(b.calls[0].returned, 1);
  assert.equal(b.result.problemas.avisosRecusados, a.result.problemas.avisosRecusados);
});

test("billing: NULL-only e conjunto vazio continuam sem falsa última leitura", async () => {
  for (const rows of [[{ relida_em: null }], []]) {
    for (const revision of ["fork", "target"]) {
      const x = await billingScenario(gitFile("billing", revision), rows);
      assert.equal(x.result.ultimaLeituraEm, null);
    }
  }
});

test("billing: erro de RPC lança nas duas versões, nunca declara painel saudável", async () => {
  for (const revision of ["fork", "target"]) {
    await assert.rejects(
      billingScenario(gitFile("billing", revision), [{ relida_em: "2026-10-01T00:00:00Z" }], { message: "offline" }),
      /visão geral ilegível/,
    );
  }
});

test("sabotagem controlada billing: retirar ORDER mantendo LIMIT produz data incorreta", async () => {
  const source = gitFile("billing", "target");
  const needle = '.order("relida_em", { ascending: false, nullsFirst: false }).limit(1)';
  assert.ok(source.includes(needle));
  const vulnerable = source.replace(needle, ".limit(1)");
  const rows = [
    { relida_em: "2026-10-01T00:00:00Z" },
    { relida_em: "2026-10-21T00:00:00Z" },
  ];
  const safe = await billingScenario(source, rows);
  const sabotaged = await billingScenario(vulnerable, rows);
  assert.equal(safe.result.ultimaLeituraEm, "2026-10-21T00:00:00Z");
  assert.equal(sabotaged.result.ultimaLeituraEm, "2026-10-01T00:00:00Z");
});

function gate6Evidence() {
  assert.ok(gate6Path, "ELUS_GATE6_EVIDENCE required");
  return JSON.parse(readFileSync(gate6Path, "utf8"));
}
test("fail-closed: 12 candidatos, 45 novos módulos, grafo incompleto, safe_to_prepare=0", () => {
  const g = gate6Evidence();
  assert.equal(g.refs.base, PIN.base);
  assert.equal(g.refs.target, PIN.target);
  assert.equal(g.refs.fork, PIN.fork);
  assert.equal(g.graph_complete, false);
  assert.equal(g.counts.safe_to_prepare, 0);
  assert.equal(g.counts.reviewed12, 12);
  assert.equal(g.counts.new_modules, 45);
  assert.equal(g.review12.every((r) => r.authorization === "none"), true);
  assert.equal(g.review45.every((r) => r.authorization === "none"), true);
  assert.equal(g.counts.decisions.compatible_for_human_review, 2);
  assert.equal(g.counts.decisions.requires_adaptation, 5);
  assert.equal(g.counts.decisions.blocked_pending_contract_proof, 5);
});
for (const [path, decision] of HEADERS) {
  test("revisão independente sem promoção: " + path, () => {
    const matches = gate6Evidence().review12.filter((x) => x.path === path);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].decision, decision);
    assert.equal(matches[0].authorization, "none");
    assert.equal(matches[0].acceptance, "no_functional_proof_no_prepare");
    assert.ok(matches[0].tests.length >= 3);
    assert.ok(matches[0].reason.length > 30);
  });
}
test("imports computados demonstrativos continuam inconclusivos, não resolvidos por suposição", () => {
  const g = gate6Evidence();
  assert.equal(g.computed_imports.fork_unresolved, 1);
  assert.equal(g.computed_imports.target_unresolved, 2);
  assert.equal(g.computed_imports.completeness, "incomplete");
  assert.equal(g.computed_imports.target_sites.some((x) => x.path === PATHS.demo), true);
  const fork = gitFile("demo", "fork");
  const target = gitFile("demo", "target");
  assert.ok(fork.includes("await import(arquivo)"));
  assert.ok(target.includes("await import(path.join(pasta, arquivo))"));
  assert.ok(target.includes("await import(arquivo)"));
  assert.ok(target.includes("readdirSync(pasta)"));
  assert.ok(target.includes("/^[a-z0-9-]+$/"));
  assert.equal(g.counts.safe_to_prepare, 0);
});
