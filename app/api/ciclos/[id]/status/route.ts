// Abre, planeja ou encerra um ciclo. A funcao do banco e quem garante as
// regras de transicao (nao ha dois ciclos abertos ao mesmo tempo, encerrar
// congela participacoes).

import { json, lerCorpo, rotaApi, umDe, uuid } from "@/lib/http";
import { rpc } from "@/lib/db";
import { STATUS_CICLO } from "@/lib/listas";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const id = uuid(params.id, "id");
    const corpo = await lerCorpo(req);

    const resultado = await rpc("nps_definir_status_ciclo", {
      p_ciclo_id: id,
      p_status: umDe(corpo.status, STATUS_CICLO, "status", { obrigatorio: true }),
      p_ator: sessao.nome,
    });

    return json(resultado);
  });
}
