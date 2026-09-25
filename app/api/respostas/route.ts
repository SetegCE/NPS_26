// Respostas de todos os ciclos (aba "Respostas").
//
// PMO ve tudo. Lider ve as respostas colhidas nos PERIODOS em que liderou o
// projeto — a mesma regra do dashboard (escopoDoLider: pares projeto+ciclo),
// nao o lider de hoje. Esse recorte nao cabe num filtro simples de banco, e o
// volume e pequeno (dezenas por ciclo): a rota filtra, ordena e pagina em
// memoria, e devolve tambem o resumo do recorte (total e NPS).

import { json, ordenacao, paginacao, rotaApi, umDe, uuidOpcional } from "@/lib/http";
import { type FiltroValor, selecionar, termoBusca } from "@/lib/db";
import { chaveDoEscopo, escopoDoLider, exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIAS = ["PROMOTOR", "NEUTRO", "DETRATOR"] as const;
const ORDENAVEIS = ["timestamp", "ciclo", "cliente_nome", "projeto_nome", "respondente_nome", "nota_q4", "lider_periodo"] as const;

interface Resposta extends Record<string, unknown> {
  id: string;
  projeto_id: string | null;
  ciclo: string | null;
  nota_q4: number | null;
  categoria: string | null;
  resposta_valida: boolean;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;
    const { pagina, porPagina } = paginacao(query);
    const ordem = ordenacao(query, ORDENAVEIS, "timestamp");

    const escopo = await escopoDoLider(sessao);
    const vazio = { itens: [], total: 0, pagina, porPagina, resumo: resumir([]) };
    if (escopo !== null && escopo.projetoIds.length === 0) return json(vazio);

    const filtros: Record<string, FiltroValor> = {};
    if (escopo !== null) filtros.projeto_id = escopo.projetoIds;
    const ciclo = uuidOpcional(query.get("ciclo"), "ciclo");
    if (ciclo) filtros.ciclo_id = ciclo;
    const cliente = uuidOpcional(query.get("cliente"), "cliente");
    if (cliente) filtros.cliente_id = cliente;
    const categoria = umDe(query.get("categoria"), CATEGORIAS, "categoria");
    if (categoria) filtros.categoria = categoria;
    // Filtro por lider (do periodo da resposta) so faz sentido para o PMO.
    const lider = sessao.perfil === PERFIL_LIDER ? null : uuidOpcional(query.get("lider"), "lider");
    if (lider) filtros.lider_periodo_id = lider;

    const busca = termoBusca(query.get("busca"));
    const ou = busca
      ? `respondente_nome.ilike.${busca},identificador.ilike.${busca},projeto_nome.ilike.${busca},cliente_nome.ilike.${busca},codigo_clockify.ilike.${busca},feedback.ilike.${busca}`
      : null;

    const { dados } = await selecionar<Resposta[]>("vw_respostas_enriquecidas", {
      colunas: "*",
      filtros,
      ou,
      ordem: { campo: ordem.campo, ascending: ordem.ascending },
    });

    let linhas = dados || [];
    if (escopo !== null) {
      linhas = linhas.filter((r) => r.projeto_id && escopo.pares.has(chaveDoEscopo(r.projeto_id, r.ciclo)));
    }

    const inicio = (pagina - 1) * porPagina;
    return json({
      itens: linhas.slice(inicio, inicio + porPagina),
      total: linhas.length,
      pagina,
      porPagina,
      resumo: resumir(linhas),
    });
  });
}

/** Total, validas e NPS (% promotores - % detratores) do recorte. */
function resumir(linhas: Resposta[]) {
  const validas = linhas.filter((r) => r.resposta_valida);
  const promotores = validas.filter((r) => r.categoria === "PROMOTOR").length;
  const neutros = validas.filter((r) => r.categoria === "NEUTRO").length;
  const detratores = validas.filter((r) => r.categoria === "DETRATOR").length;
  const nps = validas.length ? Math.round(((promotores - detratores) / validas.length) * 100) : null;
  return { total: linhas.length, validas: validas.length, promotores, neutros, detratores, nps };
}
