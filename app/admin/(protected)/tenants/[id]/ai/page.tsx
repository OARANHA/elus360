import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { TenantAiPermissions } from "@/components/elus360/admin/TenantAiPermissions";

/** ELUS360: interface própria, sem replicar autorização nem gravação do backend. */
export default async function AutonomiaIaDaEmpresa({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return <p role="alert">Empresa inválida.</p>;
  }
  return <TenantAiPermissions organizationId={id} />;
}
