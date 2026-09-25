// Mudanca de status da pesquisa (gerada -> enviada -> respondida/encerrada).

import { erro, json, lerCorpo, rotaApi, umDe, uuid } from "@/lib/http";
import { atualizar, auditar, um } from "@/lib/db";
import { exigirPmo } from "@/lib/session";
import { STATUS_PESQUISA } from "@/lib/listas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const id = uuid(params.id, "id");
    const corpo = await lerCorpo(req);

    const status = umDe(corpo.status, STATUS_PESQUISA, "status", { obrigatorio: true })!;

    const antes = await um<{ id: string; status: string; data_envio: string | null }>(
      "pesquisas_nps",
      { id },
      "id,status,data_envio"
    );
    if (!antes) throw erro(404, "PESQUISA_NAO_ENCONTRADA", "Pesquisa nao encontrada.");

    // Respondida e estado terminal: so pode ser encerrada. Sem isto, um clique
    // errado apagaria o fato de que o cliente ja respondeu.
    if (antes.status === "respondida" && status !== "encerrada") {
      throw erro(
        400,
        "PESQUISA_JA_RESPONDIDA",
        "Uma pesquisa respondida nao pode voltar de status."
      );
    }

    const campos: Record<string, unknown> = { status };
    if (status === "enviada" && !antes.data_envio) campos.data_envio = new Date().toISOString();
    if (status === "encerrada") campos.ativo = false;

    const [depois] = await atualizar<Record<string, unknown>[]>("pesquisas_nps", { id }, campos);
    const { token, ...semToken } = depois;

    await auditar({
      acao: "alterar_status",
      entidade: "pesquisa",
      registroId: id,
      descricao: `Status da pesquisa: ${antes.status} -> ${status}`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      antes: { status: antes.status },
      depois: { status },
    });

    return json({ pesquisa: semToken });
  });
}
