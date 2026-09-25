// Acesso ao banco, com dois motores e a mesma API para as rotas:
//
//  - DATABASE_URL definida -> Postgres direto (lib/dbPostgres.ts). E o modo do
//    servidor proprio, onde nao ha a API REST do Supabase.
//  - senao -> PostgREST do Supabase (SUPABASE_URL + service_role), como antes.
//
// As rotas nao sabem qual motor esta ativo: `selecionar`, `inserir`,
// `atualizar` e `rpc` devolvem o mesmo formato nos dois, e os erros passam
// pela mesma traducao (traduzirStatus/traduzirMensagem).
//
// Historico: cliente PostgREST minimo sobre o fetch nativo.
//
// Porte de api/_lib/db.js para TypeScript. A escolha de continuar falando
// PostgREST, em vez de trocar por um ORM, e deliberada: a regra de negocio
// deste sistema vive em ~12 funcoes plpgsql (nps_gerar_pesquisa,
// nps_passagem_ciclo, nps_responder_pesquisa...) que garantem atomicidade
// dentro do banco. Um ORM por cima delas duplicaria o modelo sem substituir
// uma linha de logica — e o que ele resolveria (montar SELECT tipado) estas
// 200 linhas ja resolvem.
//
// A service_role key NUNCA sai do servidor: todo modulo que importa este
// arquivo roda em route handler ou Server Component.

import { erro } from "@/lib/validacao";
import {
  FalhaBanco,
  pgAtualizar,
  pgInserir,
  pgRpc,
  pgSelecionar,
} from "@/lib/dbPostgres";

/** Postgres direto quando ha DATABASE_URL; PostgREST do Supabase, senao. */
const usaPostgres = () => Boolean(process.env.DATABASE_URL);

/** Roda no motor Postgres traduzindo a falha como a do PostgREST. */
async function noPostgres<T>(acao: () => Promise<unknown>): Promise<T> {
  try {
    return (await acao()) as T;
  } catch (e) {
    if (e instanceof FalhaBanco) {
      const negocio = e.message.trim();
      throw erro(
        traduzirStatus(e.status, negocio),
        negocio || "ERRO_BANCO",
        traduzirMensagem(negocio)
      );
    }
    throw e;
  }
}

// Lidas a cada chamada, e nao na carga do modulo, para que trocar o .env.local
// tenha efeito sem depender de quando o modulo foi avaliado.
const config = () => ({
  url: process.env.SUPABASE_URL,
  chave: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

function cabecalhos(chave: string, extra: Record<string, string> = {}) {
  return {
    apikey: chave,
    Authorization: `Bearer ${chave}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export interface RespostaDb<T = unknown> {
  dados: T;
  total: number | null;
}

interface OpcoesRequisicao {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function requisitar<T = unknown>(
  caminho: string,
  opcoes: OpcoesRequisicao = {}
): Promise<RespostaDb<T>> {
  const { url, chave } = config();
  if (!url || !chave) {
    const faltando = [!url && "SUPABASE_URL", !chave && "SUPABASE_SERVICE_ROLE_KEY"]
      .filter(Boolean)
      .join(" e ");
    throw erro(500, "CONFIG_AUSENTE", `Falta configurar ${faltando} no servidor.`);
  }

  const resposta = await fetch(`${url}/rest/v1/${caminho}`, {
    method: opcoes.method || "GET",
    headers: cabecalhos(chave, opcoes.headers),
    body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body),
    // Nenhuma leitura deste sistema pode ser servida de cache: os dados mudam
    // a cada resposta de pesquisa, e o resultado depende de quem perguntou.
    cache: "no-store",
  });

  const bruto = await resposta.text();
  let dados: unknown = null;
  if (bruto) {
    try {
      dados = JSON.parse(bruto);
    } catch {
      dados = bruto;
    }
  }

  if (!resposta.ok) {
    const corpo = dados as { message?: string; hint?: string } | string | null;
    const msg =
      (corpo && typeof corpo === "object" && (corpo.message || corpo.hint)) ||
      "Falha na consulta ao banco.";
    // Erros de negocio levantados por RAISE EXCEPTION nas funcoes plpgsql
    // chegam aqui como texto — sao eles que viram 400/403/404 com mensagem
    // legivel, em vez de um 500 opaco.
    const negocio = typeof msg === "string" ? msg.trim() : "";
    throw erro(
      traduzirStatus(resposta.status, negocio),
      negocio || "ERRO_BANCO",
      traduzirMensagem(negocio)
    );
  }

  return {
    dados: dados as T,
    total: totalDoRange(resposta.headers.get("content-range")),
  };
}

function totalDoRange(range: string | null): number | null {
  if (!range) return null;
  const t = parseInt(range.split("/")[1], 10);
  return Number.isFinite(t) ? t : null;
}

const MENSAGENS: Record<string, string> = {
  PROJETO_NAO_ENCONTRADO: "Projeto nao encontrado.",
  PROJETO_INATIVO: "Projeto inativo. Reative-o antes de prosseguir.",
  LIDER_NAO_ENCONTRADO: "Lider nao encontrado.",
  LIDER_INATIVO: "Este lider esta inativo.",
  RESPONDENTE_NAO_ENCONTRADO: "Respondente nao encontrado.",
  CODIGO_DUPLICADO: "Ja existe um projeto com este codigo.",
  CODIGO_OBRIGATORIO: "Informe o codigo do projeto.",
  NOME_OBRIGATORIO: "Informe o nome do projeto.",
  CICLO_NAO_ENCONTRADO: "Ciclo nao encontrado.",
  CICLO_ENCERRADO: "Este ciclo esta encerrado e nao aceita alteracoes.",
  CICLO_OBRIGATORIO: "Selecione o ciclo da pesquisa.",
  TIPO_INVALIDO: "Tipo de pesquisa invalido.",
  PESQUISA_NAO_ENCONTRADA: "Pesquisa nao encontrada ou link invalido.",
  PESQUISA_ENCERRADA: "Esta pesquisa foi encerrada.",
  PESQUISA_JA_RESPONDIDA: "Esta pesquisa ja foi respondida.",
  Q4_OBRIGATORIA: "A nota de indicacao e obrigatoria.",
  NOTA_INVALIDA: "As notas devem ser numeros de 0 a 10.",
  NAO_AUTORIZADO: "Voce nao tem permissao sobre este registro.",
  OBSERVACAO_OBRIGATORIA_PARA_OUTRO: "Informe a observacao quando o motivo for Outro.",
  STATUS_INVALIDO: "Status invalido.",
  DECISOES_INVALIDAS: "Lista de decisoes invalida.",
  PROJETO_NAO_ELEGIVEL_NO_CICLO: "O projeto nao e elegivel neste ciclo.",
  PROJETO_SEM_RESPOSTA_NO_CICLO: "O projeto ainda nao recebeu resposta neste ciclo.",
  ASSUNTO_E_OBJETIVO_OBRIGATORIOS: "Informe o assunto e o objetivo do plano de acao.",
  PLANO_COM_ACOES: "O plano ja tem acoes lancadas; remova-as antes de marcar como nao passivel.",
  PLANO_NAO_ENCONTRADO: "Plano de acao nao encontrado.",
  PROJETO_SEM_PLANO_DE_ACAO: "Este projeto foi marcado como nao passivel de plano de acao.",
  PLANO_ENCERRADO: "Este plano de acao esta encerrado. Reabra-o para alterar.",
  O_QUE_OBRIGATORIO: "Informe o que sera feito.",
  SITUACAO_INVALIDA: "Situacao invalida.",
  VALOR_INVALIDO: "Valor invalido.",
  ACAO_NAO_ENCONTRADA: "Acao nao encontrada.",
  EVIDENCIA_OBRIGATORIA: "Para marcar a acao como feita, informe o link da evidencia.",
  EVIDENCIA_INVALIDA: "A evidencia deve ser um link que comece com http:// ou https://.",
};

function traduzirMensagem(codigo: string): string {
  if (!codigo) return "Falha na consulta ao banco.";
  for (const chave of Object.keys(MENSAGENS)) {
    if (codigo.includes(chave)) return MENSAGENS[chave];
  }
  if (codigo.includes("duplicate key")) return "Ja existe um registro com estes dados.";
  if (codigo.includes("violates foreign key")) return "Registro relacionado inexistente.";
  if (codigo.includes("violates check constraint")) return "Dados fora das regras permitidas.";
  return codigo;
}

function traduzirStatus(status: number, codigo: string): number {
  if (codigo.includes("NAO_AUTORIZADO")) return 403;
  if (codigo.includes("NAO_ENCONTRAD")) return 404;
  if (status >= 500) return 502;
  return status === 409 ? 409 : 400;
}

const escapar = (v: unknown) => `"${String(v).replace(/"/g, '\\"')}"`;

export type FiltroValor =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | { op: string; valor: string | number | null | undefined };

export interface OpcoesSelecionar {
  colunas?: string;
  filtros?: Record<string, FiltroValor>;
  ordem?: { campo: string; ascending: boolean } | null;
  de?: number | null;
  ate?: number | null;
  contar?: boolean;
  ou?: string | null;
  limite?: number | null;
}

/**
 * SELECT com filtros.
 * filtros: { coluna: valor } | { coluna: { op: 'ilike', valor: '%x%' } }
 */
export async function selecionar<T = Record<string, unknown>[]>(
  tabela: string,
  {
    colunas = "*",
    filtros = {},
    ordem = null,
    de = null,
    ate = null,
    contar = false,
    ou = null,
    limite = null,
  }: OpcoesSelecionar = {}
): Promise<RespostaDb<T>> {
  if (usaPostgres()) {
    return noPostgres<RespostaDb<T>>(() =>
      pgSelecionar(tabela, { colunas, filtros, ordem, de, ate, contar, ou, limite })
    );
  }

  const params = new URLSearchParams();
  params.set("select", colunas);

  for (const [coluna, bruto] of Object.entries(filtros)) {
    if (bruto === undefined || bruto === null) continue;
    if (typeof bruto === "object" && !Array.isArray(bruto) && "op" in bruto) {
      if (bruto.valor === undefined || bruto.valor === null || bruto.valor === "") continue;
      params.append(coluna, `${bruto.op}.${bruto.valor}`);
    } else if (Array.isArray(bruto)) {
      if (!bruto.length) continue;
      params.append(coluna, `in.(${bruto.map(escapar).join(",")})`);
    } else {
      params.append(coluna, `eq.${bruto}`);
    }
  }

  if (ou) params.append("or", `(${ou})`);
  if (ordem) params.set("order", `${ordem.campo}.${ordem.ascending ? "asc" : "desc"}.nullslast`);
  if (limite !== null) params.set("limit", String(limite));

  const cab: Record<string, string> = {};
  if (contar) cab.Prefer = "count=exact";
  if (de !== null && ate !== null) cab.Range = `${de}-${ate}`;

  return requisitar<T>(`${tabela}?${params.toString()}`, { headers: cab });
}

export async function inserir<T = Record<string, unknown>[]>(
  tabela: string,
  registros: unknown,
  { retornar = true }: { retornar?: boolean } = {}
): Promise<T> {
  if (usaPostgres()) return noPostgres<T>(() => pgInserir(tabela, registros, retornar));

  const { dados } = await requisitar<T>(tabela, {
    method: "POST",
    body: registros,
    headers: { Prefer: retornar ? "return=representation" : "return=minimal" },
  });
  return dados;
}

export async function atualizar<T = Record<string, unknown>[]>(
  tabela: string,
  filtros: Record<string, string | number | boolean>,
  valores: unknown
): Promise<T> {
  if (usaPostgres()) {
    return noPostgres<T>(() =>
      pgAtualizar(tabela, filtros, (valores || {}) as Record<string, unknown>)
    );
  }

  const params = new URLSearchParams();
  for (const [coluna, valor] of Object.entries(filtros)) params.append(coluna, `eq.${valor}`);
  const { dados } = await requisitar<T>(`${tabela}?${params.toString()}`, {
    method: "PATCH",
    body: valores,
    headers: { Prefer: "return=representation" },
  });
  return dados;
}

/** Chama uma funcao plpgsql (regras de negocio atomicas). */
export async function rpc<T = unknown>(
  funcao: string,
  argumentos: Record<string, unknown> = {}
): Promise<T> {
  if (usaPostgres()) return noPostgres<T>(() => pgRpc(funcao, argumentos));

  const { dados } = await requisitar<T>(`rpc/${funcao}`, { method: "POST", body: argumentos });
  return dados;
}

/** Busca um unico registro ou null. */
export async function um<T = Record<string, unknown>>(
  tabela: string,
  filtros: Record<string, FiltroValor>,
  colunas = "*"
): Promise<T | null> {
  const { dados } = await selecionar<T[]>(tabela, { colunas, filtros, limite: 1 });
  return Array.isArray(dados) && dados.length ? dados[0] : null;
}

/** Escapa curingas de LIKE para que a busca do usuario seja literal. */
export function termoBusca(valor: unknown): string | null {
  if (!valor) return null;
  const limpo = String(valor)
    .trim()
    .slice(0, 100)
    .replace(/[%_\\,()]/g, (c) => `\\${c}`);
  return limpo ? `*${limpo}*` : null;
}

/** Espelha public.nps_norm() no banco: sem acento, sem espaco duplo, maiuscula. */
export function normalizar(valor: unknown): string {
  if (!valor) return "";
  return String(valor)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Auditoria em `auditoria_nps` via a funcao do banco.
 *
 * Melhor esforco, como a auditoria do SGA: uma falha de log NUNCA pode
 * derrubar a acao que o originou. Um projeto salvo com sucesso nao vira erro
 * na tela porque a linha de auditoria nao entrou.
 */
export async function auditar(dados: {
  acao: string;
  entidade: string;
  registroId: string | null;
  descricao: string;
  atorTipo: string;
  atorNome: string;
  antes?: unknown;
  depois?: unknown;
}): Promise<void> {
  try {
    await rpc("nps_auditar", {
      p_acao: dados.acao,
      p_entidade: dados.entidade,
      p_registro_id: dados.registroId,
      p_descricao: dados.descricao,
      p_ator_tipo: dados.atorTipo,
      p_ator_nome: dados.atorNome,
      p_antes: dados.antes ?? null,
      p_depois: dados.depois ?? null,
    });
  } catch (e) {
    console.warn("[NPS][auditoria] nao foi possivel registrar:", e);
  }
}
