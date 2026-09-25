// Entrega o link da pesquisa sob demanda ("Copiar link").
//
// Existe separado da listagem justamente para que o token nao viaje em toda
// consulta: quem tem o token responde a pesquisa no lugar do cliente.

import { erro, json, rotaApi, uuid } from "@/lib/http";
import { um } from "@/lib/db";
import { montarLinkDaPesquisa } from "@/lib/link";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const id = uuid(params.id, "id");

    const pesquisa = await um<{
      id: string;
      token: string;
      lider_id: string | null;
      ativo: boolean;
    }>("vw_pesquisas", { id }, "id,token,lider_id,ativo");

    if (!pesquisa) throw erro(404, "PESQUISA_NAO_ENCONTRADA", "Pesquisa nao encontrada.");

    if (sessao.perfil === PERFIL_LIDER && pesquisa.lider_id !== sessao.liderId) {
      throw erro(403, "NAO_AUTORIZADO", "Esta pesquisa nao pertence aos seus projetos.");
    }
    if (!pesquisa.ativo) throw erro(400, "PESQUISA_ENCERRADA", "Esta pesquisa foi encerrada.");

    return json({ link: montarLinkDaPesquisa(req, pesquisa.token) });
  });
}
