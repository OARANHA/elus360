import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cena = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: cena.usuario } }) },
  }),
}));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: async () => "pt-BR" }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "Marca da Revenda" }) }));

import HomePage from "./page";

async function montar() {
  return render(await HomePage());
}

beforeEach(() => {
  cena.usuario = null;
});

describe("/ — a página inicial pública", () => {
  // A verificação de um app que pede dados de conta Google abre o endereço
  // principal SEM entrar. Antes, `/` era só um redirect para o painel e o
  // revisor caía no login.
  it("sem sessão: mostra o nome da marca, o que o produto faz e os links legais", async () => {
    await montar();

    // O ELUS preserva a marca do revendedor no link de identidade e no texto,
    // mas o H1 aprovado é a proposta de valor, não a marca literal.
    expect(screen.getByRole("link", { name: "Marca da Revenda" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1, name: /O CRM que trabalha por você/ })).toBeInTheDocument();
    expect(screen.getByText(/reúne em um só lugar as conversas com os clientes/)).toBeInTheDocument();

    const politica = screen
      .getAllByRole("link", { name: "Política de Privacidade" })
      .map((a) => a.getAttribute("href"));
    expect(politica).toContain("/legal/privacy");
    expect(screen.getAllByRole("link", { name: "Termos de Uso" }).some(
      (a) => a.getAttribute("href") === "/legal/terms",
    )).toBe(true);
    expect(screen.getByRole("link", { name: /Entrar na plataforma/ })).toHaveAttribute("href", "/login");
    const curso = screen.getByRole("link", { name: /Conhecer o curso ELUS360/ });
    expect(curso).toHaveAttribute("href", "https://elus360.com.br/curso");
    expect(curso).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("o nome vem da marca resolvida, não de texto fixo", async () => {
    await montar();
    expect(document.body.textContent).toContain("Marca da Revenda");
  });

  it("com sessão: segue direto para o painel, como sempre foi", async () => {
    cena.usuario = { id: "11111111-1111-4111-8111-111111111111" };
    await expect(montar()).rejects.toThrow("NEXT_REDIRECT:/app");
  });
});
