#!/usr/bin/env node
/**
 * ELUS360 Gate 6 — diagnostic review, NOT upstream integration.
 * Pure Node.js; reads verified plan/Gate5 JSON, has no git writes or external I/O.
 * Human decisions are triage statuses only. Never emits safe_to_prepare.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED = Object.freeze({
  base:"ba24d4d366b7caf056b88553e0ed434cb0fb46de",
  target:"ca37cb7f2a35c1a0f6abc968139dd263b20ccb36",
  fork:"749aaf8fbb25b46dddd9138219e2ac032cc83336"
});
const A="compatible_for_human_review", B="requires_adaptation", C="blocked_pending_contract_proof";
export const REVIEW12 = Object.freeze([
  {path:"lib/automation/actions/add-tag.ts",decision:A,reason:"Metadado caused_by_rule passa a ser emitido somente quando ruleId existe; RPC emit_event e escopo org mantidos no diff.",tests:["event_rule_present_absent","event_reentry_idempotency","two_tenant_event_isolation"]},
  {path:"lib/automation/texto-do-followup.ts",decision:B,reason:"Busca settings de crm_pipelines por organization_id/pipeline_id e importa campos-do-render; novo contrato de campos exige integração.",tests:["cross_tenant_pipeline_labels","null_custom_fields_fallback","query_failure_followup","template_render_regression"]},
  {path:"lib/channels/adapters/meta-cloud.ts",decision:C,reason:"Expõe operação de modelos Meta pelo adapter; depende de novo binding com credenciais da sessão e WABA, superfície de escrita.",tests:["backend_role_denied","cross_tenant_waba_denied","session_credential_binding","meta_template_read_write_negative"]},
  {path:"lib/channels/pos-entrada.ts",decision:B,reason:"Substitui consulta is_personal por helper compartilhado; mantém processamento quando consulta falha, exige equivalência de privacidade.",tests:["contact_personal_true_false","service_role_org_filter","error_policy_and_redelivery","media_privacy_negative"]},
  {path:"lib/channels/zernio/ingest.ts",decision:B,reason:"Impede promover telefone extra a principal quando achado_pelo_extra; testar identidade e duplicação sob tenants.",tests:["extra_phone_preserved","cross_tenant_contact_negative","duplicate_replay_idempotency","e164_collision"]},
  {path:"lib/cobranca/uso.ts",decision:C,reason:"Nova condição OR altera cobrança de canais não pareados; precisa equivalência com trigger do plano/banco sem migration neste gate.",tests:["waha_failed_stopped_without_number","paired_number_count","other_provider_count","plan_trigger_parity"]},
  {path:"lib/cobranca/visao-geral.ts",decision:A,reason:"RPC fn_cobranca_reconciliaveis recebe order relida_em desc e limit 1; revisar assinatura/recência e retorno vazio.",tests:["rpc_order_nullable_timestamp","more_than_one_reconcile_row","rpc_shape_compatibility","tenant_safe_read"]},
  {path:"lib/contacts/cliente-pela-agenda.ts",decision:B,reason:"Muda leitura direta organizations.settings para lerRegrasDeCliente; novo módulo e política de erro exigem revisão.",tests:["org_settings_equivalence","missing_settings_default","read_error_fail_closed","two_tenant_lookup"]},
  {path:"lib/crm-b2b/import-process.ts",decision:B,reason:"Introduz consulta da dona de telefone extra e associação por org; altera deduplicação de identidade externa.",tests:["secondary_phone_match","conflicting_person_id","two_tenant_import_negative","reimport_idempotent"]},
  {path:"lib/lgpd/pdf-renderer.tsx",decision:C,reason:"Export LGPD passa a apresentar endereço físico; comprovar autorização do titular, isolamento e renderização segura de PII.",tests:["lgpd_export_authorization","cross_tenant_pdf_negative","missing_address_no_leak","pdf_escaping_layout"]},
  {path:"lib/messaging/presenca.ts",decision:C,reason:"Destinatário da presença passa a depender de último endereço recebido por conversa e contact_id; risco de remetente incorreto.",tests:["canonical_sender_peer","extra_phone_presence","group_and_lid_identity","cross_tenant_message_negative"]},
  {path:"lib/wacalls/events-bridge.ts",decision:C,reason:"Consulta SQL associa chamadas à contact_phones com coalesce e filtro organization_id; verificar associação e ausência de vazamento.",tests:["alternate_phone_call_match","cross_tenant_call_negative","merged_contact_guard","duplicate_phone_identity"]}
]);
export function buildGate6(plan,g5) {
  if(!plan||!g5||plan.mode!=="read_only"||g5.mode!=="read_only"||
     g5.authorization!=="none"||plan.gate!=="manual_review_required"||
     (plan.totals?.safe_to_prepare??0)!==0||
     !Array.isArray(plan.files)||plan.files.some(x=>x.status==="safe_to_prepare"))
    throw Error("GATE6_FAIL_CLOSED_INPUT");
  for(const [key,sha] of Object.entries(PINNED))
    if(plan.refs?.[key]!==sha || g5.refs?.[key]!==sha)throw Error("GATE6_REF_MISMATCH:"+key);
  const triad=g5.triad12?.candidates,mods=g5.target_graph?.modules;
  if(!Array.isArray(triad)||triad.length!==12||!Array.isArray(mods)||mods.length!==45)
    throw Error("GATE6_COUNT_MISMATCH");
  const tree=g5.target_graph?.target_graph;
  if(!tree||!Number.isInteger(tree.sources)||tree.sources<=0||
     !Number.isInteger(tree.module_edges)||tree.module_edges<0||
     !Array.isArray(tree.unresolved_examples))
    throw Error("GATE6_GRAPH_INSTRUMENTATION_MISSING");
  if(tree.complete===true && tree.unresolved_count>0) throw Error("GATE6_FALSE_AST_COMPLETENESS");
  const risk=new Map((g5.target_graph.distance_comparison_12??[]).map(x=>[x.path,x]));
  const reviewed=new Map(triad.map(x=>[x.path,x]));
  if(reviewed.size!==12||risk.size!==12||new Set(mods.map(x=>x.path)).size!==45)
    throw Error("GATE6_DUPLICATE_OR_INCOMPLETE_PATH");
  const reviewed12=REVIEW12.map(rule=>{
    const x=reviewed.get(rule.path),r=risk.get(rule.path);
    if(!x||!r||x.approval!=="none"||x.actual_status==="safe_to_prepare"||
       x.oid?.base!==x.oid?.fork||x.oid?.target===x.oid?.fork||
       !x.diff||r.approval!=="none")
      throw Error("GATE6_UNTRUSTED_TRIAD:"+rule.path);
    return {...rule,prior_status:x.actual_status,authorization:"none",
      evidence:{
        blobs:x.oid,changed_lines:{added:x.added_lines,removed:x.removed_lines},
        fork_graph_min_distance:r.fork_distance,
        target_graph_min_distance:r.target_distance,
        target_first_hop_directions:r.target_first_hop_directions,
        graph_complete:tree.complete,
        upstream_diff_present:true
      },acceptance:"no_functional_proof_no_prepare"};
  });
  const presentPaths=new Set(plan.files.map(x=>x.path));
  const reviewed45=mods.map(x=>{
    if(x.approval!=="none"||!x.source_in_target||x.source_in_fork||
       !presentPaths.has(x.path)||x.original_status==="safe_to_prepare")
      throw Error("GATE6_NEW_SOURCE_PROVENANCE:"+x.path);
    const direct=x.direct_protected_consumers.length;
    const trans=x.transitive_protected_consumer_count;
    const imports=x.imports_protected.length;
    const critical=/^lib\/(?:channels|contacts|automation|mcp|system|financeiro|messaging|inbox|planilha|waha)\//.test(x.path)||
      /(?:Arquivos|ConfirmarJuncao|DialogoDeApagarModelo)/.test(x.path);
    const riskTier=(direct>0||imports>0||critical)?"high_priority_contract_review":
      (trans>0?"transitive_contract_review":"new_module_interface_review");
    return {path:x.path,decision:"requires_targeted_review",authorization:"none",
      risk_tier:riskTier,
      graph_evidence:{direct_consumer_count:x.direct_consumer_count,
        direct_protected_consumers:direct,
        transitive_protected_consumer_count:trans,
        imports_protected:imports,
        changed_upstream_dependencies:x.imports_changed_target_files.length,
        target_ast_unresolved:x.target_ast_unresolved.length},
      required_tests:x.required_checks,
      note:"Prioritization only; caller authz/RLS, source contract and runtime behavior unproven"};
  });
  const categoryCounts=Object.fromEntries([A,B,C].map(x=>[x,reviewed12.filter(y=>y.decision===x).length]));
  const priorityCounts=Object.fromEntries(["high_priority_contract_review","transitive_contract_review","new_module_interface_review"].map(x=>[x,reviewed45.filter(y=>y.risk_tier===x).length]));
  const incomplete=tree.complete!==true||plan.dependency_scan?.complete!==true;
  const computed={
    fork_unresolved:plan.dependency_scan?.unresolved_count??null,
    target_unresolved:tree.unresolved_count,
    target_sites:tree.unresolved_examples.map(x=>({path:x.path,reason:x.reason})),
    reason:"computed_module_specifier",
    completeness:incomplete?"incomplete":"complete",
    disposition:"investigate_demo_import_scope_without_relaxing_global_gate"
  };
  return {schema_version:1,tool:"elus-upstream-gate6-review",
    mode:"read_only",status:"manual_review_required",authorization:"none",
    refs:PINNED,CI_cannot_prove_runtime:true,
    graph_complete:!incomplete,computed_imports:computed,
    counts:{reviewed12:12,new_modules:45,decisions:categoryCounts,priorities:priorityCounts,
      safe_to_prepare:0},
    review12:reviewed12,review45:reviewed45,
    limitations:["No upstream patches prepared or imported",
      "Decision categories are manual triage; not proof of semantic equivalence",
      "No real database/auth/RLS/E2E tests executed on merged code",
      "No sabotage or paired agent/tool acceptance executed",
      "AST graph incomplete; no candidate may be promoted automatically"]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4)throw Error("USAGE: node gate6-evidence.mjs PLAN.json GATE5.json");
    const r=buildGate6(JSON.parse(readFileSync(process.argv[2],"utf8")),
      JSON.parse(readFileSync(process.argv[3],"utf8")));
    process.stdout.write(JSON.stringify(r,null,2)+"\n");
  }catch(e){process.stderr.write("GATE6_NO_GO:"+String(e.message)+"\n");process.exitCode=3}
}
