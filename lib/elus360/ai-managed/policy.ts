/**
 * ELUS 360 — Gate 2A: contrato puro da governança técnica de IA.
 *
 * IMPORTANTE: esta unidade NÃO aplica guards às rotas nem altera o banco.
 * A autorização real deve resolver organization_id e a referência anterior
 * no servidor, exigir platform admin para concessões e falhar fechado.
 * Os valores enviados pelo cliente nunca são referência de confiança.
 */
export const CHAVES_AUTONOMIA_IA = [
  "provider",
  "model",
  "credentials",
  "operator_model",
] as const;

export type ChaveAutonomiaIa = (typeof CHAVES_AUTONOMIA_IA)[number];
export type AutonomiaIa = Record<ChaveAutonomiaIa, boolean>;

export const AUTONOMIA_IA_PADRAO: Readonly<AutonomiaIa> = Object.freeze({
  provider: false,
  model: false,
  credentials: false,
  operator_model: false,
});

/** JSON de coluna protegida é explícito: 'true', 1 e objetos não autorizam. */
export function interpretarAutonomiaIa(valor: unknown): AutonomiaIa {
  const recebido =
    valor !== null && typeof valor === "object" && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : {};

  return {
    provider: recebido.provider === true,
    model: recebido.model === true,
    credentials: recebido.credentials === true,
    operator_model: recebido.operator_model === true,
  };
}

export type CamposTecnicosIa = {
  provider?: string | null;
  model?: string | null;
  credential_id?: string | null;
  operator_model?: string | null;
  base_url?: string | null;
  is_enabled?: boolean | null;
};

const PODER_POR_CAMPO = [
  ["provider", "provider"],
  ["model", "model"],
  ["credential_id", "credentials"],
  ["operator_model", "operator_model"],
  ["base_url", "provider"],
  ["is_enabled", "provider"],
] as const satisfies ReadonlyArray<readonly [keyof CamposTecnicosIa, ChaveAutonomiaIa]>;

/**
 * Lista os grants necessários para modificar valores técnicos.
 * Campo ausente na proposta significa não alteração; null explícito é
 * comparado com a referência anterior. Reenvio idêntico não pede grant.
 */
export function mudancasTecnicas(
  anterior: Readonly<CamposTecnicosIa>,
  proposta: Readonly<CamposTecnicosIa>,
): ChaveAutonomiaIa[] {
  const alterados: ChaveAutonomiaIa[] = [];
  for (const [campo, poder] of PODER_POR_CAMPO) {
    if (proposta[campo] === undefined) continue;
    if ((anterior[campo] ?? null) !== (proposta[campo] ?? null) && !alterados.includes(poder)) {
      alterados.push(poder);
    }
  }
  return alterados;
}

export type DecisaoTecnicaIa =
  | { permitido: true; motivo: null; negados: [] }
  | {
      permitido: false;
      motivo: "referencia_indisponivel" | "proposta_invalida" | "forbidden_platform_ai";
      negados: ChaveAutonomiaIa[];
    };

/**
 * Função de política — NÃO substitui verificação de sessão, RBAC ou RLS.
 * Ausência da referência confiável e proposta inválida bloqueiam a escrita.
 * Para criação inicial, usar somente defaults escolhidos pelo servidor.
 */
export function avaliarAutonomiaParaMudanca(
  autonomiaBruta: unknown,
  anterior: CamposTecnicosIa | null | undefined,
  proposta: CamposTecnicosIa | null | undefined,
): DecisaoTecnicaIa {
  if (!anterior || typeof anterior !== "object" || Array.isArray(anterior)) {
    return { permitido: false, motivo: "referencia_indisponivel", negados: [] };
  }
  if (!proposta || typeof proposta !== "object" || Array.isArray(proposta)) {
    return { permitido: false, motivo: "proposta_invalida", negados: [] };
  }

  const poderes = interpretarAutonomiaIa(autonomiaBruta);
  const negados = mudancasTecnicas(anterior, proposta).filter((poder) => !poderes[poder]);
  return negados.length
    ? { permitido: false, motivo: "forbidden_platform_ai", negados }
    : { permitido: true, motivo: null, negados: [] };
}
