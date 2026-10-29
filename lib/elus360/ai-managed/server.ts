import "server-only";

import type { AuthUser } from "@/lib/auth/types";
import { fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";
import { AUTONOMIA_IA_PADRAO, interpretarAutonomiaIa, type ChaveAutonomiaIa } from "./policy";

/**
 * Adaptador da governança funcional do ELUS legado.
 * Preparado para integração após a migration ai_autonomy; ainda não conectado
 * às rotas de tenant. A identidade orgId deve vir de requireRole/auth-dual,
 * nunca do body ou de um parâmetro de organização não autorizado.
 */
type Ator = Pick<AuthUser, "is_platform_admin" | "platform_admin_scope" | "support">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function podeGerenciarIaDaPlataforma(user: Ator): boolean {
  return user.is_platform_admin === true &&
    user.platform_admin_scope === "full" &&
    !user.support;
}

export async function lerAutonomiaIa(orgIdConfiavel: string) {
  if (!UUID.test(orgIdConfiavel)) return null;
  try {
    const { data, error } = await createAdminClient()
      .from("organizations")
      .select("ai_autonomy")
      .eq("id", orgIdConfiavel)
      .maybeSingle();
    if (error || !data) return null;
    return interpretarAutonomiaIa(data.ai_autonomy);
  } catch {
    return null;
  }
}

export async function podeConfigurarIa(
  user: Ator,
  orgIdConfiavel: string,
  chave: ChaveAutonomiaIa,
): Promise<boolean> {
  if (!UUID.test(orgIdConfiavel) || user.support) return false;
  if (podeGerenciarIaDaPlataforma(user)) return true;
  const grants = (await lerAutonomiaIa(orgIdConfiavel)) ?? AUTONOMIA_IA_PADRAO;
  return grants[chave] === true;
}

export async function recusaConfiguracaoDeIa(
  user: Ator,
  orgIdConfiavel: string,
  chave: ChaveAutonomiaIa,
  requestId?: string,
): Promise<Response | null> {
  return (await podeConfigurarIa(user, orgIdConfiavel, chave))
    ? null
    : fail("forbidden_platform_ai", "Esta configuração técnica de IA é gerenciada pela plataforma ELUS.", 403, { requestId });
}
