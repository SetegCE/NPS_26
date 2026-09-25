// Vinculo N:N entre respondente e projetos.

import { booleano, erro, json, lerCorpo, rotaApi, uuid } from "@/lib/http";
import { atualizar, auditar, inserir, selecionar, um } from "@/lib/db";
import { exigirPmo, exigirSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Projetos aos quais este respondente esta vinculado. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    await exigirSessao();
    const respondenteId = uuid(params.id, "id");

    const { dados } = await selecionar<{ projeto_id: string; ativo: boolean }[]>(
      "projeto_respondentes_nps",
      { colunas: "projeto_id,ativo", filtros: { respondente_id: respondenteId } }
    );

    return json({
      vinculos: (dados || []).filter((v) => v.ativo).map((v) => v.projeto_id),
    });
  });
}

/** Vincula ou desvincula o respondente de um projeto. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const respondenteId = uuid(params.id, "id");
    const corpo = await lerCorpo(req);

    const projetoId = uuid(corpo.projeto_id, "projeto_id");
    const querVincular = booleano(corpo.vincular, true);

    const projeto = await um<{ id: string; codigo_clockify: string }>(
      "projetos_mestre_nps",
      { id: projetoId },
      "id,codigo_clockify"
    );
    if (!projeto) throw erro(404, "PROJETO_NAO_ENCONTRADO", "Projeto nao encontrado.");

    const existente = await um<{ id: string; ativo: boolean }>("projeto_respondentes_nps", {
      projeto_id: projetoId,
      respondente_id: respondenteId,
    });

    if (querVincular) {
      if (existente) {
        if (!existente.ativo) {
          await atualizar("projeto_respondentes_nps", { id: existente.id }, { ativo: true });
        }
      } else {
        await inserir("projeto_respondentes_nps", {
          projeto_id: projetoId,
          respondente_id: respondenteId,
        });
      }
    } else {
      if (!existente) return json({ alterado: false, motivo: "VINCULO_INEXISTENTE" });
      // Nunca apaga: apenas desativa, preservando o historico de respostas que
      // aquela pessoa ja deu para aquele projeto.
      await atualizar("projeto_respondentes_nps", { id: existente.id }, { ativo: false });
    }

    await auditar({
      acao: querVincular ? "vincular_respondente" : "desvincular_respondente",
      entidade: "projeto",
      registroId: projetoId,
      descricao: `Respondente ${querVincular ? "vinculado ao" : "desvinculado do"} projeto ${projeto.codigo_clockify}`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      depois: { respondente_id: respondenteId },
    });

    return json({ alterado: true, vinculado: querVincular });
  });
}
