// Troca do lider responsavel pelo projeto.
//
// E um endpoint proprio, e nao um campo do PATCH do projeto, porque a troca
// precisa abrir e fechar periodo em projeto_lideranca_hist_nps — e desse
// historico que sai o "quem era responsavel quando esta resposta chegou". A
// funcao do banco faz as duas coisas numa transacao so.
//
// O lider tambem vem do Clockrview, mas continua editavel aqui: a lideranca
// muda na pratica antes de o Clockrview ser atualizado. A sincronizacao nao
// desfaz esta troca — ela so mexe no lider quando o proprio Clockrview muda
// (ver lider_clockrview em lib/sincronizarProjetos.ts).

import { json, lerCorpo, rotaApi, texto, uuid } from "@/lib/http";
import { rpc } from "@/lib/db";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const id = uuid(params.id, "id");
    const corpo = await lerCorpo(req);

    const resultado = await rpc("nps_alterar_lider", {
      p_projeto_id: id,
      p_lider_id: uuid(corpo.lider_id, "lider_id"),
      p_ator: sessao.nome,
      p_observacao: texto(corpo.observacao, "observacao", { max: 1000 }),
    });

    return json(resultado);
  });
}
