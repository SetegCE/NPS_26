// Geracao e acompanhamento de pesquisas.

import {
  booleano,
  erro,
  json,
  lerCorpo,
  ordenacao,
  paginacao,
  rotaApi,
  umDe,
  uuid,
  uuidOpcional,
} from "@/lib/http";
import { type FiltroValor, rpc, selecionar, termoBusca } from "@/lib/db";
import { STATUS_PESQUISA, TIPOS_PESQUISA } from "@/lib/listas";
import { montarLinkDaPesquisa } from "@/lib/link";
import { exigirPmo, exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDENAVEIS = [
  "data_geracao",
  "data_envio",
  "data_resposta",
  "status",
  "projeto_nome",
  "respondente_nome",
] as const;

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const { pagina, porPagina, de, ate } = paginacao(query);
    const ordem = ordenacao(query, ORDENAVEIS, "data_geracao");

    const filtros: Record<string, FiltroValor> = {};
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return json({ itens: [], total: 0, pagina, porPagina });
      filtros.lider_id = sessao.liderId;
    }

    const projeto = uuidOpcional(query.get("projeto"), "projeto");
    if (projeto) filtros.projeto_id = projeto;
    const ciclo = uuidOpcional(query.get("ciclo"), "ciclo");
    if (ciclo) filtros.ciclo_id = ciclo;
    const respondente = uuidOpcional(query.get("respondente"), "respondente");
    if (respondente) filtros.respondente_id = respondente;

    const tipo = umDe(query.get("tipo"), TIPOS_PESQUISA, "tipo");
    if (tipo) filtros.tipo = tipo;
    const status = umDe(query.get("status"), STATUS_PESQUISA, "status");
    if (status) filtros.status = status;
    const ativo = booleano(query.get("ativo"), null);
    if (ativo !== null) filtros.ativo = ativo;

    const busca = termoBusca(query.get("busca"));
    const ou = busca
      ? `projeto_nome.ilike.${busca},respondente_nome.ilike.${busca},cliente_nome.ilike.${busca},codigo_clockify.ilike.${busca}`
      : null;

    const { dados, total } = await selecionar<Record<string, unknown>[]>("vw_pesquisas", {
      colunas: "*",
      filtros,
      ou,
      ordem,
      de,
      ate,
      contar: true,
    });

    // O token NAO e exposto na listagem: quem tem o token responde a pesquisa
    // no lugar do cliente. Ele so sai por /api/pesquisas/[id]/link, sob
    // demanda e com autorizacao conferida.
    const itens = (dados || []).map(({ token, ...resto }) => ({
      ...resto,
      tem_link: Boolean(token),
    }));

    return json({ itens, total: total ?? 0, pagina, porPagina });
  });
}

interface ResultadoGeracao {
  duplicada?: boolean;
  pesquisa: { token: string; [chave: string]: unknown };
}

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);

    const tipo = umDe(corpo.tipo, TIPOS_PESQUISA, "tipo", { obrigatorio: true });
    const cicloId = uuidOpcional(corpo.ciclo_id, "ciclo_id");
    if (tipo === "ciclo_semestral" && !cicloId) {
      throw erro(400, "CICLO_OBRIGATORIO", "Selecione o ciclo da pesquisa semestral.");
    }

    const resultado = await rpc<ResultadoGeracao>("nps_gerar_pesquisa", {
      p_projeto_id: uuid(corpo.projeto_id, "projeto_id"),
      p_respondente_id: uuid(corpo.respondente_id, "respondente_id"),
      p_tipo: tipo,
      p_ciclo_id: cicloId,
      p_ator: sessao.nome,
      p_forcar: booleano(corpo.forcar, false),
    });

    const { token, ...semToken } = resultado.pesquisa;

    // Duplicidade: devolve 409 com a pesquisa existente para o PMO decidir se
    // reaproveita o link ou forca a geracao de um novo.
    if (resultado?.duplicada) {
      return json(
        {
          erro: "PESQUISA_DUPLICADA",
          mensagem: "Ja existe uma pesquisa para este projeto e respondente neste ciclo.",
          pesquisa: semToken,
          link: montarLinkDaPesquisa(req, token),
        },
        409
      );
    }

    return json({ pesquisa: semToken, link: montarLinkDaPesquisa(req, token) }, 201);
  });
}
