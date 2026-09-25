// Prepara a passagem de ciclo: lista os projetos do ciclo de origem com a
// decisao ja registrada (se houver), para o PMO revisar antes de confirmar.
//
// Rota estatica sob /api/ciclos — o Next resolve `preparar` antes de `[id]`,
// entao nao ha ambiguidade com /api/ciclos/<uuid>/...

import { json, rotaApi, uuid } from "@/lib/http";
import { selecionar } from "@/lib/db";
import { DECISOES_PASSAGEM, MOTIVOS_PASSAGEM } from "@/lib/listas";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LinhaOperacao {
  projeto_id: string;
  [chave: string]: unknown;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    await exigirPmo();
    const query = new URL(req.url).searchParams;

    const origem = uuid(query.get("origem"), "origem");
    const destino = uuid(query.get("destino"), "destino");

    const [{ dados: projetos }, { dados: decisoes }] = await Promise.all([
      selecionar<LinhaOperacao[]>("vw_operacao_ciclo", {
        colunas: "*",
        filtros: { ciclo_id: origem, projeto_ativo: true },
        ordem: { campo: "projeto_nome", ascending: true },
      }),
      selecionar<{ projeto_id: string }[]>("ciclo_transicao_nps", {
        colunas: "*",
        filtros: { ciclo_destino_id: destino },
      }),
    ]);

    const porProjeto = new Map((decisoes || []).map((d) => [d.projeto_id, d]));
    const itens = (projetos || []).map((p) => ({
      ...p,
      decisao: porProjeto.get(p.projeto_id) || null,
    }));

    return json({ itens, motivos: MOTIVOS_PASSAGEM, decisoes: DECISOES_PASSAGEM });
  });
}
