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
