import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = null; }
/**
 * ELUS Upstream Sync — heuristicas conservadoras de impacto de contrato.
 * Sinais NÃO provam equivalência semântica ou segurança; apenas escalonam revisão.
 * Este arquivo não acessa Git nem runtime. Nenhuma ocorrência pode autorizar merge.
 */
const rules = [
  ["tenant_isolation", /\b(?:organization_id|organizationId|orgId|fn_user_org_ids|tenant_id|tenantId|createAdminClient|service_role|\bRLS\b|row.level.security)\b/i],
  ["authentication_authorization", /\b(?:requireRole|requirePlatformAdmin|requireAuth|auth-dual|api_tokens|mfa_required|platform_admins|is_platform_admin|getUser|verifyJwt)\b/i],
  ["managed_ai", /\b(?:ai_autonomy|ai_purpose_bindings|provider|operator_model|default_model|model_id|credential_id|CHUTES_API_KEY|ELUS_DEFAULT_AI_PROVIDER|ai-managed|before_send)\b/i],
  ["agent_runtime", /\b(?:runAgentTurn|ai_agent_versions|ai_agents|agent_turn_traces|embedding|reindex|rag_pipeline|tool_call)\b/i],
  ["messaging_events", /\b(?:event_log|WAHA|whatsapp|dispatch|webhook|Idempotency-Key|audit_log)\b/i],
  ["sensitive_import", /(?:from\s*["']|import\s*\(["']|require\s*\(["'])(?:@\/|\.\.?\/)(?:[^"']*\/)?(?:elus360|auth|supabase|ai-managed|agent-engine|governanca|mcp|permissions|credentials|rbac|audit)(?:\/|["'])/i],
];
/** Conservative AST guard for export contracts modified without any import change. */
export function semanticContractSignals(path,before,after) {
  if(!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) || before===after) return [];
  if(!ts) return ["semantic_analysis_incomplete"];
  const analyze=content=>{
    const kind=/\.tsx$/.test(path)?ts.ScriptKind.TSX:/\.jsx$/.test(path)?ts.ScriptKind.JSX:/\.[mc]?js$/.test(path)?ts.ScriptKind.JS:ts.ScriptKind.TS;
    const ast=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,kind);
    if(ast.parseDiagnostics.length) return null;
    const exports=[];
    for(const statement of ast.statements) {
      const isExport=ts.isExportDeclaration(statement)||ts.isExportAssignment(statement)||
        statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword||m.kind===ts.SyntaxKind.DefaultKeyword);
      if(!isExport) continue;
      // Exported declarations and reexports are public contracts; their bodies, types
      // and initializer expressions can change behavior without adding an import edge.
      exports.push(statement.getText(ast));
    }
    return {exports,statements:ast.statements.map(statement=>statement.getText(ast))};
  };
  const oldData=analyze(before),newData=analyze(after);
  if(!oldData||!newData) return ["semantic_analysis_incomplete"];
  if(JSON.stringify(oldData.exports)!==JSON.stringify(newData.exports)) return ["exported_contract_change"];
  // A named reexport can expose an internal function whose declaration changed
  // while 'export {name}' itself remains byte-for-byte identical.
  if(oldData.exports.length && JSON.stringify(oldData.statements)!==JSON.stringify(newData.statements))
    return ["exported_module_internal_change"];
  return [];
}
export function contractSignals(path, before, after) {
  // Apenas texto UTF-8 puro de tamanho moderado pode receber classificação automática.
  if (typeof before !== "string" || typeof after !== "string") return ["uninspectable_content"];
  if (before.length > 524288 || after.length > 524288 || before.includes("\0") || after.includes("\0"))
    return ["uninspectable_content"];
  const changed = before !== after;
  if (!changed) return [];
  const combined = before + "\n" + after;
  return [...rules.filter(([,rx])=>rx.test(combined)).map(([label])=>label),...semanticContractSignals(path,before,after)];
}
export function auditPath(path, type) {
  if (!/\.(?:mjs|cjs|js|jsx|ts|tsx)$/.test(path)) return ["non_source_asset"];
  if (type !== "100644") return ["non_regular_git_object"];
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return ["test_change_requires_review"];
  return [];
}

const CHECKS = {
  exported_contract_change: ["export_surface_semantic_review", "runtime_contract_regression"],
  exported_module_internal_change: ["export_surface_semantic_review", "runtime_contract_regression"],
  semantic_analysis_incomplete: ["manual_ast_parse_review"],
  tenant_isolation: ["cross_tenant_rls_negative", "service_role_org_filter"],
  authentication_authorization: ["auth_rbac_mfa_negative", "api_token_access"],
  managed_ai: ["ai_managed_grants_negative", "provider_model_credentials_write_paths"],
  agent_runtime: ["agent_version_mutation_guards", "embedding_family_compatibility"],
  messaging_events: ["event_idempotency_audit", "worker_dispatch_regression"],
  sensitive_import: ["cross_module_contract_review"],
  uninspectable_content: ["manual_binary_or_large_file_review"],
  non_source_asset: ["asset_and_build_manual_review"],
  non_regular_git_object: ["symlink_executable_or_gitlink_manual_review"],
  test_change_requires_review: ["test_integrity_review"],
  protected_reverse_dependency: ["review_protected_importers", "cross_module_contract_review"],
  protected_module_import_change: ["review_protected_importers", "cross_module_contract_review", "auth_rbac_mfa_negative"],
  uninventoried_ai_surface: ["review_ai_write_surface_inventory", "ai_managed_grants_negative"],
  dependency_analysis_incomplete: ["manual_dependency_review"],
};
export function checksForSignals(signals) {
  return [...new Set(signals.flatMap(signal=>CHECKS[signal]??["manual_contract_review"]))].sort();
}
