// Painel do ISC: o que ja foi avaliado e o que falta na competencia.

import { competencia as validarCompetencia, json, rotaApi, uuidOpcional } from "@/lib/http";
import { type FiltroValor, selecionar } from "@/lib/db";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Projeto {
  id: string;
  [chave: string]: unknown;
}

interface RegistroIsc {
  projeto_id: string;
  [chave: string]: unknown;
}

function competenciaAtual(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const comp = validarCompetencia(query.get("competencia"), "competencia") || competenciaAtual();

    const filtros: Record<string, FiltroValor> = { ativo: true };
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return json({ competencia: comp, avaliados: [], pendentes: [] });
      filtros.lider_id = sessao.liderId;
    } else {
      const lider = uuidOpcional(query.get("lider"), "lider");
      if (lider) filtros.lider_id = lider;
      const cliente = uuidOpcional(query.get("cliente"), "cliente");
      if (cliente) filtros.cliente_id = cliente;
    }

    const { dados: projetos } = await selecionar<Projeto[]>("vw_projetos_admin", {
      colunas: "*",
      filtros,
    });
    const ids = (projetos || []).map((p) => p.id);
    if (!ids.length) return json({ competencia: comp, avaliados: [], pendentes: [] });

    const { dados: registros } = await selecionar<RegistroIsc[]>("isc_nps", {
      colunas: "*",
      filtros: { projeto_id: ids, competencia: comp },
    });
    const porProjeto = new Map((registros || []).map((r) => [r.projeto_id, r]));

    const avaliados: { projeto: Projeto; isc: RegistroIsc | null }[] = [];
    const naoAvaliados: { projeto: Projeto; isc: RegistroIsc | null }[] = [];
    for (const p of projetos || []) {
      const registro = porProjeto.get(p.id) || null;
      (registro ? avaliados : naoAvaliados).push({ projeto: p, isc: registro });
    }

    const total = (projetos || []).length;

    return json({
      competencia: comp,
      avaliados,
      pendentes: naoAvaliados,
      total,
      percentual_avaliado: total ? Math.round((avaliados.length / total) * 100) : 0,
    });
  });
}
