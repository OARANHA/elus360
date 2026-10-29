import "server-only";

import { loadAuthUser } from "@/lib/auth/server";
import { decidirEscritaTecnicaIa } from "./guard";
import { mudancasTecnicas, type CamposTecnicosIa } from "./policy";
import { lerAutonomiaIa, podeGerenciarIaDaPlataforma } from "./server";

/**
 * Integração central para rotas de versões. Autenticação, tenant, RBAC, escopo
 * e teto de API Token DEVEM ser validados pelo handler antes desta chamada.
 * Os campos anteriores devem vir de leitura no servidor, filtrada pelo tenant.
 * Uma aprovação nesta etapa não substitui o gate transacional contra revogação.
 */
export async function podeAlterarTecnicaDeVersao(input: {
  via: "session" | "api_token";
  authUserId: string | null;
  organizationId: string;
  anteriorDoServidor: CamposTecnicosIa;
  propostaValidada: CamposTecnicosIa;
}): Promise<boolean> {
  if (mudancasTecnicas(input.anteriorDoServidor, input.propostaValidada).length === 0)
    return true;

  if (input.via === "session") {
    const usuario = await loadAuthUser();
    if (!usuario || usuario.id !== input.authUserId || usuario.support) return false;
    if (podeGerenciarIaDaPlataforma(usuario)) return true;
  }

  const decisao = await decidirEscritaTecnicaIa(
    {
      orgIdConfiavel: input.organizationId,
      anteriorDoServidor: input.anteriorDoServidor,
      propostaValidada: input.propostaValidada,
    },
    { lerAutonomiaPorOrganizacao: lerAutonomiaIa },
  );
  return decisao.permitido;
}
