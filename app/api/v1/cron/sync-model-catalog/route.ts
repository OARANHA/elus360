/**
 * GET/POST /api/v1/cron/sync-model-catalog — o catálogo que se atualiza sozinho.
 *
 * A OpenRouter publica ~400 modelos de ~58 fabricantes e a lista muda sozinha.
 * Até aqui, `ai_models` era semeada por migration: a cada modelo novo do
 * mercado, o self-hoster precisava esperar uma release do DeskcommCRM para
 * poder escolhê-lo — e o preço da tabela envelhecia junto, o que não é
 * cosmético: é o número que faz o teto de orçamento da organização disparar na
 * hora certa, ou não disparar.
 *
 * Este cron busca o catálogo público (sem chave — o endpoint de modelos da
 * OpenRouter é aberto), traduz e concilia. A regra da conciliação vive em
 * `lib/ai/catalogo/sincronizar.ts`; aqui é só borda e I/O.
 *
 * O que ele deliberadamente NÃO faz:
 *
 *  - **não apaga nada.** Modelo que sai da origem recebe `deprecated_at`. A
 *    linha continua referenciada pelo histórico de custo, e apagá-la faria o
 *    relatório do mês passado perder o preço com que a conta foi somada.
 *  - **não toca em linha de outra origem.** `source = 'manual'` é a curadoria
 *    que veio nas migrations; varrer a tabela inteira apagaria os defaults
 *    recomendados sem o operador nunca saber por quê.
 *  - **não aceita resposta suspeita.** Origem devolvendo menos da metade do que
 *    já conhecíamos aborta a rodada — ver o piso de sanidade. Catálogo
 *    desatualizado é recuperável; catálogo esvaziado por um soluço de rede
 *    custa a confiança na tela.
 *
 * Auth: mesmo contrato dos demais crons (Bearer `INTERNAL_CRON_SECRET` |
 * `INTERNAL_SECRET`, fail-closed).
 *
 * NOTA DE DEPLOY: o agendamento vive no serviço `scheduler` do
 * `docker-compose.prod.yml`, como os outros crons — não há `vercel.json` neste
 * repo. Cadência diária basta: modelo novo que demora um dia para aparecer no
 * seletor não quebra ninguém.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { autorizaCron } from "@/lib/auth/cron-auth";
import { fail, ok } from "@/lib/api/wrappers";
import {
  FONTE_OPENROUTER,
  traduzirCatalogo,
  type ModeloDaOpenRouter,
} from "@/lib/ai/catalogo/openrouter";
import {
  CatalogoSuspeitoError,
  planejarSincronizacao,
  type ModeloExistente,
} from "@/lib/ai/catalogo/sincronizar";
import { logger } from "@/lib/logger";
import { executarSincronizacoesIndependentes } from "@/lib/ai/catalogo/fontes-independentes";
import { CHUTES_CATALOG_URL, FONTE_CHUTES, traduzirCatalogoChutes, type ModeloChutes } from "@/lib/ai/catalogo/chutes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ENDPOINT_DO_CATALOGO = "https://openrouter.ai/api/v1/models";
const TIMEOUT_MS = 20_000;

export interface ResultadoDaSincronizacao {
  fonte: string;
  recebidos: number;
  gravados: number;
  depreciados: number;
  ressuscitados: number;
}

/**
 * Separado do handler para o teste exercitar a REGRA sem montar request/auth —
 * mesmo padrão de `recover-stuck-messages`.
 */
export async function sincronizarCatalogo(
  admin: ReturnType<typeof createAdminClient>,
  buscar: () => Promise<ModeloDaOpenRouter[]>,
): Promise<ResultadoDaSincronizacao> {
  const daOrigem = traduzirCatalogo(await buscar());

  const { data: existentes, error: erroLeitura } = await admin
    .from("ai_models")
    .select("model_id, deprecated_at")
    .eq("source", FONTE_OPENROUTER);
  if (erroLeitura) throw new Error(`catalogo_leitura_falhou: ${erroLeitura.message}`);

  const plano = planejarSincronizacao(daOrigem, (existentes ?? []) as ModeloExistente[]);

  const agora = new Date().toISOString();

  if (plano.paraGravar.length > 0) {
    const { error } = await admin.from("ai_models").upsert(
      plano.paraGravar.map((l) => ({ ...l, synced_at: agora, deprecated_at: null })),
      { onConflict: "provider,model_id" },
    );
    if (error) throw new Error(`catalogo_upsert_falhou: ${error.message}`);
  }

  if (plano.paraDepreciar.length > 0) {
    const { error } = await admin
      .from("ai_models")
      .update({ deprecated_at: agora })
      .eq("source", FONTE_OPENROUTER)
      .in("model_id", plano.paraDepreciar);
    if (error) throw new Error(`catalogo_depreciacao_falhou: ${error.message}`);
  }

  // Ressuscitar é feito pelo upsert acima (`deprecated_at: null`); o número é
  // reportado para o log distinguir "voltou" de "entrou agora" — sem isso, um
  // catálogo que oscila pareceria estável.
  return {
    fonte: FONTE_OPENROUTER,
    recebidos: daOrigem.length,
    gravados: plano.paraGravar.length,
    depreciados: plano.paraDepreciar.length,
    ressuscitados: plano.paraRessuscitar.length,
  };
}

async function buscarDaOpenRouter(): Promise<ModeloDaOpenRouter[]> {
  const res = await fetch(ENDPOINT_DO_CATALOGO, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`catalogo_origem_status_${res.status}`);
  const json = (await res.json()) as { data?: ModeloDaOpenRouter[] };
  if (!Array.isArray(json.data)) {
    throw new Error("catalogo_origem_shape_inesperado — a resposta não trouxe `data` como lista");
  }
  return json.data;
}

/**
 * Fonte independente: só grava linhas source=chutes; jamais altera modelos
 * semeados ou vindos da OpenRouter. Se a resposta vier vazia/parcial, recusa
 * a depreciação em massa pela mesma régua do sincronizador oficial.
 */
async function sincronizarChutes(admin: ReturnType<typeof createAdminClient>) {
  const resposta = await fetch(CHUTES_CATALOG_URL, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!resposta.ok) throw new Error(`chutes_catalog_status_${resposta.status}`);
  const json = (await resposta.json()) as { data?: ModeloChutes[] };
  if (!Array.isArray(json.data)) throw new Error("chutes_catalog_shape_invalido");
  const linhas = traduzirCatalogoChutes(json.data);
  if (!linhas.length) throw new Error("chutes_catalog_sem_modelos_validos");
  const { data: existentes, error } = await admin.from("ai_models")
    .select("model_id, deprecated_at").eq("source", FONTE_CHUTES);
  if (error) throw new Error(`chutes_catalog_leitura: ${error.message}`);
  const plano = planejarSincronizacao(linhas, (existentes ?? []) as ModeloExistente[]);
  const agora = new Date().toISOString();
  if (plano.paraGravar.length) {
    const { error: erro } = await admin.from("ai_models").upsert(
      plano.paraGravar.map((l) => ({ ...l, synced_at: agora, deprecated_at: null })),
      { onConflict: "provider,model_id" },
    );
    if (erro) throw new Error(`chutes_catalog_upsert: ${erro.message}`);
  }
  if (plano.paraDepreciar.length) {
    const { error: erro } = await admin.from("ai_models")
      .update({ deprecated_at: agora }).eq("source", FONTE_CHUTES)
      .in("model_id", plano.paraDepreciar);
    if (erro) throw new Error(`chutes_catalog_depreciacao: ${erro.message}`);
  }
  return { fonte: FONTE_CHUTES, recebidos: linhas.length, gravados: plano.paraGravar.length };
}

// Esta rota aceitava SÓ o primeiro segredo definido (`INTERNAL_CRON_SECRET ||
// INTERNAL_SECRET`), e era a única das rotas de cron a fazer isso. O efeito era
// 401 em toda instalação do kit: o `install.sh` gera os DOIS segredos com valores
// diferentes e o `crond` do serviço `scheduler` manda `Bearer $INTERNAL_SECRET`
// (`docker/scheduler/entrypoint.sh`), que não era o esperado aqui. O `curl` do
// crontab descarta a saída, então o 401 diário não aparecia em lugar nenhum.
// Agora usa o mesmo portão das outras: `lib/auth/cron-auth.ts`, que confere o
// Bearer (ou `x-cron-secret`) contra os dois segredos e falha fechado sem nenhum.
// A cerca contra o padrão voltar é `tests/unit/cron-aceita-os-dois-segredos.test.ts`.

async function handler(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("unauthorized", "cron secret ausente ou inválido", 401, { requestId });
  }
  // Cada fonte precisa rodar mesmo se a outra estiver indisponível.
  // A falha de uma não pode impedir o catálogo da outra de atualizar.
  const fontes = await executarSincronizacoesIndependentes(
    () => sincronizarCatalogo(createAdminClient(), buscarDaOpenRouter),
    () => sincronizarChutes(createAdminClient()),
  );
  const [openrouter, chutes] = fontes;
  const erros: Record<string, string> = {};
  if (openrouter.status === "rejected") {
    erros[FONTE_OPENROUTER] = openrouter.reason instanceof CatalogoSuspeitoError
      ? "catalogo_suspeito"
      : "sincronizacao_falhou";
    logger.warn("[sync-model-catalog] OpenRouter não sincronizado", {
      motivo: erros[FONTE_OPENROUTER], request_id: requestId,
    });
  }
  if (chutes.status === "rejected") {
    erros[FONTE_CHUTES] = "sincronizacao_falhou";
    logger.warn("[sync-model-catalog] Chutes não sincronizado", {
      motivo: erros[FONTE_CHUTES], request_id: requestId,
    });
  }
  const sucessoOpenRouter = openrouter.status === "fulfilled" ? openrouter.value : null;
  const sucessoChutes = chutes.status === "fulfilled" ? chutes.value : null;
  if (!sucessoOpenRouter && !sucessoChutes) {
    logger.error("[sync-model-catalog] nenhuma fonte sincronizada", {
      fontes: Object.keys(erros), request_id: requestId,
    });
    return fail("cron_failed", "Nenhuma fonte de catálogo foi sincronizada", 503, { requestId });
  }
  logger.info("[sync-model-catalog] concluído", {
    openrouter: sucessoOpenRouter, chutes: sucessoChutes,
    fontes_com_erro: Object.keys(erros), request_id: requestId,
  });
  return ok({ openrouter: sucessoOpenRouter, chutes: sucessoChutes, erros }, { requestId });
}

export const GET = handler;
export const POST = handler;
