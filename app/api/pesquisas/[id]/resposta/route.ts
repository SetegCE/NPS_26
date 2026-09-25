// Resposta de uma pesquisa ja respondida (botao "Ver resposta" da lista).
//
// Mesma regra de acesso do link: lider so ve pesquisa dos proprios projetos.

import { erro, json, rotaApi, uuid } from "@/lib/http";
import { selecionar, um } from "@/lib/db";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Resposta {
  nota_q1: number | null;
  nota_q2: number | null;
  nota_q3: number | null;
  nota_q4: number | null;
  feedback: string | null;
  timestamp: string | null;
  canal_resposta: string | null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const id = uuid(params.id, "id");

    const pesquisa = await um<{ id: string; lider_id: string | null }>(
      "vw_pesquisas",
      { id },
      "id,lider_id"
    );
    if (!pesquisa) throw erro(404, "PESQUISA_NAO_ENCONTRADA", "Pesquisa nao encontrada.");
    if (sessao.perfil === PERFIL_LIDER && pesquisa.lider_id !== sessao.liderId) {
      throw erro(403, "NAO_AUTORIZADO", "Esta pesquisa nao pertence aos seus projetos.");
    }

    const { dados } = await selecionar<Resposta[]>("respostas_nps", {
      colunas: "nota_q1,nota_q2,nota_q3,nota_q4,feedback,timestamp,canal_resposta",
      filtros: { pesquisa_id: id },
      ordem: { campo: "timestamp", ascending: false },
      limite: 1,
    });
    const resposta = dados?.[0];
    if (!resposta) {
      throw erro(404, "RESPOSTA_NAO_ENCONTRADA", "Nenhuma resposta registrada para esta pesquisa.");
    }

    return json({ resposta });
  });
}
