// Geracao em lote das pesquisas de ciclo semestral.
//
// Universo: todo projeto ELEGIVEL e ativo no ciclo x cada respondente ativo
// vinculado a ele. Cada par passa pela mesma nps_gerar_pesquisa da geracao
// individual, sem forcar: o que ja tem pesquisa ativa no ciclo e mantido
// (contado como "existente"), nunca encerrado nem duplicado. Por isso rodar
// de novo e seguro — so gera o que faltou, como um respondente vinculado
// depois.
//
// Rota estatica sob /api/pesquisas — o Next resolve `lote` antes de `[id]`.

import { erro, json, lerCorpo, rotaApi, uuid } from "@/lib/http";
import { rpc, selecionar, um } from "@/lib/db";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ResultadoGeracao {
  duplicada?: boolean;
}

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);
    const cicloId = uuid(corpo.ciclo_id, "ciclo_id");

    const ciclo = await um<{ id: string; codigo: string; status: string }>(
      "ciclos_nps",
      { id: cicloId },
      "id,codigo,status"
    );
    if (!ciclo) throw erro(404, "CICLO_NAO_ENCONTRADO", "Ciclo nao encontrado.");
    if (ciclo.status === "encerrado") {
      throw erro(400, "CICLO_ENCERRADO", "Este ciclo esta encerrado e nao aceita novas pesquisas.");
    }

    const { dados: participacoes } = await selecionar<{ projeto_id: string | null }[]>(
      "projetos_nps",
      { colunas: "projeto_id", filtros: { ciclo_id: cicloId, elegivel: true, ativo: true } }
    );
    const candidatos = [
      ...new Set((participacoes || []).map((p) => p.projeto_id).filter(Boolean) as string[]),
    ];

    const vazio = { ciclo: ciclo.codigo, projetos: 0, geradas: 0, existentes: 0, falhas: 0, sem_respondente: 0 };
    if (!candidatos.length) return json(vazio);

    // O cadastro mestre tambem precisa estar ativo: a RPC recusa projeto
    // inativo, e filtrar aqui evita contar isso como falha.
    const [{ dados: mestres }, { dados: vinculos }] = await Promise.all([
      selecionar<{ id: string }[]>("projetos_mestre_nps", {
        colunas: "id",
        filtros: { id: candidatos, ativo: true },
      }),
      selecionar<{ projeto_id: string; respondente_id: string }[]>("projeto_respondentes_nps", {
        colunas: "projeto_id,respondente_id",
        filtros: { projeto_id: candidatos, ativo: true },
      }),
    ]);
    const projetos = new Set((mestres || []).map((m) => m.id));

    const idsResp = [...new Set((vinculos || []).map((v) => v.respondente_id))];
    const { dados: respAtivos } = idsResp.length
      ? await selecionar<{ id: string }[]>("respondentes_nps", {
          colunas: "id",
          filtros: { id: idsResp, ativo: true },
        })
      : { dados: [] as { id: string }[] };
    const ativos = new Set((respAtivos || []).map((r) => r.id));

    const pares = (vinculos || []).filter(
      (v) => projetos.has(v.projeto_id) && ativos.has(v.respondente_id)
    );
    const comRespondente = new Set(pares.map((p) => p.projeto_id));

    let geradas = 0;
    let existentes = 0;
    let falhas = 0;

    // Em sequencia: sao dezenas de pares, e cada chamada audita e gera token.
    // Paralelizar pouco ganharia e dificultaria ler o log se algo falhar.
    for (const par of pares) {
      try {
        const r = await rpc<ResultadoGeracao>("nps_gerar_pesquisa", {
          p_projeto_id: par.projeto_id,
          p_respondente_id: par.respondente_id,
          p_tipo: "ciclo_semestral",
          p_ciclo_id: cicloId,
          p_ator: sessao.nome,
          p_forcar: false,
        });
        if (r?.duplicada) existentes += 1;
        else geradas += 1;
      } catch (e) {
        falhas += 1;
        console.error("[NPS][LOTE] Falha ao gerar pesquisa:", par, e);
      }
    }

    return json({
      ciclo: ciclo.codigo,
      projetos: projetos.size,
      geradas,
      existentes,
      falhas,
      sem_respondente: [...projetos].filter((id) => !comRespondente.has(id)).length,
    });
  });
}
