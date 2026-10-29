"use client";

/** Configuração padrão por tenant: recuperação focal do painel legado.
 * Credenciais já existentes são consultadas pela API segura; esta interface
 * não cadastra chaves ou endpoints nem duplica o onboarding.
 */
import * as React from "react";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVEDOR_POR_ID } from "@/lib/ai/pontos/provedores";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Modelo = { provider: string; model_id: string; display_name: string };
type Credencial = { id: string; provider: string; label: string; api_key_last4: string; is_active: boolean; validated_at: string | null; models_available: string[] };
type Dados = {
  organization_name: string;
  padrao: { provider: string; default_model: string | null; credential_id: string | null; configured: boolean };
  provedores: string[];
  modelos: Modelo[];
  credenciais: Credencial[];
  pode_editar: boolean;
  agentes_publicados: number;
  pontos_com_configuracao_propria: number;
};
type Resposta = { data?: Dados; error?: { message?: string } };

export function TenantAiPlatformDefault({ organizationId }: { organizationId: string }) {
  const t = useT();
  const endpoint = `/api/v1/admin/tenants/${encodeURIComponent(organizationId)}/ai-default`;
  const [dados, setDados] = React.useState<Dados | null>(null);
  const [provider, setProvider] = React.useState("");
  const [model, setModel] = React.useState("");
  const [credentialId, setCredentialId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const load = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: "no-store", signal });
    const body = await response.json() as Resposta;
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? t("Falha ao consultar a IA da empresa."));
    setDados(body.data);
    setProvider(body.data.padrao.provider);
    setModel(body.data.padrao.default_model ?? "");
    setCredentialId(body.data.padrao.credential_id ?? "");
  }, [endpoint]);
  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal).catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : t("Falha de conexão."));
    }).finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [load]);

  const credentials = (dados?.credenciais ?? []).filter((c) => c.provider === provider);
  const credencial = credentials.find((c) => c.id === credentialId);
  const catalogo = (dados?.modelos ?? []).filter((m) => m.provider === provider);
  const modelos = credencial?.is_active && credencial.validated_at && credencial.models_available.length
    ? credencial.models_available.map((id) => ({ provider, model_id: id, display_name: id }))
    : catalogo;
  const unchanged = !!dados && provider === dados.padrao.provider && model === (dados.padrao.default_model ?? "") && credentialId === (dados.padrao.credential_id ?? "");
  const bloqueado = saving || loading || !dados?.pode_editar;
  async function save() {
    if (bloqueado || unchanged || !model.trim() || (provider === "custom" && !credentialId)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, default_model: model.trim(), credential_id: credentialId || null }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? t("Não foi possível salvar."));
      await load();
      setNotice(t("Padrão salvo. Agentes publicados e configurações próprias foram preservados."));
    } catch (e) { setError(e instanceof Error ? e.message : t("Falha de conexão.")); }
    finally { setSaving(false); }
  }
  return (
    <section className="space-y-4 rounded-lg border p-5" aria-label={t("IA fornecida pela plataforma")}>
      <div>
        <h3 className="text-lg font-semibold">{t("IA fornecida pela plataforma")}</h3>
        <p className="text-sm text-muted-foreground">{t("Defina provedor, modelo e credencial padrão desta empresa. Agentes já publicados não serão alterados.")}</p>
        {dados ? <p className="text-xs text-muted-foreground">{t("Organização selecionada:")} {dados.organization_name}</p> : null}
      </div>
      {loading ? <p>{t("Consultando configuração…")}</p> : dados ? <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="elus-padrao-provider" className="text-sm font-medium">{t("Provedor padrão")}</label>
            <Select value={provider} disabled={bloqueado} onValueChange={(v) => { setProvider(v); setModel(""); setCredentialId(""); }}>
              <SelectTrigger id="elus-padrao-provider"><SelectValue placeholder={t("Escolha o provedor")}/></SelectTrigger>
              <SelectContent>{dados.provedores.map((id) => <SelectItem key={id} value={id}>{PROVEDOR_POR_ID.get(id)?.rotulo ?? id}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="elus-padrao-model" className="text-sm font-medium">{t("Modelo padrão")}</label>
            {modelos.length && (!model || modelos.some((m) => m.model_id === model)) ?
              <Select value={model || undefined} disabled={bloqueado} onValueChange={setModel}>
                <SelectTrigger id="elus-padrao-model"><SelectValue placeholder={t("Escolha o modelo")}/></SelectTrigger>
                <SelectContent>{modelos.map((m) => <SelectItem key={m.model_id} value={m.model_id}>{m.display_name || m.model_id}</SelectItem>)}</SelectContent>
              </Select> : <Input id="elus-padrao-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={bloqueado} maxLength={120} placeholder={t("Identificador exato do modelo")}/>}
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="elus-padrao-credencial" className="text-sm font-medium">{t("Credencial da organização")}</label>
          <Select value={credentialId || (provider === "custom" ? undefined : "__installation__")} disabled={bloqueado}
            onValueChange={(id) => { setCredentialId(id === "__installation__" ? "" : id); setModel(""); }}>
            <SelectTrigger id="elus-padrao-credencial"><SelectValue placeholder={t("Escolha a credencial")}/></SelectTrigger>
            <SelectContent>
              {provider !== "custom" ? <SelectItem value="__installation__">{t("Chave da instalação (se disponível)")}</SelectItem> : null}
              {credentials.map((c) => <SelectItem key={c.id} value={c.id} disabled={!c.is_active || !c.validated_at}>{c.label} · {t("final")} {c.api_key_last4}</SelectItem>)}
            </SelectContent>
          </Select>
          {provider === "custom" && credentials.length === 0 ? <p className="text-xs text-muted-foreground">{t("Nenhuma credencial personalizada validada para esta empresa. Cadastre-a no fluxo de credenciais autorizado antes de ativar.")}</p> : null}
        </div>
        <p className="text-xs text-muted-foreground">{dados.agentes_publicados} {t("agentes publicados")} · {dados.pontos_com_configuracao_propria} {t("configurações próprias preservadas")}</p>
        {dados.pode_editar ? <Button type="button" disabled={bloqueado || unchanged || !model.trim() || (provider === "custom" && !credentialId)} onClick={() => void save()}>{saving ? t("Salvando…") : t("Ativar padrão")}</Button> : null}
      </> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
