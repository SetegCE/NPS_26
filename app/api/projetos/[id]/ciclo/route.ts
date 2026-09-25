// Participacao do projeto num ciclo: entra, sai, e se e elegivel para a
// pesquisa semestral.

import { booleano, json, lerCorpo, rotaApi, uuid } from "@/lib/http";
import { rpc } from "@/lib/db";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const id = uuid(params.id, "id");
    const corpo = await lerCorpo(req);

    const resultado = await rpc("nps_definir_participacao_ciclo", {
      p_projeto_id: id,
      p_ciclo_id: uuid(corpo.ciclo_id, "ciclo_id"),
      p_participar: booleano(corpo.participar, true),
      p_elegivel: booleano(corpo.elegivel, true),
      p_ator: sessao.nome,
    });

    return json(resultado);
  });
}
