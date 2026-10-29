import {
  avaliarAutonomiaParaMudanca,
  type CamposTecnicosIa,
  type DecisaoTecnicaIa,
} from "./policy";

/**
 * Gate 2B.2: fronteira de decisão para mutações técnicas.
 *
 * NÃO está conectada às rotas do DeskcommCRM nesta etapa.
 * O chamador precisa validar autenticação, RBAC/tenant, API Token e o orgId
 * antes de invocar esta função. Nunca aceitar orgId ou "anterior" do body.
 *
 * Este módulo é para chamadas exclusivas do servidor; não contém I/O nem segredos.
 * O acesso à coluna ai_autonomy é injetado, para não criar um acesso com
 * service_role escondido em uma rota comum. O adaptador real deve ser testado
 * contra auth e RLS antes da ligação no runtime.
 */
export type ResultadoDeEscritaIa =
  | DecisaoTecnicaIa
  | { permitido: false; motivo: "organizacao_invalida" | "autonomia_indisponivel"; negados: [] };

export interface PedidoDeEscritaIa {
  /** Identidade da organização obtida exclusivamente de contexto autenticado. */
  orgIdConfiavel: string;
  /** Versão/estado anterior, lido no servidor e filtrado pela organização. */
  anteriorDoServidor: CamposTecnicosIa | null;
  /** Campos técnicos normalizados de uma proposta validada por schema. */
  propostaValidada: CamposTecnicosIa | null;
}

export interface LeitorDeAutonomiaIa {
  /** Deve devolver null em organização ausente; erro de banco deve lançar. */
  lerAutonomiaPorOrganizacao(orgIdConfiavel: string): Promise<unknown>;
}

/**
 * Erro, coluna ausente, banco indisponível ou resultado inexistente = recusa.
 * Não permite que uma falha de infraestrutura reative autonomia do tenant.
 */
export async function decidirEscritaTecnicaIa(
  pedido: PedidoDeEscritaIa,
  leitor: LeitorDeAutonomiaIa,
): Promise<ResultadoDeEscritaIa> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pedido.orgIdConfiavel)) {
    return { permitido: false, motivo: "organizacao_invalida", negados: [] };
  }

  let autonomia: unknown;
  try {
    autonomia = await leitor.lerAutonomiaPorOrganizacao(pedido.orgIdConfiavel);
  } catch {
    return { permitido: false, motivo: "autonomia_indisponivel", negados: [] };
  }

  if (autonomia === null || autonomia === undefined) {
    return { permitido: false, motivo: "autonomia_indisponivel", negados: [] };
  }

  return avaliarAutonomiaParaMudanca(
    autonomia,
    pedido.anteriorDoServidor,
    pedido.propostaValidada,
  );
}
