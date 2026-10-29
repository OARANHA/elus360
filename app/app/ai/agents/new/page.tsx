import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { idsDosProvedoresOferecidos } from "@/lib/ai/pontos/provedores-oferecidos";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
import { lerAutonomiaIa, podeGerenciarIaDaPlataforma } from "@/lib/elus360/ai-managed/server";
import { AUTONOMIA_IA_PADRAO } from "@/lib/elus360/ai-managed/policy";

import { AgentForm } from "../[id]/_components/AgentForm";

export const dynamic = "force-dynamic";

const CREDENTIAL_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

/**
 * Os provedores cuja chave veio na INSTALAÇÃO (`.env`), não da tela de
 * Credenciais.
 *
 * Sai de `lerAmbiente`, a mesma leitura que o retrato da instalação usa — uma
 * segunda lista de nomes de variável divergiria no dia em que um provedor novo
 * entrasse.
 */
function provedoresDaInstalacao(): string[] {
  const a = lerAmbiente();
  return Object.entries(a.chavesDeProvedor)
    .filter(([, tem]) => tem)
    .map(([id]) => id);
}

export default async function NewAgentPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const autonomiaTecnica = podeGerenciarIaDaPlataforma(user)
    ? { provider: true, model: true, credentials: true, operator_model: true }
    : (await lerAutonomiaIa(activeOrg.orgId)) ?? AUTONOMIA_IA_PADRAO;

  const supabase = await createClient();
  const [orgRes, credentialsRes, channelSessions] = await Promise.all([
    // O provedor que a organização JÁ usa: sem ele, o agente novo nascia
    // `anthropic` e o formulário pedia "Cadastrar credencial anthropic" para
    // quem só tem chave da OpenAI.
    supabase.from("organizations").select("settings").eq("id", activeOrg.orgId).maybeSingle(),
    supabase
      .from("ai_provider_credentials_safe")
      .select(CREDENTIAL_COLUMNS)
      .eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
  ]);

  const credentials = (credentialsRes.data ?? []) as CredentialRow[];
  const llmDaOrg = (
    orgRes.data?.settings as { llm?: { provider?: string; default_model?: string | null; credential_id?: string | null } } | null
  )?.llm;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <AgentForm
        mode="create"
        autonomiaTecnica={autonomiaTecnica}
        credentials={credentials}
        provedoresDaInstalacao={provedoresDaInstalacao()}
        provedoresOferecidos={await idsDosProvedoresOferecidos(createAdminClient())}
        provedorPadrao={llmDaOrg?.provider}
        modeloPadrao={llmDaOrg?.default_model ?? undefined}
        credencialPadrao={llmDaOrg?.credential_id ?? null}
        channelSessions={channelSessions}
        organizationTimezone={fusoUtilizavel(activeOrg.timezone)}
      />
    </div>
  );
}
