/** Executa catálogos sem dependência de sucesso entre provedores. */
export async function executarSincronizacoesIndependentes<A, B>(
  openrouter: () => Promise<A>,
  chutes: () => Promise<B>,
): Promise<readonly [PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  return Promise.allSettled([Promise.resolve().then(openrouter), Promise.resolve().then(chutes)]);
}
