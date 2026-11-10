/** CLI sem acesso à bancada: publica somente o plano, nunca credenciais ou conteúdo de arquivos. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planejarAtualizacao, type IdiomaDoPlano } from "./atualizacao";

const AJUDA = `Planeja a manutenção do curso entre commits, sem abrir o app ou segredos.

Uso: pnpm exec tsx curso/planejar-atualizacao.ts [opções]
  --head <ref>           Commit a ensinar (padrão: HEAD).
  --base <ref>           Base informada; exige revisão IA e não comprova publicação.
  --idioma <pt-BR|es>    Pode repetir; o padrão inclui os dois idiomas.
  --edicao <upstream|elus360>  Isola a publicação do curso ELUS360.
  --saida <arquivo>     Grava o mesmo JSON público exibido na saída padrão.
  --help                Mostra esta ajuda.

Sem --base, usa o recibo versionado da edição selecionada (upstream por padrão).
Para elus360 lê somente curso/publicacao-elus360.json; nunca herda a
publicação melgarafael/deskcomm-site como prova de nossa Academia. Sem registro válido
e ancestral, seleciona rodada completa. Alterações locais não entram no diff.
`;

try {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(AJUDA);
  } else {
    let head: string | undefined;
    let base: string | undefined;
    let saida: string | undefined;
    let edicao: "upstream" | "elus360" | undefined;
    const idiomas: IdiomaDoPlano[] = [];
    for (let i = 0; i < args.length; i++) {
      const chave = args[i];
      if (!["--head", "--base", "--idioma", "--saida", "--edicao"].includes(chave!)) throw new Error("opção desconhecida; use --help");
      const valor = args[++i];
      if (!valor || valor.startsWith("--")) throw new Error("opção sem valor; use --help");
      if (chave === "--head") head = valor;
      if (chave === "--base") base = valor;
      if (chave === "--saida") saida = valor;
      if (chave === "--edicao") {
        if (valor !== "upstream" && valor !== "elus360") throw new Error("edição inválida: use upstream ou elus360");
        edicao = valor;
      }
      if (chave === "--idioma") {
        if (valor !== "pt-BR" && valor !== "es") throw new Error("idioma inválido; use pt-BR ou es");
        idiomas.push(valor);
      }
    }
    const plano = planejarAtualizacao({ repositorio: process.cwd(), head, base, edicao, idiomas: idiomas.length ? idiomas : undefined });
    const json = `${JSON.stringify(plano, null, 2)}\n`;
    if (saida) {
      mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
      writeFileSync(saida, json);
    }
    process.stdout.write(json);
  }
} catch (erro) {
  process.stderr.write(`${erro instanceof Error ? erro.message : "falha ao planejar a atualização"}\n`);
  process.exitCode = 1;
}
