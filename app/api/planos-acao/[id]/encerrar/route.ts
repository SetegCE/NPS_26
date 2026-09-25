// Encerra (data de hoje) ou reabre um plano de acao. So o PMO.

import { json, lerCorpo, rotaApi, booleano, uuid } from "@/lib/http";
import { rpc } from "@/lib/db";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);
    const r = await rpc("nps_encerrar_plano_acao", {
      p_plano_id: uuid(params.id, "id"),
      p_encerrar: booleano(corpo.encerrar, true),
      p_ator: sessao.nome,
    });
    return json(r);
  });
}
