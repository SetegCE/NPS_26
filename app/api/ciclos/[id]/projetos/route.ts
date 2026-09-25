// Projetos que participam de um ciclo, com a situacao operacional de cada um.

import { json, rotaApi, uuid } from "@/lib/http";
import { selecionar } from "@/lib/db";
import { exigirSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    await exigirSessao();
    const id = uuid(params.id, "id");

    const { dados } = await selecionar("vw_operacao_ciclo", {
      colunas: "*",
      filtros: { ciclo_id: id },
      ordem: { campo: "projeto_nome", ascending: true },
    });

    return json({ itens: dados || [] });
  });
}
