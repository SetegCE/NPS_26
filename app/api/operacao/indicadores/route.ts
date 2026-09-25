// Indicadores consolidados do ciclo.
//
// A separacao conceitual abaixo e o ponto inteiro desta rota, e nao pode ser
// afrouxada em nome de um numero mais bonito:
//
//   - projetos elegiveis    (universo / denominador)
//   - projetos com resposta (numerador da cobertura)
//   - respondentes distintos (pessoas)
//   - respostas             (avaliacoes individuais)
//
// Nunca se confunde quantidade de respostas com quantidade de projetos
// respondidos: uma pessoa pode avaliar varios projetos e um projeto pode
// receber varias avaliacoes.

import { json, rotaApi } from "@/lib/http";
import { type FiltroValor, selecionar } from "@/lib/db";
import { montarFiltrosOperacao } from "@/lib/operacao";
import { exigirSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LinhaOperacao {
  projeto_id: string | null;
  elegivel: boolean | null;
  respostas: number | string | null;
}

interface RespostaEnriquecida {
  respondente_id: string | null;
  categoria: string | null;
  resposta_valida: boolean | null;
}

function competenciaAtual(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const filtros = montarFiltrosOperacao(query, sessao);
    if (filtros === null) return json({ vazio: true });

    const cicloId = (filtros.ciclo_id as string | undefined) || null;

    const { dados: linhas } = await selecionar<LinhaOperacao[]>("vw_operacao_ciclo", {
      colunas: "projeto_id,elegivel,respostas",
      filtros,
    });

    const elegiveis = (linhas || []).filter((l) => l.elegivel);
    const projetosElegiveis = elegiveis.length;
    const projetosComResposta = elegiveis.filter((l) => Number(l.respostas) > 0).length;

    const idsProjetos = elegiveis.map((l) => l.projeto_id).filter(Boolean) as string[];
    if (!idsProjetos.length) {
      return json({
        projetos_elegiveis: projetosElegiveis,
        projetos_com_resposta: 0,
        cobertura: 0,
        respondentes: 0,
        respostas: 0,
        respostas_totais: 0,
        nps: 0,
        promotores: 0,
        neutros: 0,
        detratores: 0,
        isc_medio: null,
        isc_competencia: competenciaAtual(),
      });
    }

    const filtrosResp: Record<string, FiltroValor> = { projeto_id: idsProjetos };
    if (cicloId) filtrosResp.ciclo_id = cicloId;

    const competencia = competenciaAtual();

    const [{ dados: respostas }, { dados: iscs }] = await Promise.all([
      selecionar<RespostaEnriquecida[]>("vw_respostas_enriquecidas", {
        colunas: "id,respondente_id,nota_q4,categoria,resposta_valida",
        filtros: filtrosResp,
      }),
      // ISC medio da competencia vigente — indicador INTERNO, separado do NPS.
      selecionar<{ nota: number | string }[]>("isc_nps", {
        colunas: "nota",
        filtros: { projeto_id: idsProjetos, competencia },
      }),
    ]);

    const validas = (respostas || []).filter((r) => r.resposta_valida);
    const promotores = validas.filter((r) => r.categoria === "PROMOTOR").length;
    const neutros = validas.filter((r) => r.categoria === "NEUTRO").length;
    const detratores = validas.filter((r) => r.categoria === "DETRATOR").length;

    // Mesma formula do dashboard: somente Q4.
    const nps = validas.length
      ? Math.round((promotores / validas.length) * 100 - (detratores / validas.length) * 100)
      : 0;

    const respondentes = new Set(validas.map((r) => r.respondente_id).filter(Boolean)).size;

    const iscMedio =
      iscs && iscs.length
        ? Number((iscs.reduce((s, i) => s + Number(i.nota), 0) / iscs.length).toFixed(1))
        : null;

    return json({
      projetos_elegiveis: projetosElegiveis,
      projetos_com_resposta: projetosComResposta,
      cobertura: projetosElegiveis
        ? Math.round((projetosComResposta / projetosElegiveis) * 1000) / 10
        : 0,
      respondentes,
      respostas: validas.length,
      respostas_totais: (respostas || []).length,
      nps,
      promotores,
      neutros,
      detratores,
      isc_medio: iscMedio,
      isc_competencia: competencia,
    });
  });
}
