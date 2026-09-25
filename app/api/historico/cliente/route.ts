// Historico completo de um cliente: projetos, respostas, ciclos, ISC e
// respondentes vinculados.

import { erro, json, rotaApi, uuid, uuidOpcional } from "@/lib/http";
import { type FiltroValor, selecionar, um } from "@/lib/db";
import { resumirRespostas, type RespostaResumivel } from "@/lib/resumo";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;
    const clienteId = uuid(query.get("cliente"), "cliente");

    const cliente = await um("clientes_nps", { id: clienteId });
    if (!cliente) throw erro(404, "CLIENTE_NAO_ENCONTRADO", "Cliente nao encontrado.");

    const filtrosProjeto: Record<string, FiltroValor> = { cliente_id: clienteId };
    // O lider ve o historico do cliente, mas recortado aos projetos dele.
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return json({ cliente, projetos: [], respostas: [] });
      filtrosProjeto.lider_id = sessao.liderId;
    }

    const { dados: projetos } = await selecionar<{ id: string }[]>("vw_projetos_admin", {
      colunas: "*",
      filtros: filtrosProjeto,
      ordem: { campo: "nome", ascending: true },
    });
    const ids = (projetos || []).map((p) => p.id);
    if (!ids.length) {
      return json({ cliente, projetos: [], respostas: [], ciclos: [], isc: [] });
    }

    const filtrosResp: Record<string, FiltroValor> = { projeto_id: ids };
    const ciclo = uuidOpcional(query.get("ciclo"), "ciclo");
    if (ciclo) filtrosResp.ciclo_id = ciclo;

    const [
      { dados: respostas },
      { dados: participacoes },
      { dados: iscs },
      { dados: respondentes },
    ] = await Promise.all([
      selecionar<RespostaResumivel[]>("vw_respostas_enriquecidas", {
        colunas: "*",
        filtros: filtrosResp,
        ordem: { campo: "timestamp", ascending: false },
      }),
      selecionar("projetos_nps", {
        colunas: "id,ciclo,ciclo_id,elegivel,ativo,projeto,lider,projeto_id",
        filtros: { projeto_id: ids },
        ordem: { campo: "ciclo", ascending: false },
      }),
      selecionar("isc_nps", {
        colunas: "*",
        filtros: { projeto_id: ids },
        ordem: { campo: "competencia", ascending: false },
      }),
      selecionar("projeto_respondentes_nps", {
        colunas: "projeto_id,respondente_id,ativo,respondentes_nps(id,nome,email)",
        filtros: { projeto_id: ids },
      }),
    ]);

    return json({
      cliente,
      projetos: projetos || [],
      respostas: respostas || [],
      ciclos: participacoes || [],
      isc: iscs || [],
      respondentes: respondentes || [],
      resumo: resumirRespostas(respostas || []),
    });
  });
}
