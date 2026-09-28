// Entrega o link da pesquisa sob demanda ("Copiar link").
//
// Existe separado da listagem justamente para que o token nao viaje em toda
// consulta: quem tem o token responde a pesquisa no lugar do cliente.
//
// Um link por pessoa no ciclo (migration 23): se a pessoa responde por mais
// de um projeto, todos devolvem o MESMO link (nps_token_do_link), e uma
// resposta vale para todos eles.

import { erro, json, rotaApi, uuid } from "@/lib/http";
import { rpc, um } from "@/lib/db";
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

    const token = (await rpc<string | null>("nps_token_do_link", { p_pesquisa_id: id })) || pesquisa.token;
    return json({ link: montarLinkDaPesquisa(req, token) });
  });
}
