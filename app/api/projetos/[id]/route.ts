// Detalhe do projeto com todas as abas da tela: respondentes, pesquisas,
// respostas, historico de lideranca, participacao em ciclos, transicoes, ISC
// e auditoria.

import { erro, json, rotaApi, uuid } from "@/lib/http";
import { selecionar, um } from "@/lib/db";
import { chaveDoEscopo, escopoDoLider, exigirAcessoAoProjeto, exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Vinculo {
  respondente_id: string | null;
  [chave: string]: unknown;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const id = uuid(params.id, "id");

    // Autorizacao antes de qualquer leitura: um lider pedindo o id de outro
    // leva 403 sem que uma linha sequer seja consultada.
    await exigirAcessoAoProjeto(sessao, id);

    const [
      projeto,
      respondentes,
      pesquisas,
      respostas,
      liderancas,
      participacoes,
      transicoes,
      iscs,
      auditoria,
    ] = await Promise.all([
      um("vw_projetos_admin", { id }),
      selecionar<Vinculo[]>("projeto_respondentes_nps", {
        colunas:
          "id,ativo,created_at,respondente_id,respondentes_nps(id,nome,email,telefone,ativo)",
        filtros: { projeto_id: id },
      }),
      selecionar("vw_pesquisas", {
        colunas: "*",
        filtros: { projeto_id: id },
        ordem: { campo: "data_geracao", ascending: false },
      }),
      selecionar<{ respondente_id: string | null; projeto_id: string | null; ciclo: string | null }[]>("vw_respostas_enriquecidas", {
        colunas: "*",
        filtros: { projeto_id: id },
        ordem: { campo: "timestamp", ascending: false },
      }),
      selecionar("projeto_lideranca_hist_nps", {
        colunas: "*",
        filtros: { projeto_id: id },
        ordem: { campo: "iniciado_em", ascending: false },
      }),
      selecionar("projetos_nps", {
        colunas: "id,ciclo,ciclo_id,elegivel,ativo,lider,cliente,projeto",
        filtros: { projeto_id: id },
        ordem: { campo: "ciclo", ascending: false },
      }),
      selecionar("ciclo_transicao_nps", {
        colunas: "*",
        filtros: { projeto_id: id },
        ordem: { campo: "created_at", ascending: false },
      }),
      selecionar("isc_nps", {
        colunas: "*",
        filtros: { projeto_id: id },
        ordem: { campo: "competencia", ascending: false },
      }),
      selecionar("auditoria_nps", {
        colunas: "*",
        filtros: { registro_id: id },
        ordem: { campo: "created_at", ascending: false },
        limite: 100,
      }),
    ]);

    if (!projeto) throw erro(404, "PROJETO_NAO_ENCONTRADO", "Projeto não encontrado.");

    // O lider so ve as respostas dos ciclos em que ele era o lider — a mesma
    // regra da aba Respostas (escopoDoLider). Sem isto, quem herda um projeto
    // veria aqui as notas colhidas sob o lider anterior.
    const escopo = await escopoDoLider(sessao);
    const respostasVisiveis = (respostas.dados || []).filter(
      (r) => escopo === null || escopo.pares.has(chaveDoEscopo(r.projeto_id, r.ciclo))
    );

    // Quem respondeu e quem nao respondeu.
    const responderamIds = new Set(
      respostasVisiveis.map((r) => r.respondente_id).filter(Boolean)
    );
    const vinculos = (respondentes.dados || []).map((v) => ({
      ...v,
      respondeu: responderamIds.has(v.respondente_id),
    }));

    return json({
      projeto,
      respondentes: vinculos,
      pesquisas: pesquisas.dados || [],
      respostas: respostasVisiveis,
      lideranca: liderancas.dados || [],
      ciclos: participacoes.dados || [],
      transicoes: transicoes.dados || [],
      isc: iscs.dados || [],
      // Trilha de auditoria e exclusiva do PMO (ver /api/auditoria em lib/rotas.ts).
      auditoria: sessao.perfil === PERFIL_LIDER ? [] : auditoria.dados || [],
    });
  });
}
