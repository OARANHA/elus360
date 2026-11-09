// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const catalogo = JSON.parse(readFileSync(path.join(RAIZ, "curso/catalogo-publico-elus360.json"), "utf8")) as {
  versao: number; tipo: string; url: string; modulos: string[]; idioma: string;
};

describe("Academia ELUS360 — fronteira do conteúdo público", () => {
  it("o inventário observado não pode fingir ser comprovante de publicação", () => {
    expect(catalogo.tipo).toBe("inventario_observado_nao_recibo_de_publicacao");
    expect(catalogo.url).toBe("https://elus360.com.br/curso");
    expect(catalogo.idioma).toBe("pt-BR");
    expect(new Set(catalogo.modulos).size).toBe(catalogo.modulos.length);
    expect(catalogo.modulos.length).toBeGreaterThan(0);
    for (const modulo of catalogo.modulos) {
      expect(modulo).toMatch(/^[a-z0-9-]+$/);
      expect(modulo.startsWith("admin-"), "áreas administrativas não foram aprovadas na Academia pública").toBe(false);
      expect(existsSync(path.join(RAIZ, "curso/licoes", `${modulo}.json`))).toBe(true);
    }
  });

  it("os textos dos módulos publicados não apresentam a marca herdada ao aluno", () => {
    const ocorrencias: string[] = [];
    for (const modulo of catalogo.modulos) {
      const conteudo = JSON.parse(readFileSync(path.join(RAIZ, "curso/licoes", `${modulo}.json`), "utf8"));
      expect(conteudo.id, modulo).toBe(modulo);
      // A inspeção de texto cru também flagra referências em seletores;
      // se forem técnicas legítimas, exigem revisão explícita em PR, não bypass.
      if (/deskcomm(?:crm)?/i.test(JSON.stringify(conteudo))) ocorrencias.push(modulo);
    }
    expect(ocorrencias, "texto legado nas lições públicas; revisar e adaptar ao ELUS360").toEqual([]);
  });
  it("templates, menu, meta description e jornadas usam ELUS360 sem apagar progresso dos alunos", () => {
    const caminhos = [
      "curso/site/pagina.html",
      "curso/site/app.js",
      "curso/site/demonstracoes.js",
      "curso/montar.ts",
    ];
    const app = readFileSync(path.join(RAIZ, "curso/site/app.js"), "utf8");
    // Chave de localStorage mantida por compatibilidade, sem texto legado visível.
    const chaveAnterior = "curso-deskcomm:feitos";
    expect(app).toContain(chaveAnterior);
    for (const arquivo of caminhos) {
      const fonte = readFileSync(path.join(RAIZ, arquivo), "utf8");
      expect(fonte.replaceAll(chaveAnterior, ""), `${arquivo}: marca legada exposta`).not.toMatch(/deskcomm/i);
    }
  });

});
