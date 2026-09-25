// Acoes do plano: criar, editar ou remover. PMO em qualquer plano; lider so
// nos projetos que lidera (conferido tambem dentro da funcao do banco, por
// p_exigir_lider_id).

import { booleano, erro, json, lerCorpo, rotaApi, texto, umDe, uuid, uuidOpcional } from "@/lib/http";
import { dataOpcional, valorOpcional } from "@/lib/validacao";
import { rpc } from "@/lib/db";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SITUACOES = ["no_prazo", "concluido", "atrasado"] as const;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const planoId = uuid(params.id, "id");
    const corpo = await lerCorpo(req);

    const ehLider = sessao.perfil === PERFIL_LIDER;
    if (ehLider && !sessao.liderId) {
      throw erro(403, "NAO_AUTORIZADO", "Sua conta nao esta vinculada a um lider.");
    }
    const ator = {
      p_ator: sessao.nome,
      p_ator_tipo: ehLider ? "lider" : "pmo",
      p_exigir_lider_id: ehLider ? sessao.liderId : null,
    };

    if (booleano(corpo.remover, false)) {
      const r = await rpc("nps_remover_acao_plano", {
        p_plano_id: planoId,
        p_item_id: uuid(corpo.item_id, "item_id"),
        ...ator,
      });
      return json(r);
    }

    const r = await rpc<{ id: string }>("nps_salvar_acao_plano", {
      p_plano_id: planoId,
      p_item_id: uuidOpcional(corpo.item_id, "item_id"),
      p_o_que: texto(corpo.o_que, "o_que", { obrigatorio: true, max: 1000 }),
      p_por_que: texto(corpo.por_que, "por_que", { max: 1000 }),
      p_onde: texto(corpo.onde, "onde", { max: 300 }),
      p_quem: texto(corpo.quem, "quem", { max: 300 }),
      p_quanto: valorOpcional(corpo.quanto, "quanto"),
      p_prazo: dataOpcional(corpo.prazo, "prazo"),
      p_situacao: umDe(corpo.situacao, SITUACOES, "situacao") || "no_prazo",
      p_observacao: texto(corpo.observacao, "observacao", { max: 2000 }),
      ...ator,
    });
    return json(r, corpo.item_id ? 200 : 201);
  });
}
