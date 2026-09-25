// Trilha de auditoria. Rastreabilidade administrativa e exclusiva do PMO.

import { json, ordenacao, paginacao, rotaApi, texto, uuidOpcional } from "@/lib/http";
import { type FiltroValor, selecionar, termoBusca } from "@/lib/db";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDENAVEIS = ["created_at", "acao", "entidade", "ator_nome"] as const;

export async function GET(req: Request) {
  return rotaApi(async () => {
    await exigirPmo();
    const query = new URL(req.url).searchParams;

    const { pagina, porPagina, de, ate } = paginacao(query);
    const ordem = ordenacao(query, ORDENAVEIS, "created_at");

    const filtros: Record<string, FiltroValor> = {};
    const entidade = texto(query.get("entidade"), "entidade", { max: 40 });
    if (entidade) filtros.entidade = entidade;
    const acao = texto(query.get("acao"), "acao", { max: 40 });
    if (acao) filtros.acao = acao;
    const registro = uuidOpcional(query.get("registro"), "registro");
    if (registro) filtros.registro_id = registro;
    const ator = texto(query.get("ator"), "ator", { max: 120 });
    if (ator) filtros.ator_nome = ator;

    const desde = texto(query.get("desde"), "desde", { max: 30 });
    if (desde) filtros.created_at = { op: "gte", valor: desde };

    const busca = termoBusca(query.get("busca"));
    const ou = busca ? `descricao.ilike.${busca},ator_nome.ilike.${busca}` : null;

    const { dados, total } = await selecionar("auditoria_nps", {
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
