/**
 * Grants apenas na organização descartável do E2E, usando a API real de
 * superadmin (full + MFA), sem escrita service_role em organizations.ai_autonomy.
 * A parte 4 testa instalação fresca e não possui .e2e-creds.json: não participa.
 * Nenhum caminho deste setup pode alcançar um Supabase externo.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";

import { lerCreds, loginComoDono } from "./helpers/login-admin";

const GRANTS = {
  provider: true,
  model: true,
  credentials: true,
  operator_model: true,
} as const;

type CredsLocais = ReturnType<typeof lerCreds> & {
  org_id: string;
  org_slug: string;
  supabase_url: string;
};

export default async function prepararAutonomiaE2E(config: FullConfig): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/|$)/.test(supabaseUrl)) {
    throw new Error("E2E ELUS360 recusa conceder grants fora do Supabase localhost.");
  }

  // A parte 4 usa exclusivamente a instalação fresca criada por bootstrap-owner.
  if (!existsSync(join(process.cwd(), ".e2e-creds.json"))) return;
  const creds = lerCreds() as CredsLocais;
  if (
    creds.org_slug !== "e2e-test-org" ||
    !/^[0-9a-f-]{36}$/i.test(creds.org_id ?? "") ||
    creds.supabase_url !== supabaseUrl ||
    !creds.users?.dono?.email?.endsWith("@deskcomm.test")
  ) {
    throw new Error("Organização E2E não é a fixture descartável esperada.");
  }

  const baseURL = config.projects.find((p) => p.name === "chromium")?.use.baseURL;
  if (typeof baseURL !== "string" || !/^http:\/\/localhost:\d+$/.test(baseURL)) {
    throw new Error("Servidor E2E deve usar localhost.");
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await loginComoDono(page, creds); // autenticação real e TOTP, não bypass
      const endpoint = `/api/v1/admin/tenants/${creds.org_id}/ai-permissions`;
      const antes = await page.request.get(endpoint);
      if (!antes.ok()) {
        throw new Error(`Leitura administrativa da autonomia falhou: HTTP ${antes.status()}`);
      }
      const atual = (await antes.json()) as {
        data?: { permissions?: Record<keyof typeof GRANTS, boolean> };
      };
      if (!atual.data?.permissions) {
        throw new Error("Endpoint administrativo não retornou as quatro permissões.");
      }

      if (Object.keys(GRANTS).some((chave) => atual.data!.permissions![chave as keyof typeof GRANTS] !== true)) {
        const alteracao = await page.request.patch(endpoint, { data: GRANTS });
        if (!alteracao.ok()) {
          throw new Error(`Concessão auditada de autonomia falhou: HTTP ${alteracao.status()}`);
        }
      }

      const resposta = await page.request.get(endpoint);
      if (!resposta.ok()) throw new Error("Não foi possível verificar os grants E2E.");
      const confirmado = (await resposta.json()) as {
        data?: { permissions?: Record<keyof typeof GRANTS, boolean> };
      };
      if (Object.keys(GRANTS).some((chave) => confirmado.data?.permissions?.[chave as keyof typeof GRANTS] !== true)) {
        throw new Error("Grants E2E não foram comprovados pelo endpoint administrativo.");
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
