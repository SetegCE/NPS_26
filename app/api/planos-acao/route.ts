// Planos de acao: lista (com os projetos que aguardam a decisao do PMO) e a
// decisao "passivel de plano de acao? Sim/Nao".
//
// Ler: PMO ve tudo; lider ve os planos dos projetos que lidera hoje (quem
// executa as acoes e o lider atual). Decidir: so o PMO.
// A regra de negocio (elegivel, ja tem resposta, numero do plano) mora em
// nps_definir_plano_acao — ver supabase/migrations/20_plano_de_acao.sql.

import { booleano, erro, json, lerCorpo, rotaApi, texto, umDe, uuid, uuidOpcional } from "@/lib/http";
import { type FiltroValor, rpc, selecionar } from "@/lib/db";
import { exigirPmo, exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SITUACOES = [
  "aguardando_acoes",
  "em_andamento",
  "com_atraso",
  "concluido",
  "encerrado",
  "sem_plano",
] as const;

interface Participacao {
  projeto_id: string;
  ciclo_id: string;
  ciclo: string;
  codigo_clockify: string;
  projeto_nome: string;
  cliente_nome: string | null;
  lider_ciclo: string | null;
  respostas: number;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const filtros: Record<string, FiltroValor> = {};
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return json({ itens: [], pendentes: [] });
      filtros.lider_id = sessao.liderId;
    }
    const ciclo = uuidOpcional(query.get("ciclo"), "ciclo");
    if (ciclo) filtros.ciclo_id = ciclo;
    const situacao = umDe(query.get("situacao"), SITUACOES, "situacao");
    if (situacao) filtros.situacao = situacao;

    const { dados: planos } = await selecionar<Record<string, unknown>[]>("vw_planos_acao", {
      colunas: "*",
      filtros,
      ordem: { campo: "created_at", ascending: false },
    });

    // Pendentes (so para o PMO): projeto elegivel, com resposta no ciclo, e
    // ainda sem decisao. E a pergunta "e passivel de plano de acao?" em aberto.
    let pendentes: Participacao[] = [];
    if (sessao.perfil !== PERFIL_LIDER && !situacao) {
      const { dados: participacoes } = await selecionar<Participacao[]>("vw_operacao_ciclo", {
        colunas: "projeto_id,ciclo_id,ciclo,codigo_clockify,projeto_nome,cliente_nome,lider_ciclo,respostas",
        filtros: {
          elegivel: true,
          respostas: { op: "gt", valor: 0 },
          ...(ciclo ? { ciclo_id: ciclo } : {}),
        },
        ordem: { campo: "projeto_nome", ascending: true },
      });
      const decididos = new Set(
        (planos || []).map((p) => `${p.projeto_id}|${p.ciclo_id}`)
      );
      // Sem filtro de situacao a lista de planos ja traz todas as decisoes do
      // ciclo; com filtro de ciclo tambem. So falta excluir as decididas.
      pendentes = (participacoes || []).filter(
        (p) => !decididos.has(`${p.projeto_id}|${p.ciclo_id}`)
      );
    }

    return json({ itens: planos || [], pendentes });
  });
}

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);

    const passivel = booleano(corpo.passivel, null);
    if (passivel === null) throw erro(400, "PASSIVEL_OBRIGATORIO", "Informe se o projeto e passivel de plano de acao.");

    const resultado = await rpc<{ id: string; numero: string | null; passivel: boolean }>(
      "nps_definir_plano_acao",
      {
        p_projeto_id: uuid(corpo.projeto_id, "projeto_id"),
        p_ciclo_id: uuid(corpo.ciclo_id, "ciclo_id"),
        p_passivel: passivel,
        p_assunto: passivel ? texto(corpo.assunto, "assunto", { obrigatorio: true, max: 200 }) : null,
        p_objetivo: passivel ? texto(corpo.objetivo, "objetivo", { obrigatorio: true, max: 4000 }) : null,
        p_ator: sessao.nome,
      }
    );
    return json(resultado, 201);
  });
}
