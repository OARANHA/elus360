import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdmin,
  requirePlatformAdminEscrita,
} from "@/lib/auth/requirePlatformAdmin";
import { interpretarAutonomiaIa } from "@/lib/elus360/ai-managed/policy";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Gate 2B.2: endpoint de controle do Superadmin ELUS.
 *
 * Ainda sem painel; há guardas preparatórias nas rotas do tenant, mas a ativação
 * depende da migration, da cobertura integral das mutações e dos testes de banco.
 * A coluna organizations.ai_autonomy não existe antes da migration do gate;
 * nesse estado, a leitura/escrita retornam erro e nunca fazem fallback para
 * organizations.settings.
 */
const paramsSchema = z.object({ id: z.string().uuid() });
const permissionsSchema = z
  .object({
    provider: z.boolean(),
    model: z.boolean(),
    credentials: z.boolean(),
    operator_model: z.boolean(),
  })
  .strict();

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();

  try {
    await requirePlatformAdmin();
  } catch (e) {
    return falhaDaEscritaDePlatformAdmin(e, requestId);
  }

  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return fail("validation_failed", "Tenant id inválido", 400, { requestId });
  }
  const orgId = parsed.data.id;

  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("id, ai_autonomy")
    .eq("id", orgId)
    .maybeSingle();

  if (error) return fail("internal_error", "Falha ao consultar permissões de IA", 500, { requestId });
  if (!data) return fail("not_found", "Tenant not found", 404, { requestId });

  return ok(
    { organization_id: orgId, permissions: interpretarAutonomiaIa(data.ai_autonomy) },
    { requestId },
  );
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return fail("validation_failed", "Tenant id inválido", 400, { requestId });
  }
  const orgId = params.data.id;

  const supportDenied = await requireSupportWrite(orgId);
  if (supportDenied) return supportDenied;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (e) {
    return falhaDaEscritaDePlatformAdmin(e, requestId);
  }

  const body = permissionsSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return fail("validation_failed", "Permissões inválidas", 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: org, error: loadError } = await admin
    .from("organizations")
    .select("id, ai_autonomy")
    .eq("id", orgId)
    .maybeSingle();

  if (loadError) return fail("internal_error", "Falha ao ler permissões", 500, { requestId });
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });

  const anterior = interpretarAutonomiaIa(org.ai_autonomy);
  const alterou = (Object.keys(anterior) as Array<keyof typeof anterior>)
    .some((campo) => anterior[campo] !== body.data[campo]);

  if (!alterou) {
    return ok({ organization_id: orgId, permissions: anterior, changed: false }, { requestId });
  }

  // CAS por valor bruto: uma atualização concorrente de autorização NÃO pode
  // ser perdida nem ressuscitar grant revogado. Não comparar com settings.
  const { data: updated, error } = await admin
    .from("organizations")
    .update({ ai_autonomy: body.data })
    .eq("id", orgId)
    .eq("ai_autonomy", JSON.stringify(org.ai_autonomy ?? {}))
    .select("id")
    .maybeSingle();

  if (error) return fail("internal_error", "Falha ao atualizar permissões", 500, { requestId });
  if (!updated) {
    return fail("conflict", "Permissões alteradas por outra operação; atualize a tela", 409, { requestId });
  }

  void audit({
    action: "platform_admin.ai_autonomy_updated",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { previous: anterior, next: body.data },
  });

  return ok({ organization_id: orgId, permissions: body.data, changed: true }, { requestId });
}
