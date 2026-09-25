// Dashboard operacional do ciclo: o que ja foi respondido e o que falta.

import { json, ordenacao, paginacao, rotaApi } from "@/lib/http";
import { selecionar, termoBusca } from "@/lib/db";
import { montarFiltrosOperacao } from "@/lib/operacao";
import { exigirSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDENAVEIS = [
  "projeto_nome",
  "cliente_nome",
  "lider_ciclo",
  "respondentes",
  "pesquisas",
  "respostas",
  "situacao",
] as const;

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const { pagina, porPagina, de, ate } = paginacao(query);
    const ordem = ordenacao(query, ORDENAVEIS, "projeto_nome");

    const filtros = montarFiltrosOperacao(query, sessao);
    if (filtros === null) return json({ itens: [], total: 0, pagina, porPagina });

    const busca = termoBusca(query.get("busca"));
    const ou = busca
      ? `projeto_nome.ilike.${busca},cliente_nome.ilike.${busca},codigo_clockify.ilike.${busca}`
      : null;

    const { dados, total } = await selecionar("vw_operacao_ciclo", {
      colunas: "*",
      filtros,
      ou,
      ordem,
      de,
      ate,
      contar: true,
    });

    return json({ itens: dados || [], total: total ?? 0, pagina, porPagina });
  });
}
