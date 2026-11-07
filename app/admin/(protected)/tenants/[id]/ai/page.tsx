import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { loadAuthUser } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { TenantAiPermissions } from "@/components/elus360/admin/TenantAiPermissions";
import { TenantAiPlatformDefault } from "@/components/elus360/admin/TenantAiPlatformDefault";

/** ELUS360: interface própria, sem replicar autorização nem gravação do backend. */
export default async function AutonomiaIaDaEmpresa({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    const usuario = await loadAuthUser();
    return <p role="alert">{traduzir("Empresa inválida.", usuario?.idioma ?? "pt-BR")}</p>;
  }
  return (
    <div className="space-y-6">
      <TenantAiPermissions organizationId={id} />
      <TenantAiPlatformDefault organizationId={id} />
    </div>
  );
}
