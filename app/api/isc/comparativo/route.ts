// Comparacao ISC x NPS, projeto a projeto.
//
// As duas metricas aparecem lado a lado e NUNCA combinadas: ISC e o que o
// LIDER acha que o cliente sente; NPS e o que o CLIENTE respondeu. Somar ou
// mediar as duas produziria um numero que nao significa nada.

import { json, rotaApi, uuidOpcional } from "@/lib/http";
import { type FiltroValor, selecionar, termoBusca } from "@/lib/db";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Projeto {
  id: string;
  nome: string;
  codigo_clockify: string;
  cliente_nome: string | null;
  lider_nome: string | null;
  nps_projeto: number | string | null;
}

interface RegistroIsc {
  projeto_id: string;
  competencia: string;
  nota: number | string;
  [chave: string]: unknown;
}

interface RespostaCliente {
  projeto_id: string;
  [chave: string]: unknown;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const filtros: Record<string, FiltroValor> = { ativo: true };
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return json({ itens: [] });
      filtros.lider_id = sessao.liderId;
    } else {
      const lider = uuidOpcional(query.get("lider"), "lider");
      if (lider) filtros.lider_id = lider;
      const cliente = uuidOpcional(query.get("cliente"), "cliente");
      if (cliente) filtros.cliente_id = cliente;
    }

    const busca = termoBusca(query.get("busca"));
    const ou = busca ? `nome.ilike.${busca},cliente_nome.ilike.${busca}` : null;

    const { dados: projetos } = await selecionar<Projeto[]>("vw_projetos_admin", {
      colunas: "*",
      filtros,
      ou,
      ordem: { campo: "nome", ascending: true },
    });
    const ids = (projetos || []).map((p) => p.id);
    if (!ids.length) return json({ itens: [] });

    const [{ dados: historicoIsc }, { dados: respostas }] = await Promise.all([
      selecionar<RegistroIsc[]>("isc_nps", {
        colunas: "projeto_id,competencia,nota,observacao,lider_nome",
        filtros: { projeto_id: ids },
        ordem: { campo: "competencia", ascending: false },
      }),
      selecionar<RespostaCliente[]>("vw_respostas_enriquecidas", {
        colunas: "projeto_id,nota_q4,categoria,timestamp,respondente_nome,feedback",
        filtros: { projeto_id: ids },
        ordem: { campo: "timestamp", ascending: false },
      }),
    ]);

    const iscPorProjeto = new Map<string, RegistroIsc[]>();
    for (const i of historicoIsc || []) {
      const lista = iscPorProjeto.get(i.projeto_id);
      if (lista) lista.push(i);
      else iscPorProjeto.set(i.projeto_id, [i]);
    }

    const respPorProjeto = new Map<string, RespostaCliente[]>();
    for (const r of respostas || []) {
      const lista = respPorProjeto.get(r.projeto_id);
      if (lista) lista.push(r);
      else respPorProjeto.set(r.projeto_id, [r]);
    }

    const itens = (projetos || []).map((p) => {
      const historico = iscPorProjeto.get(p.id) || [];
      const avaliacoes = respPorProjeto.get(p.id) || [];
      return {
        projeto: {
          id: p.id,
          nome: p.nome,
          codigo_clockify: p.codigo_clockify,
          cliente_nome: p.cliente_nome,
          lider_nome: p.lider_nome,
        },
        // ISC: percepcao INTERNA do lider
        isc_atual: historico.length ? Number(historico[0].nota) : null,
        isc_competencia: historico.length ? historico[0].competencia : null,
        isc_historico: historico,
        // NPS: percepcao do CLIENTE — metrica distinta, nunca combinada
        nps_projeto: p.nps_projeto === null ? null : Number(p.nps_projeto),
        respostas_cliente: avaliacoes,
        total_respostas: avaliacoes.length,
      };
    });

    return json({
      itens,
      aviso: "ISC e NPS sao indicadores distintos e nao se combinam.",
    });
  });
}
