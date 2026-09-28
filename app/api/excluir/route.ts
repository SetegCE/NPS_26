// Exclusao de registros pela direcao (PMO) — o botao "Excluir" de todas as
// telas passa por aqui.
//
// A regra (o que sai junto, o que impede) mora em nps_excluir — ver
// supabase/migrations/22_exclusao_pela_direcao.sql. Aqui fica so o que o banco
// nao sabe: quem esta pedindo. Ninguem exclui a propria conta.

import { erro, json, lerCorpo, rotaApi, umDe, uuid } from "@/lib/http";
import { rpc, selecionar } from "@/lib/db";
import { esquecerConta, exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENTIDADES_EXCLUIVEIS = [
  "resposta",
  "pesquisa",
  "plano",
  "isc",
  "respondente",
  "projeto",
  "ciclo",
  "lider",
  "cliente",
  "conta",
] as const;

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);

    const entidade = umDe(corpo.entidade, ENTIDADES_EXCLUIVEIS, "entidade", { obrigatorio: true })!;
    const id = uuid(corpo.id, "id");

    if (entidade === "conta" && id === sessao.usuarioId) {
      throw erro(400, "CONTA_PROPRIA", "Voce nao pode excluir a propria conta.");
    }

    // O lider sai com a conta de acesso dele: guarda quais eram para derrubar
    // o cache da sessao depois.
    const contasQueSaem =
      entidade === "conta"
        ? [id]
        : entidade === "lider"
          ? ((
              await selecionar<{ id: string }[]>("usuarios_nps", {
                colunas: "id",
                filtros: { lider_id: id, papel: "lider" },
              })
            ).dados || []).map((u) => u.id)
          : [];

    const resultado = await rpc<{ ok: boolean; descricao: string }>("nps_excluir", {
      p_entidade: entidade,
      p_id: id,
      p_ator: sessao.nome,
    });

    // Conta excluida nao pode seguir valendo pelo cache de 60s da sessao.
    contasQueSaem.forEach(esquecerConta);

    return json(resultado);
  });
}
