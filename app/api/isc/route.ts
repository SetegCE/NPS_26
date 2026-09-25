// ISC — Indice de Satisfacao do Cliente.
//
// Indicador INTERNO, registrado pelo lider: e a percepcao DELE sobre como o
// cliente esta. NUNCA compoe nem altera o NPS, que e a percepcao do proprio
// cliente. Os dois convivem na mesma tela e nao se somam em lugar nenhum.

import {
  competencia as validarCompetencia,
  erro,
  json,
  lerCorpo,
  nota,
  ordenacao,
  paginacao,
  rotaApi,
  texto,
  uuid,
  uuidOpcional,
} from "@/lib/http";
import { type FiltroValor, rpc, selecionar } from "@/lib/db";
import { exigirAcessoAoProjeto, exigirSessao, PERFIL_LIDER, PERFIL_PMO } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDENAVEIS = ["competencia", "nota", "lider_nome", "created_at"] as const;

function competenciaAtual(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

async function projetosDoLider(liderId: string | null): Promise<string[]> {
  if (!liderId) return [];
  const { dados } = await selecionar<{ id: string }[]>("projetos_mestre_nps", {
    colunas: "id",
    filtros: { lider_id: liderId, ativo: true },
  });
  return (dados || []).map((p) => p.id);
}

// ---------- Historico / consulta ----------

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const { pagina, porPagina, de, ate } = paginacao(query);
    const ordem = ordenacao(query, ORDENAVEIS, "competencia");
    const vazio = json({ itens: [], total: 0, pagina, porPagina });

    const filtros: Record<string, FiltroValor> = {};
    const comp = validarCompetencia(query.get("competencia"), "competencia");
    if (comp) filtros.competencia = comp;
    const projeto = uuidOpcional(query.get("projeto"), "projeto");
    if (projeto) filtros.projeto_id = projeto;

    if (sessao.perfil === PERFIL_LIDER) {
      const meus = await projetosDoLider(sessao.liderId);
      if (!meus.length) return vazio;
      const permitidos = projeto ? [projeto].filter((p) => meus.includes(p)) : meus;
      if (!permitidos.length) return vazio;
      filtros.projeto_id = permitidos;
    } else {
      const lider = uuidOpcional(query.get("lider"), "lider");
      if (lider) filtros.lider_id = lider;
    }

    const { dados, total } = await selecionar("isc_nps", {
      colunas: "*,projetos_mestre_nps(id,codigo_clockify,nome,cliente_id,clientes_nps(nome))",
      filtros,
      ordem,
      de,
      ate,
      contar: true,
    });

    return json({ itens: dados || [], total: total ?? 0, pagina, porPagina });
  });
}

// ---------- Registro mensal ----------

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const corpo = await lerCorpo(req);
    const projetoId = uuid(corpo.projeto_id, "projeto_id");

    // Autorizacao no servidor: lider so registra nos proprios projetos.
    await exigirAcessoAoProjeto(sessao, projetoId);

    const comp = validarCompetencia(corpo.competencia, "competencia") || competenciaAtual();

    if (comp > competenciaAtual()) {
      throw erro(
        400,
        "COMPETENCIA_FUTURA",
        "Nao e possivel registrar ISC de uma competencia futura."
      );
    }

    const resultado = await rpc("nps_registrar_isc", {
      p_projeto_id: projetoId,
      p_competencia: comp,
      p_nota: nota(corpo.nota, "nota", { obrigatorio: true }),
      p_observacao: texto(corpo.observacao, "observacao", { max: 2000 }),
      p_ator: sessao.nome,
      p_ator_tipo: sessao.perfil === PERFIL_PMO ? "pmo" : "lider",
      // Dupla verificacao dentro da propria funcao do banco: mesmo que a
      // checagem acima passe por engano, a funcao recusa.
      p_exigir_lider_id: sessao.perfil === PERFIL_LIDER ? sessao.liderId : null,
    });

    return json(resultado);
  });
}
