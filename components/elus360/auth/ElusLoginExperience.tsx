import type { ReactNode } from "react";

/**
 * ELUS 360 — apresentação visual isolada da tela de login.
 * Autenticação, mensagens, convites, MFA e Google continuam em
 * app/(public)/login/page.tsx e nos componentes oficiais do DeskcommCRM.
 */
export function ElusLoginExperience({
  nome,
  children,
}: {
  nome: string;
  children: ReactNode;
}) {
  return (
    <main
      data-elus-login
      data-theme="dark"
      className="fixed inset-0 z-20 overflow-y-auto bg-[#050611] text-white"
    >
      <div className="relative min-h-[100dvh] overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[32rem] w-[32rem] rounded-full bg-cyan-500/15 blur-[120px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 h-[34rem] w-[34rem] rounded-full bg-blue-600/15 blur-[130px]" />

        <div className="relative grid min-h-[100dvh] w-full lg:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
          <section
            aria-label={`Apresentação do ${nome}`}
            className="relative hidden min-h-[100dvh] overflow-hidden border-r border-white/10 lg:block"
          >
            {/* Imagem original da marca. O texto promocional já está na arte. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/elus/login-hero.png"
              alt={`${nome} — atendimento, vendas e automações`}
              className="absolute inset-0 h-full w-full object-cover object-[10%_center]"
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#050611]/5 via-transparent to-[#050611]/75" />
          </section>

          <section className="relative flex min-h-[100dvh] items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
            <div className="relative w-full max-w-[440px]">
              <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1022]/90 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                <div aria-hidden="true" className="h-px bg-gradient-to-r from-transparent via-cyan-300/75 to-transparent" />
                <div className="p-6 sm:p-8">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/brand/elus/logo-horizontal.png"
                    alt={nome}
                    className="mb-7 h-auto max-h-12 w-auto max-w-[230px] object-contain"
                  />
                  <div className="[&_h1]:text-white [&_p]:text-slate-300 [&_label]:text-slate-200 [&_input]:border-white/15 [&_input]:bg-[#11182b] [&_input]:text-white [&_button]:transition-colors [&_button[type=submit]]:bg-blue-600 [&_button[type=submit]]:text-white [&_button[type=submit]:hover]:bg-blue-500">
                    {children}
                  </div>
                </div>
              </div>
              <p className="mt-5 text-center text-xs tracking-[0.16em] text-slate-400 uppercase">Elus by Wandora</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
