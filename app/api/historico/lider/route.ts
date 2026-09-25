// Historico por lider.
//
// A regra que da sentido a esta tela: as respostas permanecem associadas ao
// periodo em que aquele lider era responsavel. Nada e reatribuido
// retroativamente — trocar o lider de um projeto nao transfere para ele o NPS
// que o anterior colheu, nem tira do anterior o que ele colheu.

import { erro, json, rotaApi, uuidOpcional } from "@/lib/http";
import { selecionar, um } from "@/lib/db";
import { resumirRespostas, type RespostaResumivel } from "@/lib/resumo";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Periodo {
  projeto_id: string;
  iniciado_em: string;
  encerrado_em: string | null;
}

interface RespostaComData extends RespostaResumivel {
  projeto_id?: string | null;
  timestamp?: string | null;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    let liderId = uuidOpcional(query.get("lider"), "lider");
    // O lider so consulta a si proprio, independente do que peca na query.
    if (sessao.perfil === PERFIL_LIDER) liderId = sessao.liderId;
    if (!liderId) throw erro(400, "LIDER_OBRIGATORIO", "Informe o lider.");

    const lider = await um("lideres_nps", { id: liderId });
    if (!lider) throw erro(404, "LIDER_NAO_ENCONTRADO", "Lider nao encontrado.");

    // Todos os periodos em que este lider foi responsavel por algum projeto.
    const { dados: periodos } = await selecionar<Periodo[]>("projeto_lideranca_hist_nps", {
      colunas: "*,projetos_mestre_nps(id,codigo_clockify,nome,cliente_id,clientes_nps(nome))",
      filtros: { lider_id: liderId },
      ordem: { campo: "iniciado_em", ascending: false },
    });

    const idsProjetos = [...new Set((periodos || []).map((p) => p.projeto_id))];
    if (!idsProjetos.length) {
      return json({ lider, periodos: [], respostas: [], resumo: resumirRespostas([]) });
    }

    const [{ dados: todas }, { dados: iscs }] = await Promise.all([
      selecionar<RespostaComData[]>("vw_respostas_enriquecidas", {
        colunas: "*",
        filtros: { projeto_id: idsProjetos },
        ordem: { campo: "timestamp", ascending: false },
      }),
      selecionar("isc_nps", {
        colunas: "*",
        filtros: { lider_id: liderId },
        ordem: { campo: "competencia", ascending: false },
      }),
    ]);

    // Janelas [inicio, fim) de responsabilidade. `fim` aberto (Infinity) e o
    // periodo vigente.
    const janelas = (periodos || []).map((p) => ({
      projeto_id: p.projeto_id,
      inicio: new Date(p.iniciado_em).getTime(),
      fim: p.encerrado_em ? new Date(p.encerrado_em).getTime() : Infinity,
    }));

    const doPeriodo = (todas || []).filter((r) => {
      if (!r.timestamp) return false;
      const t = new Date(r.timestamp).getTime();
      return janelas.some((j) => j.projeto_id === r.projeto_id && t >= j.inicio && t < j.fim);
    });

    return json({
      lider,
      periodos: periodos || [],
      respostas: doPeriodo,
      // Quantas respostas dos MESMOS projetos caem fora das janelas deste
      // lider. E o numero que explica a diferenca quando alguem compara esta
      // tela com o total do projeto.
      respostas_fora_do_periodo: (todas || []).length - doPeriodo.length,
      isc: iscs || [],
      resumo: resumirRespostas(doPeriodo),
      aviso: "Somente respostas registradas durante os periodos de responsabilidade deste lider.",
    });
  });
}
