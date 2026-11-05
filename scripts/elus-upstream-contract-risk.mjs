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
export function contractSignals(path, before, after) {
  // Apenas texto UTF-8 puro de tamanho moderado pode receber classificação automática.
  if (typeof before !== "string" || typeof after !== "string") return ["uninspectable_content"];
  if (before.length > 524288 || after.length > 524288 || before.includes("\0") || after.includes("\0"))
    return ["uninspectable_content"];
  const changed = before !== after;
  if (!changed) return [];
  const combined = before + "\n" + after;
  return rules.filter(([,rx])=>rx.test(combined)).map(([label])=>label);
}
export function auditPath(path, type) {
  if (!/\.(?:mjs|cjs|js|jsx|ts|tsx)$/.test(path)) return ["non_source_asset"];
  if (type !== "100644") return ["non_regular_git_object"];
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return ["test_change_requires_review"];
  return [];
}

const CHECKS = {
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
};
export function checksForSignals(signals) {
  return [...new Set(signals.flatMap(signal=>CHECKS[signal]??["manual_contract_review"]))].sort();
}
