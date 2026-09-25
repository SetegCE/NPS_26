// Um plano de acao: cabecalho e acoes (com a situacao efetiva — prazo vencido
// e nao concluida aparece como atrasada).

import { erro, json, rotaApi, uuid } from "@/lib/http";
import { selecionar, um } from "@/lib/db";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const id = uuid(params.id, "id");

    const plano = await um<Record<string, unknown> & { lider_id: string | null }>("vw_planos_acao", { id });
    if (!plano) throw erro(404, "PLANO_NAO_ENCONTRADO", "Plano de acao nao encontrado.");
    if (sessao.perfil === PERFIL_LIDER && plano.lider_id !== sessao.liderId) {
      throw erro(403, "NAO_AUTORIZADO", "Este plano nao pertence aos seus projetos.");
    }

    const { dados: acoes } = await selecionar("vw_plano_acao_itens", {
      colunas: "*",
      filtros: { plano_id: id },
      ordem: { campo: "ordem", ascending: true },
    });

    return json({ plano, acoes: acoes || [] });
  });
}
