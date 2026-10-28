import Link from "next/link";
import { redirect } from "next/navigation";

import { marcaDaSaida } from "@/lib/branding/saida";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

/**
 * Entrada pública da instalação: apresentação do produto e explicação das
 * integrações Google para visitantes sem sessão. Autenticados seguem a /app.
 * Os links legais permanecem públicos e visíveis, inclusive em telas pequenas.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  const marca = await marcaDaSaida(null);
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="relative isolate flex min-h-[100svh] flex-col overflow-x-hidden bg-[#050917] text-white lg:h-[100svh] lg:overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_38%_26%,rgba(24,110,255,.22),transparent_47%),radial-gradient(ellipse_at_80%_65%,rgba(162,45,238,.15),transparent_42%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-25 [background-image:linear-gradient(rgba(111,133,190,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(111,133,190,.08)_1px,transparent_1px)] [background-size:72px_72px]" />

      <header className="border-b border-white/10">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-8 lg:px-12 lg:py-4">
          <Link href="/" aria-label={marca.nome} className="flex min-w-0 items-center gap-3">
            {marca.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={marca.logoUrl} alt={marca.nome} className="h-9 w-auto max-w-[140px] object-contain sm:h-10 sm:max-w-[160px]" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/elus/logo-horizontal.png" alt={marca.nome} className="h-11 w-auto max-w-[185px] object-contain" />
            )}
            <span className="shrink-0 text-[10px] font-bold tracking-[.08em] text-cyan-300 uppercase sm:text-xs">elus360 <span className="font-normal text-slate-400">by wandora</span></span>
          </Link>
          <nav aria-label={t("Navegação principal")} className="flex items-center gap-3 sm:gap-6">
            <Link href="/legal/privacy" className="hidden text-sm text-slate-300 transition-colors hover:text-white sm:inline">{t("Privacidade")}</Link>
            <Link href="/legal/terms" className="hidden text-sm text-slate-300 transition-colors hover:text-white md:inline">{t("Termos de Uso")}</Link>
            <Link href="/login" className="rounded-xl border border-blue-400/60 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">{t("Acessar minha conta")}</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-5 px-5 py-5 sm:px-8 lg:min-h-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] lg:gap-8 lg:px-12 lg:py-5 xl:gap-12">
        <section aria-labelledby="elus-title" className="relative min-w-0">
          <h1 id="elus-title" className="max-w-2xl text-[clamp(2.5rem,5vw,5.25rem)] leading-[1.04] font-extrabold tracking-[-.035em]">
            {t("O CRM que")} <span className="text-cyan-300">{t("trabalha por você.")}</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base lg:mt-5">
            {t("O")} {marca.nome} {t("reúne em um só lugar as conversas com os clientes, o funil de vendas, a agenda de atendimentos e agentes de inteligência artificial que respondem, qualificam o interesse e passam a conversa para uma pessoa quando é preciso.")}
          </p>
          <Link href="/login" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
            {t("Entrar na plataforma")} <span aria-hidden="true" className="ml-2">→</span>
          </Link>
          <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-white/10 pt-5 sm:gap-x-8 lg:mt-7">
            {[
              [t("Atendimento centralizado"), t("Conversas e histórico em um só lugar.")],
              [t("Agentes de IA"), t("Atendimento e qualificação com transferência para pessoas.")],
              [t("Funil de vendas"), t("Acompanhe oportunidades e clientes.")],
              [t("Agenda integrada"), t("Organize compromissos da operação.")],
            ].map(([titulo, descricao]) => (
              <div key={titulo} className="min-w-0">
                <h2 className="text-sm font-semibold text-white">{titulo}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{descricao}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-label={t("Acesso ao Elus")} className="relative flex min-w-0 flex-col items-center justify-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-8 bottom-14 rounded-full bg-blue-600/15 blur-3xl" />
          <div className="relative flex w-full max-w-[420px] justify-center">
            {/* Mascote oficial enviado pelo proprietário; arquivo disponível em /public/brand/elus/mascote-nexus.webp. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/elus/mascote-nexus.webp" alt="" className="max-h-[30svh] w-auto max-w-full object-contain drop-shadow-[0_18px_32px_rgba(0,114,255,.24)] sm:max-h-[37svh] lg:max-h-[48svh]" />
          </div>
          <div className="relative mt-2 w-full max-w-md rounded-2xl border border-blue-300/15 bg-[#0b1228]/90 px-4 py-3 sm:px-5">
            <h2 className="text-base font-bold tracking-tight text-white">{t("Integrações com o Google")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm">
              {t("Quando a empresa conecta o Google Agenda, o")} {marca.nome} {t("mostra a ocupação da agenda e cria, altera e cancela os agendamentos pedidos pela própria pessoa. Quando conecta o Google Ads, devolve ao anúncio as vendas que ele trouxe. O uso dos dados do Google está descrito na")}{" "}
              <Link href="/legal/privacy#dados-do-google" className="font-medium text-blue-300 underline underline-offset-4 hover:text-white">{t("Política de Privacidade")}</Link>.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-slate-400 sm:px-8 lg:px-12">
          <p>{marca.nome}</p>
          <nav aria-label={t("Informações legais")} className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/legal/privacy" className="underline underline-offset-4 hover:text-white">{t("Política de Privacidade")}</Link>
            <Link href="/legal/terms" className="underline underline-offset-4 hover:text-white">{t("Termos de Uso")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
