// Selecao dos projetos que participam do ciclo.

import { booleano, erro, json, lerCorpo, rotaApi, uuid } from "@/lib/http";
import { rpc, um } from "@/lib/db";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Universo COMPLETO de projetos, marcando quem ja participa do ciclo.
 *
 * Diferente de /api/ciclos/[id]/projetos, que lista apenas os do ciclo: aqui
 * vem tudo, para o PMO escolher — inclusive projetos que nunca entraram em
 * ciclo nenhum.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    await exigirPmo();
    const cicloId = uuid(params.id, "id");

    const ciclo = await um<{ id: string; status: string }>("ciclos_nps", { id: cicloId });
    if (!ciclo) throw erro(404, "CICLO_NAO_ENCONTRADO", "Ciclo nao encontrado.");

    const itens = await rpc("nps_participantes_do_ciclo", { p_ciclo_id: cicloId });

    return json({
      ciclo,
      itens: itens || [],
      editavel: ciclo.status !== "encerrado",
    });
  });
}

/** Grava a selecao inteira de uma vez, de forma atomica. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const cicloId = uuid(params.id, "id");
    const corpo = await lerCorpo(req);

    if (!Array.isArray(corpo.itens)) {
      throw erro(400, "ITENS_INVALIDOS", "Envie a lista de projetos.");
    }
    // Teto explicito: sem ele, um corpo com 100 mil linhas viraria uma
    // transacao gigante no banco.
    if (corpo.itens.length > 1000) {
      throw erro(400, "ITENS_EXCESSIVOS", "Envie no maximo 1000 projetos por vez.");
    }

    const itens = (corpo.itens as Record<string, unknown>[]).map((i, idx) => ({
      projeto_id: uuid(i.projeto_id, `itens[${idx}].projeto_id`),
      participar: booleano(i.participar, false),
      elegivel: booleano(i.elegivel, true),
    }));

    const resultado = await rpc("nps_definir_participantes_ciclo", {
      p_ciclo_id: cicloId,
      p_itens: itens,
      p_ator: sessao.nome,
    });

    return json(resultado);
  });
}
