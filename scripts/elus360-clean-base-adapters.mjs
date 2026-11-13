#!/usr/bin/env node
/**
 * Adaptadores ELUS360 para a árvore OFICIAL v1.108.0, com blob pinado e falha fechada.
 * NUNCA modifica o checkout de origem: só o worktree detached montado pelo prepare.
 * É composição de código, NÃO valida autorização, schema nem aptidão para deploy.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertSafePath } from './elus360-clean-base-prepare.mjs';
import { classifyConflict } from './elus360-clean-base-classify.mjs';

export const OFFICIAL_TARGET = '0b60c5abaace17922ae645399a6a6183a5f5c357';
const digest = data => createHash('sha256').update(data).digest('hex');
const gitBlobSha = bytes => createHash('sha1')
  .update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const git = (argv, options={}) => execFileSync('git', argv, { encoding: 'utf8', maxBuffer: 128*1024*1024, ...options }).trim();

/** Definições explícitas; o SHA é o blob do DeskcommCRM oficial v1.108.0. */
export const ADAPTERS = [
  {
    path: 'app/app/ai/agents/_components/AgentsList.tsx',
    officialBlob: '0e369e8d944fd45c3d646c2bcc1a7d6dc9e49a57',
    kind: 'controlled_ui',
    edits: [
      ['  canWrite: boolean;\n}', '  canWrite: boolean;\n  mostrarModelo?: boolean;\n}'],
      ['export function AgentsList({ initialData, canWrite }: Props) {',
       'export function AgentsList({ initialData, canWrite, mostrarModelo = false }: Props) {'],
      ['<AgentCard agent={agent} canWrite={canWrite} />',
       '<AgentCard agent={agent} canWrite={canWrite} mostrarModelo={mostrarModelo} />'],
    ],
  },
  {
    path: 'lib/agent-engine/env.ts',
    officialBlob: 'a416453186b478a20e8aece937ae51f6c78dc7e0',
    kind: 'worker_env',
    edits: [
      ['  OPENROUTER_API_KEY: z.string().min(1).optional(),',
       '  OPENROUTER_API_KEY: z.string().min(1).optional(),\n  // ELUS360: credencial opcional de plataforma; vazia nunca bloqueia boot.\n  CHUTES_API_KEY: z.string().min(1).optional(),'],
    ],
  },
  {
    path: 'lib/env.ts',
    officialBlob: '6e3dd8230639aa5250d6413ce6e67a8464143558',
    kind: 'app_env',
    edits: [
      ['  OPENROUTER_API_KEY: z.string().optional().default(""),',
       '  OPENROUTER_API_KEY: z.string().optional().default(""),\n  // ELUS360: opcional, chave nunca deve ser registrada ou devolvida ao navegador.\n  CHUTES_API_KEY: z.string().optional().default(""),'],
    ],
  },
  {
    path: 'lib/audit/actions.ts',
    officialBlob: '9dca646b31bb987c8ba9aae05684418fb53042ef',
    kind: 'audit_actions',
    edits: [
      ['  "platform_admin.platform_admins_listed",',
       '  "platform_admin.platform_admins_listed",\n  // ELUS360: mutações técnicas de IA gerenciada por tenant.\n  "platform_admin.ai_autonomy_updated",\n  "platform_admin.ai_default_updated",'],
    ],
  },
  {
    path: '.env.example',
    officialBlob: 'e74d2cf665da729e5ca5042879d56ad64cb9c6df',
    kind: 'documented_env',
    edits: [
      ['OPENROUTER_API_KEY=\n',
       'OPENROUTER_API_KEY=\n# ELUS360: chave de plataforma opcional. Nunca registre uma chave real neste arquivo.\nCHUTES_API_KEY=\n# ELUS360: habilitar chutes somente após catálogo e governança validados.\nELUS_DEFAULT_AI_PROVIDER=\n'],
    ],
  },
  {
    path: 'package.json',
    officialBlob: '7ac090cbde0c9de373c34b19e21c31454efd2518',
    kind: 'package_scripts_only',
    edits: [
      ['    "test:unit": "vitest run",',
       '    "test:unit": "vitest run",\n    "test:operational": "node --test tests/operational/*.test.mjs",'],
    ],
  },
  {
    path: 'app/app/ai/agents/[id]/_components/AgentForm.tsx',
    officialBlob: '956e6ff33a369e2a9a7f5df3c8aae81125b49992',
    kind: 'agent_form_managed',
    // Somente governança do fork; voz, agenda, funis e rolagem permanecem upstream.
    edits: [
      ["import { PROVEDOR_POR_ASSINATURA, PROVEDORES } from \"@/lib/ai/pontos/provedores\";\n",
       "import { PROVEDOR_POR_ASSINATURA, PROVEDORES } from \"@/lib/ai/pontos/provedores\";\nimport { AUTONOMIA_IA_PADRAO, type AutonomiaIa } from \"@/lib/elus360/ai-managed/policy\";\n"],
      ["  provedorPadrao?: string;\n  /**\n",
       "  provedorPadrao?: string;\n  modeloPadrao?: string;\n  credencialPadrao?: string | null;\n  /**\n"],
      ["  organizationTimezone?: string;\n",
       "  autonomiaTecnica?: Readonly<AutonomiaIa>;\n  organizationTimezone?: string;\n"],
      ["  provedorPadrao?: string;\n  provedoresOferecidos?: readonly string[];\n",
       "  provedorPadrao?: string;\n  modeloPadrao?: string;\n  credencialPadrao?: string | null;\n  provedoresOferecidos?: readonly string[];\n"],
      ["  const { agent, version, t, provedorPadrao, provedoresOferecidos } = args;\n",
       "  const { agent, version, t, provedorPadrao, modeloPadrao, credencialPadrao, provedoresOferecidos } = args;\n"],
      ["    model: version?.model ?? \"\",\n",
       "    model: version?.model ?? modeloPadrao ?? \"\",\n"],
      ["    credential_id: version ? (version.credential_id ?? CHAVE_DA_INSTALACAO) : \"\",\n",
       "    credential_id: version ? (version.credential_id ?? CHAVE_DA_INSTALACAO) : (credencialPadrao ?? CHAVE_DA_INSTALACAO),\n"],
      ["  const readOnly = props.readOnly ?? false;\n",
       "  const readOnly = props.readOnly ?? false;\n  const autonomia = props.autonomiaTecnica ?? AUTONOMIA_IA_PADRAO;\n  const podeVerConfiguracaoTecnica = autonomia.provider || autonomia.model || autonomia.credentials;\n"],
      ["      provedoresOferecidos: props.provedoresOferecidos,\n",
       "      modeloPadrao: props.modeloPadrao,\n      credencialPadrao: props.credencialPadrao,\n      provedoresOferecidos: props.provedoresOferecidos,\n"],
      ["    if (!form.model) errors.model = t(\"Escolha o modelo de inteligência artificial.\");\n",
       "    if (!form.model) errors.model = autonomia.model\n      ? t(\"Escolha o modelo de inteligência artificial.\")\n      : t(\"A IA ELUS360 desta empresa precisa ser configurada pelo administrador da plataforma.\");\n"],
      ["      errors.credential_id = t(\"Escolha a chave de acesso da empresa de inteligência artificial.\");\n",
       "      errors.credential_id = autonomia.credentials\n        ? t(\"Escolha a chave de acesso da empresa de inteligência artificial.\")\n        : t(\"A IA ELUS360 desta empresa precisa ser configurada pelo administrador da plataforma.\");\n"],
      ["      errors.credential_id = `${t(\"Esta instalação não tem chave de\")} ${form.provider}. ${t(\"Escolha outra empresa de IA ou cadastre uma chave.\")}`;\n",
       "      errors.credential_id = autonomia.credentials && autonomia.provider\n        ? `${t(\"Esta instalação não tem chave de\")} ${form.provider}. ${t(\"Escolha outra empresa de IA ou cadastre uma chave.\")}`\n        : t(\"A IA ELUS360 desta empresa precisa ser configurada pelo administrador da plataforma.\");\n"],
      ["        return `${t(\"Esta instalação não tem chave de\")} ${motivo.provedor}. ${t(\"Escolha outra empresa de IA ou cadastre uma chave.\")}`;\n",
       "        return !podeVerConfiguracaoTecnica\n          ? t(\"A IA ELUS360 desta empresa precisa ser configurada pelo administrador da plataforma.\")\n          : `${t(\"Esta instalação não tem chave de\")} ${motivo.provedor}. ${t(\"Escolha outra empresa de IA ou cadastre uma chave.\")}`;\n"],
      ["        return t(\"Escolha a chave de acesso da empresa de inteligência artificial.\");\n",
       "        return autonomia.credentials\n          ? t(\"Escolha a chave de acesso da empresa de inteligência artificial.\")\n          : t(\"A IA ELUS360 desta empresa precisa ser configurada pelo administrador da plataforma.\");\n"],
      ["        return `${t(\"Credencial\")} ${motivo.provedor} ${motivo.estado === \"invalid\" ? t(\"inválida\") : t(\"ainda não validada\")}.`;\n",
       "        return !podeVerConfiguracaoTecnica\n          ? t(\"A IA ELUS360 desta empresa precisa ser validada pelo administrador da plataforma.\")\n          : `${t(\"Credencial\")} ${motivo.provedor} ${motivo.estado === \"invalid\" ? t(\"inválida\") : t(\"ainda não validada\")}.`;\n"],
      ["          disabled={disabled}\n        />\n",
       "          disabled={disabled}\n          permitirModeloTecnico={autonomia.operator_model}\n        />\n"],
      ["          {/* Provider + credential + model */}\n          <Card className=\"space-y-3 p-4\">\n",
       "          {/* Controles concedidos pelo Superadmin; segurança real permanece no backend. */}\n          {podeVerConfiguracaoTecnica ? <Card className=\"space-y-3 p-4\">\n"],
      ["            <div className=\"space-y-1\">\n              <Label htmlFor=\"provider\">{t(\"Empresa de inteligência artificial\")}</Label>\n",
       "            {autonomia.provider ? <div className=\"space-y-1\">\n              <Label htmlFor=\"provider\">{t(\"Empresa de inteligência artificial\")}</Label>\n"],
      ["            </div>\n\n",
       "            </div> : null}\n\n"],
      ["            <ModelPicker\n",
       "            {autonomia.model ? <ModelPicker\n"],
      ["            />\n            {validation.model ? (\n",
       "            /> : null}\n            {autonomia.model && validation.model ? (\n"],
      ["            <CredentialPicker\n",
       "            {autonomia.credentials ? <CredentialPicker\n"],
      ["            />\n            {validation.credential_id ? (\n",
       "            /> : null}\n            {autonomia.credentials && validation.credential_id ? (\n"],
      ["            {cred && credSt && credSt !== \"validated\" ? (\n",
       "            {autonomia.credentials && cred && credSt && credSt !== \"validated\" ? (\n"],
      ["          </Card>\n\n          {/* WhatsApp session */}\n",
       "          </Card> : <Card className=\"p-4\" data-testid=\"elus-ia-gerenciada\">\n            <h3 className=\"text-sm font-medium\">{t(\"Inteligência artificial ELUS360\")}</h3>\n            <p className=\"text-xs text-muted-foreground\">{t(\"Configurada e gerenciada pela plataforma.\")}</p>\n          </Card>}\n\n          {/* WhatsApp session */}\n"],
    ],
  },
  {
    path: 'lib/i18n/dicionario.ts',
    officialBlob: '7884118824fb6fb17b420e9038e1ede60dbe33b6',
    kind: 'i18n_elus_entries',
    // 48 entradas exclusivas do fork; nunca restaurar o dicionário antigo.
    // Blobs de origem: fork d53989b17bf5b86f74deff07d5ee94653296828f.
    edits: [["};\n\n/**\n * Traduz, ou devolve o próprio texto.",
      "  // ELUS360 v1.102.0 — traduções dos painéis de IA e da página pública.\n  \"IA ELUS360 gerenciada\": { es: \"IA ELUS360 gestionada\" },\n  \"Privacidade\": { es: \"Privacidad\" },\n  \"Acessar minha conta\": { es: \"Acceder a mi cuenta\" },\n  \"O CRM que\": { es: \"El CRM que\" },\n  \"trabalha por você.\": { es: \"trabaja por ti.\" },\n  \"Entrar na plataforma\": { es: \"Entrar a la plataforma\" },\n  \"Atendimento centralizado\": { es: \"Atención centralizada\" },\n  \"Conversas e histórico em um só lugar.\": { es: \"Conversaciones e historial en un solo lugar.\" },\n  \"Atendimento e qualificação com transferência para pessoas.\": { es: \"Atención y calificación con transferencia a personas.\" },\n  \"Acompanhe oportunidades e clientes.\": { es: \"Haz seguimiento de oportunidades y clientes.\" },\n  \"Agenda integrada\": { es: \"Agenda integrada\" },\n  \"Organize compromissos da operação.\": { es: \"Organiza las citas de la operación.\" },\n  \"Acesso ao Elus\": { es: \"Acceso a Elus\" },\n  \"Integrações com o Google\": { es: \"Integraciones con Google\" },\n  \"Informações legais\": { es: \"Información legal\" },\n  \"Não foi possível consultar as permissões.\": { es: \"No se pudieron consultar los permisos.\" },\n  \"Falha de conexão ao consultar permissões.\": { es: \"Error de conexión al consultar los permisos.\" },\n  \"Não foi possível atualizar as permissões.\": { es: \"No se pudieron actualizar los permisos.\" },\n  \"Permissões salvas para esta empresa.\": { es: \"Permisos guardados para esta empresa.\" },\n  \"Falha de conexão ao salvar.\": { es: \"Error de conexión al guardar.\" },\n  \"Autonomia técnica de IA\": { es: \"Autonomía técnica de IA\" },\n  \"A plataforma gerencia a IA por padrão. Libere apenas as escolhas técnicas que esta empresa pode modificar. Desligar uma permissão não exclui chaves ou versões já publicadas.\": { es: \"La plataforma gestiona la IA de forma predeterminada. Habilita únicamente las opciones técnicas que esta empresa puede modificar. Desactivar un permiso no elimina claves ni versiones ya publicadas.\" },\n  \"Carregando permissões…\": { es: \"Cargando permisos…\" },\n  \"Salvar permissões\": { es: \"Guardar permisos\" },\n  \"Falha ao consultar a IA da empresa.\": { es: \"Error al consultar la IA de la empresa.\" },\n  \"Falha de conexão.\": { es: \"Error de conexión.\" },\n  \"Padrão salvo. Agentes publicados e configurações próprias foram preservados.\": { es: \"Configuración predeterminada guardada. Se conservaron los agentes publicados y las configuraciones propias.\" },\n  \"IA fornecida pela plataforma\": { es: \"IA proporcionada por la plataforma\" },\n  \"Defina provedor, modelo e credencial padrão desta empresa. Agentes já publicados não serão alterados.\": { es: \"Define el proveedor, modelo y credencial predeterminados de esta empresa. Los agentes ya publicados no se modificarán.\" },\n  \"Organização selecionada:\": { es: \"Organización seleccionada:\" },\n  \"Consultando configuração…\": { es: \"Consultando configuración…\" },\n  \"Provedor padrão\": { es: \"Proveedor predeterminado\" },\n  \"Escolha o provedor\": { es: \"Elige el proveedor\" },\n  \"Escolha o modelo\": { es: \"Elige el modelo\" },\n  \"Identificador exato do modelo\": { es: \"Identificador exacto del modelo\" },\n  \"Credencial da organização\": { es: \"Credencial de la organización\" },\n  \"Escolha a credencial\": { es: \"Elige la credencial\" },\n  \"Chave da instalação (se disponível)\": { es: \"Clave de la instalación (si está disponible)\" },\n  \"Nenhuma credencial personalizada validada para esta empresa. Cadastre-a no fluxo de credenciais autorizado antes de ativar.\": { es: \"No hay ninguna credencial personalizada validada para esta empresa. Regístrala mediante el flujo autorizado de credenciales antes de activar.\" },\n  \"agentes publicados\": { es: \"agentes publicados\" },\n  \"configurações próprias preservadas\": { es: \"configuraciones propias conservadas\" },\n  \"Ativar padrão\": { es: \"Activar configuración predeterminada\" },\n  \"Empresa inválida.\": { es: \"Empresa no válida.\" },\n  // ELUS360: textos próprios da IA gerenciada e catálogo Chutes.ai.\n  \"A IA ELUS360 desta empresa precisa ser configurada pelo administrador da plataforma.\": { es: \"La IA ELUS360 de esta empresa debe ser configurada por el administrador de la plataforma.\" },\n  \"A IA ELUS360 desta empresa precisa ser validada pelo administrador da plataforma.\": { es: \"La IA ELUS360 de esta empresa debe ser validada por el administrador de la plataforma.\" },\n  \"Inteligência artificial ELUS360\": { es: \"Inteligencia artificial ELUS360\" },\n  \"Configurada e gerenciada pela plataforma.\": { es: \"Configurada y gestionada por la plataforma.\" },\n  \"IA incluída pela instalação ELUS 360 ou credencial própria da empresa, com catálogo OpenAI-compatível de modelos.\": { es: \"IA incluida en la instalación ELUS 360 o credencial propia de la empresa, con un catálogo de modelos compatible con OpenAI.\" },\n};\n\n/**\n * Traduz, ou devolve o próprio texto."]],
  },
  {
    path: 'tests/unit/preambulo-do-ci-nao-come-o-relogio.test.ts',
    officialBlob: '82a077ad8897ccf96a6dae09f88b1e8688aab655',
    kind: 'ci_timeout_same_step',
    // Conserva limite oficial de 45 min; porta a proteção ELUS de timeout irmão de uses.
    edits: [
      ["describe(\"o preâmbulo do CI não come o orçamento dos testes\", () => {\n",
       "/**\n * Há dois formatos válidos de passo: '- uses: action' (CI histórico) e\n * '- name: ...' seguido de 'uses: action' (Academia). Em ambos, timeout-minutes\n * é irmão de uses como propriedade do PASSO, mas o recuo de uses difere.\n * Limitar ao mesmo item de lista impede aceitar timeout do passo vizinho\n * ou um valor aninhado em with:. O passo sem limite continua reprovado.\n */\nfunction temTimeoutDoMesmoPasso(linhas: string[], linhaUses: number): boolean {\n  const usa = linhas[linhaUses]!;\n  const recuoUsa = usa.length - usa.trimStart().length;\n  const inline = /^\\s*- uses:\\s*\\.\\/\\.github\\/actions\\/preparar-node\\s*$/.test(usa);\n  const recuoItem = recuoUsa - (inline ? 0 : 2);\n  if (recuoItem < 0) return false;\n  const marcador = \" \".repeat(recuoItem) + \"- \";\n  let inicio = linhaUses;\n  while (inicio >= 0 && !linhas[inicio]!.startsWith(marcador)) inicio--;\n  if (inicio < 0) return false;\n\n  let fim = linhas.length;\n  for (let j = inicio + 1; j < linhas.length; j++) {\n    const linha = linhas[j]!;\n    if (!linha.trim() || linha.trimStart().startsWith(\"#\")) continue;\n    const recuo = linha.length - linha.trimStart().length;\n    if (recuo < recuoItem || (recuo === recuoItem && linha.startsWith(marcador))) {\n      fim = j;\n      break;\n    }\n  }\n\n  // '- uses:' está no recuo do item; 'uses:' após '- name:' já tem +2.\n  // O timeout é sempre propriedade direta do item (+2), nunca de 'with:' (+4).\n  const timeoutNoRecuoDaAction = new RegExp(\"^ {\" + (recuoItem + 2) + \"}timeout-minutes:\\\\s*([1-9]\\\\d*)\\\\s*$\");\n  const corpo = linhas.slice(inicio, fim).filter((linha) => !linha.trimStart().startsWith(\"#\"));\n  return corpo.some((linha) => timeoutNoRecuoDaAction.test(linha));\n}\n\ndescribe(\"o preâmbulo do CI não come o orçamento dos testes\", () => {\n"],
      ["  it(\"todo uso da action carrega o seu teto de tempo\", () => {\n",
       "  it(\"a guarda encontra timeout no mesmo passo e rejeita timeout vizinho ou aninhado\", () => {\n    const valido = [\n      \"      - name: Preparar Node\",\n      \"        uses: ./.github/actions/preparar-node\",\n      \"        timeout-minutes: 5\",\n      \"      - name: Próximo\",\n      \"        run: echo teste\",\n    ];\n    expect(temTimeoutDoMesmoPasso(valido, 1)).toBe(true);\n    const antes = [valido[0]!, valido[2]!, valido[1]!, ...valido.slice(3)];\n    expect(temTimeoutDoMesmoPasso(antes, 2)).toBe(true);\n    const vizinho = [\n      \"      - name: Preparar Node\",\n      \"        uses: ./.github/actions/preparar-node\",\n      \"      - name: Próximo\",\n      \"        timeout-minutes: 5\",\n        \"        run: echo teste\",\n    ];\n    expect(temTimeoutDoMesmoPasso(vizinho, 1)).toBe(false);\n    const aninhado = [\n      \"      - name: Preparar Node\",\n      \"        uses: ./.github/actions/preparar-node\",\n      \"        with:\",\n      \"          timeout-minutes: 5\",\n      \"      - name: Próximo\",\n    ];\n    expect(temTimeoutDoMesmoPasso(aninhado, 1)).toBe(false);\n    expect(temTimeoutDoMesmoPasso(valido.filter((linha) => !linha.includes(\"timeout-minutes:\")), 1)).toBe(false);\n    expect(temTimeoutDoMesmoPasso(valido.map((linha) => linha.replace(\"timeout-minutes: 5\", \"timeout-minutes: 0\")), 1)).toBe(false);\n  });\n\n  it(\"aceita o CI histórico com - uses e rejeita timeout de outro item, aninhado ou zero\", () => {\n    const inline = [\n      \"      - uses: ./.github/actions/preparar-node\",\n      \"        # comentário de histórico, não quebra a propriedade irmã\",\n      \"        timeout-minutes: 5\",\n      \"      - uses: actions/checkout@v4\",\n    ];\n    expect(temTimeoutDoMesmoPasso(inline, 0)).toBe(true);\n\n    const semTimeout = inline.filter((linha) => !linha.includes(\"timeout-minutes:\"));\n    expect(temTimeoutDoMesmoPasso(semTimeout, 0)).toBe(false);\n\n    const noProximo = [\n      \"      - uses: ./.github/actions/preparar-node\",\n      \"      - name: Próximo passo\",\n      \"        timeout-minutes: 5\",\n    ];\n    expect(temTimeoutDoMesmoPasso(noProximo, 0)).toBe(false);\n\n    const emWith = [\n      \"      - uses: ./.github/actions/preparar-node\",\n      \"        with:\",\n      \"          timeout-minutes: 5\",\n    ];\n    expect(temTimeoutDoMesmoPasso(emWith, 0)).toBe(false);\n\n    const zero = inline.map((linha) => linha.replace(\"timeout-minutes: 5\", \"timeout-minutes: 0\"));\n    expect(temTimeoutDoMesmoPasso(zero, 0)).toBe(false);\n  });\n\n  it(\"todo uso da action carrega o seu teto de tempo\", () => {\n"],
      ["        // O passo vai até a próxima linha que abre outro item de lista (`- `)\n        // no mesmo recuo, ou até o fim do arquivo.\n        const recuo = texto.length - texto.trimStart().length;\n        let fim = linhas.length;\n        for (let j = i + 1; j < linhas.length; j++) {\n          const l = linhas[j]!;\n          if (l.trim() === \"\") continue;\n          const r = l.length - l.trimStart().length;\n          if (r <= recuo) {\n            fim = j;\n            break;\n          }\n        }\n        const corpo = linhas.slice(i + 1, fim).filter((l) => !l.trimStart().startsWith(\"#\"));\n        if (!corpo.some((l) => /^\\s+timeout-minutes:\\s*\\d+\\s*$/.test(l))) {\n          semTeto.push(`${arquivo}:${i + 1}`);\n        }\n",
       "        if (!temTimeoutDoMesmoPasso(linhas, i)) semTeto.push(arquivo + \":\" + (i + 1));\n"],
      ["      \"uso sem timeout-minutes: sem o cinto, um dia de cache frio volta a consumir o orçamento dos testes\",\n",
       "      \"uso sem timeout-minutes no mesmo passo: cache frio pode consumir o orçamento dos testes\",\n"],
    ],
  },
];

// Três vias do Git em vez de 30+ âncoras frágeis e reimplementação do updater.
 // Base antiga = release oficial v1.102; nosso lado = fork ELUS; destino = Deskcomm v1.108.
 // Somente kit de distribuição: demais arquivos seguem em adaptadores explícitos.
export const DISTRIBUTION_MERGES = [
  {
    path:'hostgator-setup-kit/_common.sh',
    officialBlob:'a857565a31c25c1577ced017047646949af9189e',
    baseBlob:'9700caa5a1b665a1c7ca185ccee6f8e3d6b23d15',
    forkBlob:'2579899a0e61c937b1a25f59e53b5529c321ca50',
    kind:'distribution_common_three_way',
  },
  {
    path:'hostgator-setup-kit/update.sh',
    officialBlob:'6c91760b21c6d05264e1562a89559b404c11d1ca',
    baseBlob:'6a229ef11d85207105e9db05b77ceab6026f39d3',
    forkBlob:'7aab82d2c656948a008de64ce5e537b5e7b425c6',
    kind:'distribution_update_three_way',
  },
];

/**
 * Política opcional, sem fallback implícito em falha de registry.
 * A implementação oficial do build é reutilizada; somente o opt-in
 * explicitamente configurado pode acioná-la.
 * Os demais scripts de entrada continuam com seus próprios preflights.
 */
export function composeOptionalBuildPolicy(merged, official) {
  function locate(source,name) {
    const re=new RegExp('^'+name+'\\(\\) \\{[^\\n]*\\n[\\s\\S]*?^\\}', 'gm');
    const matches=[...source.matchAll(re)];
    if(matches.length!==1)throw new Error('ELUS_OPTIONAL_BUILD_FUNCTION_ANCHOR: '+name);
    return matches[0][0];
  }
  let result=merged;
  function replace(name, next) {
    const before=locate(result,name);
    if(before===next)return;
    result=result.replace(before,next);
  }
  // A antiga guarda ELUS era executada pelo source no início dos dois
  // entrypoints e recusava ARM64 antes mesmo do preflight de imagens.
  // Não importar do upstream o bypass para arquiteturas desconhecidas:
  // preservamos apenas Linux amd64/arm64 e falhamos antes de efeitos colaterais.
  replace('veredito_da_arquitetura', `veredito_da_arquitetura() {
  case "\${1:-}" in
    x86_64|amd64) printf 'amd64'; return 0 ;;
    aarch64|arm64) printf 'arm64'; return 0 ;;
    *) printf 'nao_suportada'; return 1 ;;
  esac
}`);
  replace('verificar_arquitetura_do_kit', `verificar_arquitetura_do_kit() {
  local arch sistema
  arch="$(uname -m 2>/dev/null || printf desconhecida)"
  sistema="$(uname -s 2>/dev/null || printf desconhecido)"
  [ "$sistema" = Linux ] && arquitetura_suportada_pelo_kit "$arch" && return 0
  printf 'ELUS_DISTRIBUTION_NO_GO: host %s/%s não suportado; exige Linux amd64 ou arm64.\\n' "$sistema" "$arch" >&2
  return 3
}`);
  // Recuperação circunscrita ao suporte oficial de arquiteturas e WAHA.
  for(const name of ['arquitetura_suportada_pelo_kit',
    'imagem_waha_padrao_para_host','preflight_plataforma_atualizacao']) {
    replace(name,locate(official,name));
  }
  const requested=`build_local_pedido() {
  case "\${DESKCOMM_BUILD_LOCAL:-}" in
    1|sim|s|yes) return 0 ;;
    *) return 1 ;;
  esac
}`;
  replace('build_local_pedido',requested);
  replace('build_local_permitido',`build_local_permitido() {
  build_local_pedido
}`);
  const officialBuild=locate(official,'construir_aqui_e_subir');
  const guarded=officialBuild.replace(/^construir_aqui_e_subir\(\) \{[^\n]*\n/,
    head=>head+`  if ! build_local_pedido; then
    c_red "ELUS_DISTRIBUTION_NO_GO: build local exige DESKCOMM_BUILD_LOCAL=1 explícito."
    return 3
  fi
`);
  if(guarded===officialBuild)throw new Error('ELUS_BUILD_OPTIN_ANCHOR');
  replace('construir_aqui_e_subir',guarded);
  if(!result.includes('IMG_NS="ghcr.io/oaranha"') ||
     !result.includes('elus360_origem_confiavel()') ||
     !result.includes('--no-build'))
    throw new Error('ELUS_OPTIONAL_BUILD_PROVENANCE_MISSING');
  return result;
}

function mergeDistributionThreeWay({candidate,report,rule}) {
  const path=assertSafePath(rule.path);
  const record=report.review.find(x=>x.path===path);
  if(!record || record.reason!=='both_changed' || record.fork_status!=='M')
    throw new Error('ELUS_DISTRIBUTION_NOT_A_CONFLICT: '+path);
  const ours=readFileSync(join(candidate,path));
  if(gitBlobSha(ours)!==rule.officialBlob)
    throw new Error('ELUS_DISTRIBUTION_OFFICIAL_BLOB_CHANGED: '+path);
  const base=execFileSync('git',['-C',candidate,'show',report.upstream_base_sha+':'+path],
    {maxBuffer:12*1024*1024});
  const fork=execFileSync('git',['-C',candidate,'show',report.fork_sha+':'+path],
    {maxBuffer:12*1024*1024});
  if(gitBlobSha(base)!==rule.baseBlob || gitBlobSha(fork)!==rule.forkBlob)
    throw new Error('ELUS_DISTRIBUTION_SOURCE_BLOB_CHANGED: '+path);
  const scratch=mkdtempSync(join(tmpdir(),'elus360-three-way-'));
  try {
    const currentFile=join(scratch,'official'),baseFile=join(scratch,'base'),forkFile=join(scratch,'elus');
    writeFileSync(currentFile,ours); writeFileSync(baseFile,base);writeFileSync(forkFile,fork);
    const child=spawnSync('git',['merge-file','-p',currentFile,baseFile,forkFile],
      {encoding:'utf8',maxBuffer:12*1024*1024});
    if(child.error || child.status!==0 || child.signal)
      throw new Error('ELUS_DISTRIBUTION_THREE_WAY_CONFLICT: '+path+
        ' status='+child.status+' '+(child.error?.message||''));
    let content=child.stdout;
    // A revogação da política AMD64/no-build não deve reverter as
    // verificações ELUS de provenance, rollback ou namespace. Só o helper
    // compartilhado pode recuperar estas capacidades nesta etapa; install.sh
    // e update.sh têm gates adicionais e continuam sujeitos a homologação.
    if (rule.kind==='distribution_common_three_way')
      content=composeOptionalBuildPolicy(content,ours.toString('utf8'));
    if(!content || content===ours.toString('utf8'))
      throw new Error('ELUS_DISTRIBUTION_MERGE_WITHOUT_ELUS_DELTA: '+path);
    // O namespace tem fonte única no _common.sh original do ELUS (blob
    // pinado acima). Não repetimos o literal no reconciliador: o gate oficial
    // de namespace do fork exige exatamente essa propriedade.
    const forkNamespace=rule.kind==='distribution_common_three_way'
      ? /^IMG_NS="([^"]+)"$/m.exec(fork.toString('utf8'))?.[1] : null;
    if(rule.kind==='distribution_common_three_way' && !forkNamespace)
      throw new Error('ELUS_DISTRIBUTION_SOURCE_NAMESPACE_MISSING: '+path);
    const mandatory=rule.kind==='distribution_common_three_way'
      ? ['IMG_NS="'+forkNamespace+'"','elus360_origem_confiavel()',
          'ELUS_DISTRIBUTION_NO_GO','--no-build']
      : ['elus360_origem_confiavel','ELUS_DISTRIBUTION_NO_GO',
          'preflight_plataforma_atualizacao','BACKUP_ESPERA_LOCK=300'];
    if(mandatory.some(x=>!content.includes(x)))
      throw new Error('ELUS_DISTRIBUTION_REQUIRED_CONTRACT_MISSING: '+path);
    return {path,kind:rule.kind,official_blob:rule.officialBlob,
      base_blob:rule.baseBlob,fork_blob:rule.forkBlob,content,sha256:digest(content)};
  } finally {
    rmSync(scratch,{recursive:true,force:true});
  }
}

function exactReplace(text, oldValue, nextValue, path) {
  const chunks = text.split(oldValue);
  if (chunks.length !== 2) throw new Error('ADAPTER_ANCHOR_MISMATCH: '+path);
  if (nextValue === oldValue) throw new Error('ADAPTER_NO_CHANGE: '+path);
  return chunks.join(nextValue);
}

export function adaptText(original, adapter) {
  if (typeof original !== 'string' || !adapter || !Array.isArray(adapter.edits))
    throw new Error('BAD_ADAPTER');
  let result = original;
  for (const [oldValue,nextValue] of adapter.edits)
    result = exactReplace(result, oldValue, nextValue, adapter.path);
  return result;
}

/**
 * Decisão operacional do ELUS360: exclusões do fork de documentação de skills
 * deskcomm-* NÃO compõem uma personalização. Conservar o arquivo do upstream.
 * Este reconhecimento NÃO vale para código, scripts/hooks, modes ou arquivos ELUS.
 * Um item retido é conferido contra o blob Git do release oficial antes da escrita.
 */
export function keepOfficialDocumentation(item) {
  if (!item || item.fork_status !== 'D' ||
      !['both_changed','deletion_or_unsupported_mode'].includes(item.reason))
    return false;
  const path = assertSafePath(item.path);
  if (!/^\.(?:agents|claude)\/skills\/deskcomm-[^/]+\/.+\.(?:md|ya?ml|json)$/.test(path) ||
      /\/(?:scripts|hooks)\//.test(path))
    return false;
  return classifyConflict(item).category === 'upstream_docs_candidate';
}

/**
 * Ferramentas de contribuição da comunidade não pertencem ao runtime ELUS360:
 * a imagem oficial exclui .agents e .claude no .dockerignore.
 * Manter o conteúdo de origem é uma decisão de overlay, NÃO certificação
 * para executar hooks. Nenhum hook é instalado/ativado por este montador.
 */
export function keepOfficialDeveloperScript(item) {
  if(!item || item.reason!=='deletion_or_unsupported_mode' || item.fork_status!=='D')
    return false;
  const path=assertSafePath(item.path);
  if(!/^\.(?:agents|claude)\/skills\/deskcomm-[^/]+\/scripts\/.+$/.test(path))
    return false;
  return classifyConflict(item).category==='upstream_scripts_security_review';
}

// Os validadores de shell são testes do Deskcomm, não runtime ELUS.
 // Conservar o script oficial: não trazer fixtures antigas do fork.
export function keepOfficialUpstreamValidator(item) {
  return item?.path==='hostgator-setup-kit/test-validators.sh' &&
    item?.reason==='both_changed' && item?.fork_status==='M' &&
    item?.upstream_status==='M';
}

export function planChanges({report, targetSha, sourceByPath, officialBlobByPath, adapters = ADAPTERS}) {
  if (report?.schema_version !== 1 || report?.stage !== 'PREPARED_NOT_VALIDATED' ||
      report.upstream_target_sha !== OFFICIAL_TARGET || targetSha !== OFFICIAL_TARGET ||
      !Array.isArray(report.review) || report.review.length !== report.counts?.conflicts) 
    throw new Error('UNVERIFIED_CLEAN_BASE_REPORT');
  const originalReview = new Map();
  for (const item of report.review) {
    const path = assertSafePath(item.path);
    if (originalReview.has(path)) throw new Error('DUPLICATE_CONFLICT_PATH');
    originalReview.set(path, item);
  }
  const changed = [];
  for (const adapter of adapters) {
    const item = originalReview.get(adapter.path);
    if (!item || item.reason !== 'both_changed') throw new Error('ADAPTER_OUTSIDE_REVIEW: '+adapter.path);
    if (officialBlobByPath[adapter.path] !== adapter.officialBlob)
      throw new Error('OFFICIAL_BLOB_CHANGED: '+adapter.path);
    const oldContent = sourceByPath[adapter.path];
    if (typeof oldContent !== 'string') throw new Error('MISSING_OFFICIAL_FILE: '+adapter.path);
    const content = adaptText(oldContent, adapter);
    changed.push({path: adapter.path, kind: adapter.kind,
      official_blob: adapter.officialBlob, content,
      sha256: digest(content)});
  }
  const adaptedPaths = new Set(changed.map(c=>c.path));
  // Prioridade da base oficial: não há delta ELUS a reaplicar em docs apagados.
  const officialKept = report.review.filter(item =>
    !adaptedPaths.has(item.path) &&
    (keepOfficialDocumentation(item) || keepOfficialDeveloperScript(item) ||
     keepOfficialUpstreamValidator(item)));
  const keptPaths = new Set(officialKept.map(item=>item.path));
  const remaining = report.review.filter(item =>
    !adaptedPaths.has(item.path) && !keptPaths.has(item.path));
  if(adaptedPaths.size + keptPaths.size + remaining.length !== report.review.length)
    throw new Error('ELUS_OVERLAY_DECISION_COVERAGE_MISMATCH');
  return {changed, officialKept, remaining};
}

function parseFlags(argv) {
  if (argv.length!==6) throw new Error('USO: --candidate /abs/worktree --source-report /abs/report.json --reports /abs/destino');
  const f = new Map();
  for (let i=0;i<argv.length;i+=2){
    if(!['--candidate','--source-report','--reports'].includes(argv[i]) || f.has(argv[i]))
      throw new Error('BAD_FLAG');
    f.set(argv[i],argv[i+1]);
  }
  for(const k of ['--candidate','--source-report','--reports'])
    if(!f.has(k) || !isAbsolute(f.get(k))) throw new Error('REQUIRE_ABSOLUTE_PATH: '+k);
  return f;
}

export function run(argv) {
  const flags = parseFlags(argv), candidate = resolve(flags.get('--candidate'));
  const reportPath = resolve(flags.get('--source-report')), reports = resolve(flags.get('--reports'));
  const report = JSON.parse(readFileSync(reportPath,'utf8'));
  const actualHead = git(['-C',candidate,'rev-parse','HEAD']);
  // Verificar byte a byte a preparação ANTES dos adaptadores: relatório e worktree
  // devem representar o MESMO patch e conjunto de caminhos da release fixada.
  const prepared = execFileSync('git',['-C',candidate,'diff','--cached','--no-ext-diff','--binary'],{maxBuffer:128*1024*1024});
  if (digest(prepared)!==report.patch?.sha256 || prepared.length!==report.patch?.bytes)
    throw new Error('PREPARED_PATCH_INTEGRITY_MISMATCH');
  const staged=execFileSync('git',['-C',candidate,'diff','--cached','--name-only','-z']).toString('utf8').split('\0').filter(Boolean).sort();
  if (!Array.isArray(report.staged) || JSON.stringify(staged)!==JSON.stringify([...report.staged].sort()))
    throw new Error('PREPARED_PATHS_INTEGRITY_MISMATCH');
  // A árvore composta não pode ser a branch da PR nem a main; checkout detached.
  if (git(['-C',candidate,'branch','--show-current']) !== '') 
    throw new Error('CANDIDATE_MUST_BE_DETACHED');
  const sourceByPath = {}, officialBlobByPath = {};
  for(const adapter of ADAPTERS){
    assertSafePath(adapter.path);
    sourceByPath[adapter.path]=readFileSync(join(candidate,adapter.path),'utf8');
    officialBlobByPath[adapter.path]=git(['-C',candidate,'hash-object','--',adapter.path]);
  }
  // Preflight integral, SEM ESCRITA, antes de modificar qualquer arquivo.
  const plan=planChanges({report,targetSha:actualHead,sourceByPath,officialBlobByPath});
  // O upstream já está no worktree: validar identidade, modo não-executável e
  // ausência de alterações em cada doc que decidimos conservar.
  const rawTree=git(['-C',candidate,'ls-tree','-rz','HEAD','--',
    '.agents/skills','.claude/skills','hostgator-setup-kit/test-validators.sh']);
  const officialDocs = new Map();
  for(const record of rawTree.split('\0').filter(Boolean)) {
    const m=/^(\d{6}) blob ([a-f0-9]{40})\t(.+)$/.exec(record);
    if(m)officialDocs.set(m[3],{mode:m[1],sha:m[2]});
  }
  const officialKept=[];
  // Devtools do upstream não entram na imagem ELUS. Falha fechada se o
  // .dockerignore oficial deixar de excluí-los em release futura.
  const dockerIgnore=readFileSync(join(candidate,'.dockerignore'),'utf8');
  const dockerRules=new Set(dockerIgnore.split(/\r?\n/).map(x=>x.trim()));
  const devtoolExclusionsOk=dockerRules.has('.agents') && dockerRules.has('.claude');
  for(const item of plan.officialKept) {
    const developerTool=keepOfficialDeveloperScript(item);
    const officialValidator=keepOfficialUpstreamValidator(item);
    const expected=officialDocs.get(item.path);
    const allowedMode=developerTool || officialValidator
      ? ['100644','100755'].includes(expected?.mode)
      : expected?.mode==='100644';
    if(!expected || !allowedMode || report.staged.includes(item.path) ||
        (developerTool && !devtoolExclusionsOk))
      throw new Error('ELUS_OFFICIAL_DOCUMENT_NOT_SAFE: '+item.path);
    const bytes=readFileSync(join(candidate,item.path));
    const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    if(actual!==expected.sha)
      throw new Error('ELUS_OFFICIAL_DOCUMENT_MODIFIED: '+item.path);
    officialKept.push({path:item.path,official_blob:expected.sha,
      decision:developerTool ? 'keep_official_devtool_excluded_from_runtime'
        : officialValidator ? 'keep_official_upstream_test_without_elus_modifications'
        : 'keep_official_document_no_elus_overlay'});

  }
  // Pré-compor ambos os scripts antes de tocar no worktree candidato.
  // Se o Git detectar conflito semântico/textual (exit != 0), falhar fechado.
  const distributionMerged=DISTRIBUTION_MERGES.map(rule=>
    mergeDistributionThreeWay({candidate,report,rule}));
  const mergedPaths=new Set(distributionMerged.map(x=>x.path));
  if(mergedPaths.size!==distributionMerged.length ||
     distributionMerged.some(x=>plan.changed.some(y=>y.path===x.path) ||
       plan.officialKept.some(y=>y.path===x.path)))
    throw new Error('ELUS_DISTRIBUTION_DECISION_OVERLAP');
  for(const c of [...plan.changed,...distributionMerged])
    writeFileSync(join(candidate,c.path),c.content);
  git(['-C',candidate,'add','--',...plan.changed.map(x=>x.path),...distributionMerged.map(x=>x.path)]);
  const patch=execFileSync('git',['-C',candidate,'diff','--cached','--binary'],{maxBuffer:128*1024*1024});
  mkdirSync(reports,{recursive:true});
  const composed={
    schema_version:1, stage:'COMPOSED_NOT_VALIDATED',
    upstream_target_sha:actualHead, fork_sha:report.fork_sha,
    source_report_sha256:digest(readFileSync(reportPath)),
    adapted:[...plan.changed,...distributionMerged].map(({content,...metadata})=>metadata),
    official_kept:officialKept,
    counts:{safe_overlay:report.counts.staged,
      adaptations:plan.changed.length+distributionMerged.length,
      official_kept:officialKept.length,
      unresolved:plan.remaining.filter(x=>!mergedPaths.has(x.path)).length},
    unresolved:plan.remaining.filter(x=>!mergedPaths.has(x.path)),
    candidate_patch:{sha256:digest(patch),bytes:patch.length},
    gates:{source_blobs_pinned:true, official_documents_verified:true,
      distribution_three_way_clean:true,
      devtools_excluded_from_runtime:devtoolExclusionsOk,
      authorization:'NOT_RUN',typecheck:'NOT_RUN',build:'NOT_RUN',
      tenant_isolation:'NOT_RUN',db_upgrade:'NOT_RUN',functional_e2e:'NOT_RUN',merge_deploy:'FORBIDDEN'}
  };
  writeFileSync(join(reports,'elus360-composed.patch'),patch);
  writeFileSync(join(reports,'elus360-composed-report.json'),JSON.stringify(composed,null,2)+'\n');
  process.stdout.write(JSON.stringify({stage:composed.stage,counts:composed.counts,sha256:composed.candidate_patch.sha256})+'\n');
  return composed;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{run(process.argv.slice(2));}catch(e){console.error('ELUS_ADAPTER_NO_GO: '+e.message);process.exitCode=1;}
}
