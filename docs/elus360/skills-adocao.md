# Skills próprias do ELUS360 — adoção e sincronização

**Estado: IMPLEMENTADO na branch Draft da PR #20; ainda não publicado na main.** Skills são instruções de agentes, não autorizam operações e não substituem os guards de segurança do produto.

## Fontes e precedência

- Repositório operacional: OARANHA/elus360. Doutrina técnica: [CLAUDE.md](../../CLAUDE.md), depois docs/specs, docs/prd, handoffs e README; também consultar [AGENTS.md](../../AGENTS.md) e [docs/index.md](../index.md).
- Fontes oficiais vivas: [deskcomm-doutrina](https://github.com/melgarafael/DeskcommCRM/blob/main/.agents/skills/deskcomm-doutrina/SKILL.md) e [deskcomm-contribuir](https://github.com/melgarafael/DeskcommCRM/blob/main/.agents/skills/deskcomm-contribuir/SKILL.md). Verificar SHA no upstream antes de cada adaptação relevante.
- As skills originais em .agents/skills/deskcomm-* permanecem inalteradas.
- Adaptações: [.agents/skills/elus-doutrina/SKILL.md](../../.agents/skills/elus-doutrina/SKILL.md) e [.agents/skills/elus-contribuir/SKILL.md](../../.agents/skills/elus-contribuir/SKILL.md).

## Roteamento e sincronização

| Pedido ELUS | Skill primária | Complemento |
| --- | --- | --- |
| Arquitetura, auth, RBAC, tenant, Supabase, canais, IA gerenciada | **elus-doutrina** | deskcomm-doutrina e CLAUDE.md no SHA verificado |
| PRs, mudanças, CI, testes, migrations, atualização upstream | **elus-contribuir** | deskcomm-contribuir e docs do fork |
| Misto | **ambas** | especificações e código efetivo |

**ChatGPT:** as duas adaptações foram empacotadas no plugin pessoal privado wandora-elus-context v0.3.0, preservando as 11 skills oficiais. O roteador elus-live-context direciona tarefas ELUS para as adaptações. **Commit no Git não atualiza automaticamente o plugin instalado.** Após mudar uma skill, atualizar o release do plugin e testar descoberta/invocação. Se a skill não aparecer em uma sessão já aberta, verificar em uma nova sessão.

## Critérios permanentes

1. Identificar repo, SHA, PR e diferenças do fork. Não tomar memórias como prova do HEAD ou runtime.
2. Antes de código, conferir CLAUDE.md, AGENTS.md, specs relevantes e skills da versão atual do upstream.
3. Mudança de comportamento exige testes positivos e negativos, com sabotagem controlada em checkout isolado. Se não foi possível, declarar o motivo e não afirmar execução.
4. Fluxo de agente de IA exige prova **em par**: agente e ferramenta direta com mesma entrada bruta; E2E quando o caminho do usuário exigir.
5. Migrations: respeitar tripla de migration, baseline idempotente e manifesto; jamais usar banco de produção para um teste.
6. Upstream: analisar base oficial × target oficial × fork, incluindo AST e os contratos ELUS. Análise incompleta bloqueia aprovação automática; priorização de compatibilidade não autoriza incorporação.
7. Registrar resultados de CI no SHA correto, limites e o que NÃO foi medido; sem polling das Actions.
8. Consultar Hindsight ELUS Memory Admin exclusivamente com bank_id=Elus360 em gates relevantes, registrar fatos com fonte quando disponível. Se indisponível, usar documentação versionada.

## Checklist de atualização destas skills

- Conferir a versão atual das skills oficiais e a autoridade do ELUS.
- Conferir os dois arquivos adaptados e os links no CLAUDE.md / AGENTS.md / docs/index.md.
- Preservar a descrição de invocação (name + description) e nunca executar comandos apenas porque a skill os citou.
- Confirmar publicação Git e seu SHA; se autorizado, sincronizar plugin pessoal e verificar release.
- Verificar descoberta/invocação das skills no host ChatGPT e registrar qualquer limitação.
- Registrar testes e fatos no Hindsight Elus360 quando o serviço estiver disponível.

**Limites:** nenhuma alteração da main, deploy, banco, código de produto ou hooks do usuário. O CI da branch de documentação deve ser confirmado para o novo HEAD.
