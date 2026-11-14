# ADR-0007 — Arquiteturas suportadas na distribuição ELUS360

> **DECISÃO SUPERVENIENTE DO PROPRIETÁRIO — 12/11/2026 (APROVADA, IMPLEMENTAÇÃO PENDENTE).**
> A restrição exclusiva de Linux AMD64 e a proibição absoluta de build local, estabelecidas abaixo em 07/11/2026, **foram revogadas**. ARM64 e build local são permitidos como capacidades opcionais, desde que o caminho seja seguro e suportado pela distribuição efetiva. Isso não exige build pesado na VPS, nem executá-lo em CI por rotina; imagens publicadas continuam preferenciais. Não anunciar suporte operacional ARM64 ou fallback testado até validar imagens, instalador e atualização. Preservar proveniência, rollback, segredos, backups e ausência de alterações destrutivas. A prioridade da PR #37 é a sinergia do overlay ELUS360 com a base oficial DeskcommCRM, com testes dirigidos exclusivamente ao delta ELUS e suas interfaces críticas; não repetir a bateria completa do upstream. As regras históricas abaixo documentam a decisão anterior e **não devem bloquear a nova integração**.


- **Status:** APROVADA PELO PROPRIETÁRIO
- **Data da aprovação:** 2026-11-07
- **Escopo de implementação:** `OARANHA/elus360`, PR #22 (DRAFT, isolada)
- **Referência gerencial:** proposta denominada “ADR-001 — Arquiteturas suportadas na distribuição inicial do ELUS360”, aprovada expressamente pelo proprietário. Numeração `ADR-0007` segue a sequência existente de `docs/adr/` e evita colisão com `ADR-0001` do upstream.
- **Estado de entrega:** arquitetura APROVADA; mudanças de código sujeitas a CI novo, revisão e gates próprios. **Não é autorização de release.**

## Contexto

A distribuição ELUS360 entrega quatro imagens próprias: `elus360` (app),
`elus360-worker`, `elus360-scheduler` e `elus360-voice-agent` (opcional
em runtime). A matriz anterior executava oito builds (AMD64 e ARM64) em
runner x86_64, usando QEMU para ARM64; o run
[42331973953](https://github.com/OARANHA/elus360/actions/runs/42331973953)
no HEAD `d5749685d3b2358bd7e3646e6890c95620b30477` terminou
`completed/cancelled` (7 jobs success e 2 cancelled), sem GREEN integral.

O ELUS360 é aplicação web. A arquitetura de iOS, Android ou computador de
quem acessa o navegador **não determina** a arquitetura do servidor.
O proprietário decidiu atender exclusivamente a hosts Linux x86_64 (AMD64).

## Decisão

1. **Única plataforma suportada:** `linux/amd64` (processador `x86_64`/`amd64`).
2. **ARM64 descartado definitivamente**, inclusive do roadmap futuro. Não é
   “suporte opcional”, “prévia”, fallback ou compatibilidade prometida.
3. **CI:** executar `verify-distribution` (Python, sintaxe Bash e regressões
   shell) mais **quatro** builds de smoke AMD64, um para cada Dockerfile.
   `push:false`, sem QEMU, login de publicação ou permissão `packages:write`.
4. **Instalador, atualizador e helpers OCI:** exigir `uname -s=Linux` e
   `uname -m=x86_64/amd64`; recusar hosts `aarch64`/`arm64`,
   outros sistemas (inclusive Darwin/x86_64) e solicitações `linux/arm64`, com
   `ELUS_DISTRIBUTION_NO_GO` e código 3 nos entrypoints antes de clone,
   mutações no `.env`, cron, backup, Docker, Supabase ou migrações.
   Uma instalação antiga, marcador, override ou flag de build local **não**
   torna arquitetura incompatível aceitável.
5. **Integridade das quatro imagens:** cada release numérica do fork exige os
   quatro pacotes com manifestos que comprovem execução AMD64; a atestação
   offline do conjunto exige **exatamente** a chave `linux/amd64` e
   digest/revisão por imagem. Não considerar mera resposta HTTP 200 prova
   suficiente de arquitetura. Nas quatro imagens próprias, rejeitar também
   índices mistos AMD64+ARM64 ou plataformas duplicadas. WAHA/upstream pode
   ser multiarch, desde que ofereça AMD64; a escolha do operador é preservada.
6. **Release e segurança permanecem independentes da plataforma:** origem
   `OARANHA/elus360`, GitHub Release publicada, tag imutável e contida em
   `main`, quatro imagens completas, sem build local, pins de rollback, plano
   explícito para schema e ausência de publicação automática continuam
   obrigatórios.
7. **Nenhum cliente ARM bloqueado no navegador:** usuários em dispositivos
   ARM continuam acessando a aplicação servida por host AMD64 normalmente.

## Consequências e limites

- Reduz complexidade e dispensa emulação QEMU para a distribuição inicial e
  todas as futuras versões do ELUS360 sob esta decisão.
- Uma VPS ARM64 deve receber recusa clara; não há promessa de suporte,
  upgrade, conversão automática ou compilação nessa arquitetura.
- O Compose de produção permanece `image:`-only, sem `build:` para os
  quatro serviços.
- A decisão **não comprova** atestação criptográfica de digests no registry,
  compatibilidade reversa de migrações, operação em staging ou em produção.
- O conteúdo de `docs/adr/0001-packaging-e-distribuicao.md` e os exemplos de
  publicação multiarch de `docs/doctrine/packaging.md` documentam
  o upstream DeskcommCRM; **não prevalecem** sobre este contrato
  específico do fork ELUS360.

## Critérios de aceite da implementação

- Um **novo HEAD** da PR #22 comprova todos os testes Python e regressões
  shell, inclusive recusas de ARM64 antes de side effects.
- O workflow PR-only conclui com **5/5 jobs success**:
  `verify-distribution` e App, Worker, Scheduler, Voz em AMD64.
- Os quatro builds não publicam imagens e não movem `stable`.
- Nenhum GREEN ou CI cancelado de SHA anterior vale para este gate.
- Branch protection de `main` e checks obrigatórios continuam não
  certificados enquanto a integração responder HTTP 403.
- **NO-GO operacional mantido:** merge PR #21/#22, publicação GHCR,
  release/tag, `stable`, staging real, deploy, alterações em banco
  de produção e canário de cliente dependem de autorização independente.

## Evidência da aprovação

A aprovação expressa do proprietário foi comunicada na conversa do projeto
ELUS360 em 07/11/2026 e registrada pelo gerenciamento na PR #22 e no
Hindsight `Elus360`. Esta ADR registra a decisão já aprovada,
sem alegar que o novo CI ou a distribuição tenham sido aprovados.
