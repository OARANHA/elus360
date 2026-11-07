/**
 * Um PostgREST ENXUTO em memória, para os testes da conta por empresa.
 *
 * Só o que `ai_provider_credentials` precisa: `select`/`update`/`insert`/`delete`
 * com `eq` e `lt`, `maybeSingle`/`single` e o builder aguardável (o `update`
 * SEM `select` que a trava usa). A parte que importa é a SEMÂNTICA DO UPDATE
 * CONDICIONAL: o filtro é avaliado contra o estado ATUAL da linha, e o patch
 * só entra se ele casar — é o mesmo que o Postgres faz ao serializar dois
 * `update ... where updated_at < ...` na mesma linha, e é o que a trava de
 * renovação depende para que só um processo vença.
 */
export type Linha = Record<string, unknown>;

type Filtro = { col: string; op: "eq" | "lt"; v: unknown };

export class FakeSupabase {
  linha: Linha | null = null;
  /** Cada operação registrada, para os testes lerem o que foi gravado. */
  operacoes: Array<{ tipo: string; tabela: string; dados?: Record<string, unknown>; filtros: Filtro[] }> = [];

  from(tabela: string) {
    return new Query(this, tabela, undefined);
  }
  fromComLinha(tabela: string, linha: Linha) {
    this.linha = linha;
    return new Query(this, tabela, undefined);
  }
  /**
   * The test database is an explicitly authorized tenant fixture, not a
   * replacement for the production SQL/RLS checks. Mirror the RPC data contract
   * so credential encryption/rotation tests continue measuring real behavior
   * after the ELUS write boundary was moved from .insert/.update to an RPC.
   * The negative authorization checks live in the separate ELUS governance tests.
   */
  async rpc(name: string, args: {
    p_org?: string;
    p_op?: string;
    p_id?: string | null;
    p_patch?: Linha;
    p_platform_bypass?: boolean;
  }) {
    if (name !== "fn_elus_ai_credential_write_guarded") {
      return { data: null, error: { code: "42883", message: "rpc_not_implemented" } };
    }
    const op = args.p_op;
    if (typeof args.p_org !== "string" || !["insert", "update", "refresh_login", "delete"].includes(op ?? "")) {
      return { data: null, error: { code: "22023", message: "invalid_arguments" } };
    }
    const p = args.p_patch ?? {};
    this.operacoes.push({ tipo: "rpc:" + op, tabela: "ai_provider_credentials", dados: p, filtros: [] });
    if (op === "insert") {
      if (this.linha && this.linha.organization_id === args.p_org && this.linha.label === p.label) {
        return { data: null, error: { code: "23505", message: "duplicate_label" } };
      }
      this.linha = { ...p, id: "cred-1", organization_id: args.p_org };
      return { data: { id: this.linha.id }, error: null };
    }
    if (!this.linha || this.linha.id !== args.p_id || this.linha.organization_id !== args.p_org) {
      return { data: null, error: null };
    }
    if (op === "refresh_login") {
      // Reproduz a parte restritiva da RPC SQL: refresh não muda provedor,
      // rótulo nem identidade, exige o envelope cifrado e validated_at.
      const required = ["api_key_encrypted", "api_key_iv", "api_key_tag",
        "api_key_last4", "validated_at"];
      if (this.linha.provider !== "openai-assinatura" ||
          p.label !== this.linha.label ||
          required.some((k) => !(k in p))) {
        return { data: null, error: { code: "42501", message: "elus_ai_credential_refresh_restricted" } };
      }
    }
    if (op === "delete") {
      this.linha = null;
      return { data: { id: args.p_id, deleted: true }, error: null };
    }
    this.linha = { ...this.linha, ...p, updated_at: new Date().toISOString() };
    return { data: { id: args.p_id }, error: null };
  }
}

class Query {
  private filtros: Filtro[] = [];
  dados?: Record<string, unknown>;
  tipo = "select";
  constructor(
    private db: FakeSupabase,
    private tabela: string,
    dados?: Record<string, unknown>,
  ) {
    this.dados = dados;
  }

  select(_cols?: string) {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filtros.push({ col, op: "eq", v });
    return this;
  }
  lt(col: string, v: unknown) {
    this.filtros.push({ col, op: "lt", v });
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filtros.push({ col, op: "eq", v: vals });
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  update(dados: Record<string, unknown>) {
    this.dados = dados;
    this.tipo = "update";
    return this;
  }
  insert(dados: Record<string, unknown>) {
    this.dados = dados;
    this.tipo = "insert";
    return this;
  }
  delete() {
    this.tipo = "delete";
    return this;
  }

  private casa(linha: Linha): boolean {
    return this.filtros.every((f) => {
      const valor = linha[f.col];
      if (f.op === "eq") {
        if (Array.isArray(f.v)) return f.v.includes(valor);
        return valor === f.v;
      }
      // `lt` sobre timestamp em ISO: a comparação lexicográfica de ISO-8601
      // com o mesmo formato é a mesma ordem do Postgres.
      return String(valor ?? "") < String(f.v);
    });
  }

  private async resolver(unico: boolean) {
    await Promise.resolve();
    const db = this.db;
    db.operacoes.push({ tipo: this.tipo, tabela: this.tabela, dados: this.dados, filtros: this.filtros });
    if (this.tipo === "insert") {
      db.linha = { id: "cred-1", ...this.dados };
      return { data: { id: db.linha.id }, error: null };
    }
    const atual = db.linha;
    if (!atual || !this.casa(atual)) {
      // update que não casa = 0 linhas, igual ao Postgres; select sem match = null.
      return { data: null, error: null };
    }
    if (this.tipo === "delete") {
      db.linha = null;
      return { data: null, error: null };
    }
    if (this.tipo === "update") {
      db.linha = { ...atual, ...this.dados };
      return { data: unico ? { ...db.linha } : { ...db.linha }, error: null };
    }
    return { data: { ...atual }, error: null };
  }

  single() {
    return this.resolver(true);
  }
  maybeSingle() {
    return this.resolver(false);
  }
  then<A, B>(
    onfulfilled?: ((v: { data: unknown; error: null }) => A | Promise<A>) | null,
    onrejected?: ((e: unknown) => B | Promise<B>) | null,
  ): Promise<A | B> {
    return this.resolver(false).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}
