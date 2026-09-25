// Gestao dos ciclos semestrais.

import {
  erro,
  json,
  lerCorpo,
  ordenacao,
  rotaApi,
  texto,
  textoObrigatorio,
  umDe,
  uuid,
} from "@/lib/http";
import { atualizar, auditar, inserir, rpc, selecionar, um } from "@/lib/db";
import { STATUS_CICLO } from "@/lib/listas";
import { exigirPmo, exigirSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ciclo {
  id: string;
  codigo: string;
  [chave: string]: unknown;
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Data ISO vinda da tela. Vazio vira `null` — limpar a janela e valido. */
function dataOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  const v = String(valor).trim();
  if (!RE_DATA.test(v) || Number.isNaN(Date.parse(v))) {
    throw erro(400, "DATA_INVALIDA", `Campo "${campo}" deve ser uma data valida.`);
  }
  return v;
}

/**
 * O corte entre os canais do ciclo.
 *
 * Uma data so: do inicio do ciclo ate ela, e-mail; do dia seguinte ate o fim
 * do ciclo, WhatsApp. Uma segunda data nao acrescentaria nada e poderia
 * discordar do proprio ciclo (ver a migration 18).
 */
function janelaDeCanal(corpo: Record<string, unknown>): Record<string, unknown> {
  if (!("canal_email_ate" in corpo)) return {};
  return { canal_email_ate: dataOpcional(corpo.canal_email_ate, "canal_email_ate") };
}

/**
 * O corte tem de cair dentro do ciclo. O banco tambem checa, mas a mensagem
 * de la cita o nome da constraint — esta aqui diz o que fazer.
 */
function conferirCorte(corte: unknown, inicio: unknown, fim: unknown): void {
  if (!corte) return;
  const d = String(corte);
  if (inicio && d < String(inicio)) {
    throw erro(
      400,
      "CORTE_FORA_DO_CICLO",
      "O ultimo dia de e-mail nao pode ser anterior ao inicio do ciclo."
    );
  }
  if (fim && d > String(fim)) {
    throw erro(
      400,
      "CORTE_FORA_DO_CICLO",
      "O ultimo dia de e-mail nao pode passar do fim do ciclo — o WhatsApp ficaria sem periodo."
    );
  }
}

export async function GET() {
  return rotaApi(async () => {
    await exigirSessao();

    // ── Por que uma consulta so, e nao duas por ciclo ──────────────────────
    //
    // A versao anterior rodava, para CADA ciclo, um count de projetos e outro
    // de elegiveis: 2N ida-e-volta ao banco numa tela que abre a cada visita
    // ao menu. Com os 6 ciclos ja cadastrados sao 13 requisicoes.
    //
    // Aqui sao 2, fixas: a lista de ciclos e uma leitura rasa de
    // projetos_nps (so ciclo_id e elegivel, so os ativos). A contagem sai em
    // memoria. O volume e pequeno por construcao — e uma linha por projeto
    // por ciclo — e nao cresce com o numero de ciclos.
    const [{ dados: ciclos }, { dados: participacoes }] = await Promise.all([
      selecionar<Ciclo[]>("ciclos_nps", {
        colunas: "*",
        ordem: { campo: "data_inicio", ascending: false },
      }),
      selecionar<{ ciclo_id: string | null; elegivel: boolean | null }[]>("projetos_nps", {
        colunas: "ciclo_id,elegivel",
        filtros: { ativo: true },
      }),
    ]);

    const totais = new Map<string, { total: number; elegiveis: number }>();
    for (const p of participacoes || []) {
      if (!p.ciclo_id) continue;
      const atual = totais.get(p.ciclo_id) || { total: 0, elegiveis: 0 };
      atual.total += 1;
      if (p.elegivel) atual.elegiveis += 1;
      totais.set(p.ciclo_id, atual);
    }

    const itens = (ciclos || []).map((c) => {
      const t = totais.get(c.id) || { total: 0, elegiveis: 0 };
      return { ...c, total_projetos: t.total, total_elegiveis: t.elegiveis };
    });

    return json({ itens });
  });
}

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);

    const codigo = textoObrigatorio(corpo.codigo, "codigo", 20);
    if (!/^\d{4}\.\d$/.test(codigo)) {
      throw erro(
        400,
        "CODIGO_INVALIDO",
        "O codigo do ciclo deve seguir o formato AAAA.S (ex: 2026.2)."
      );
    }
    if (await um("ciclos_nps", { codigo }, "id")) {
      throw erro(409, "CICLO_DUPLICADO", "Ja existe um ciclo com este codigo.");
    }

    // Datas padrao derivadas do codigo: semestre 1 = jan-jun, 2 = jul-dez.
    const [ano, semestre] = codigo.split(".");
    const inicio = `${ano}-${semestre === "1" ? "01" : "07"}-01`;
    const fim = semestre === "1" ? `${ano}-06-30` : `${ano}-12-31`;

    const janela = janelaDeCanal(corpo);
    const dataInicio = corpo.data_inicio || inicio;
    const dataFim = corpo.data_fim || fim;
    conferirCorte(janela.canal_email_ate, dataInicio, dataFim);

    const [criado] = await inserir<Ciclo[]>("ciclos_nps", {
      codigo,
      descricao: texto(corpo.descricao, "descricao", { max: 200 }) || `Ciclo ${codigo}`,
      status: umDe(corpo.status, STATUS_CICLO, "status") || "planejamento",
      data_inicio: dataInicio,
      data_fim: dataFim,
      ...janela,
    });

    await auditar({
      acao: "criar",
      entidade: "ciclo",
      registroId: criado.id,
      descricao: `Ciclo ${codigo} criado`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      depois: { codigo },
    });

    return json({ ciclo: criado }, 201);
  });
}

export async function PATCH(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);
    const id = uuid(corpo.id, "id");

    const antes = await um<Record<string, unknown>>("ciclos_nps", { id });
    if (!antes) throw erro(404, "CICLO_NAO_ENCONTRADO", "Ciclo nao encontrado.");

    // O `codigo` nao e editavel: ele e a identidade do ciclo e aparece em
    // respostas, pesquisas e no comparativo. Renomear reescreveria o passado.
    const campos: Record<string, unknown> = {};
    if ("descricao" in corpo) campos.descricao = texto(corpo.descricao, "descricao", { max: 200 });
    if ("data_inicio" in corpo) campos.data_inicio = corpo.data_inicio || null;
    if ("data_fim" in corpo) campos.data_fim = corpo.data_fim || null;

    const janela = janelaDeCanal(corpo);
    Object.assign(campos, janela);
    conferirCorte(
      "canal_email_ate" in janela ? janela.canal_email_ate : antes.canal_email_ate,
      "data_inicio" in campos ? campos.data_inicio : antes.data_inicio,
      "data_fim" in campos ? campos.data_fim : antes.data_fim
    );

    if (!Object.keys(campos).length) {
      throw erro(400, "NADA_A_ALTERAR", "Nenhum campo informado.");
    }

    const [depois] = await atualizar<Ciclo[]>("ciclos_nps", { id }, campos);

    // Mexeu numa janela: reclassifica o que ja foi respondido neste ciclo.
    //
    // As janelas quase sempre sao declaradas DEPOIS da coleta — o PMO so sabe
    // que "do dia 10 em diante foi WhatsApp" quando o periodo passou. Sem
    // isto, a data so valeria para respostas futuras, e o ciclo que ele esta
    // olhando na tela ficaria de fora.
    let aplicado: { email?: number; whatsapp?: number; fora_das_janelas?: number } | null = null;
    // Mudar as datas do ciclo move as bordas das janelas tanto quanto mudar o
    // corte — por isso as tres disparam a reclassificacao.
    if ("canal_email_ate" in campos || "data_inicio" in campos || "data_fim" in campos) {
      aplicado = await rpc("nps_aplicar_canais_do_ciclo", { p_ciclo_id: id });
    }

    await auditar({
      acao: "editar",
      entidade: "ciclo",
      registroId: id,
      descricao: aplicado
        ? `Ciclo ${antes.codigo}: janelas de canal aplicadas (${aplicado.email ?? 0} e-mail, ${aplicado.whatsapp ?? 0} WhatsApp)`
        : `Ciclo ${antes.codigo} editado`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      antes: Object.fromEntries(Object.keys(campos).map((k) => [k, antes[k]])),
      depois: campos,
    });

    return json({ ciclo: depois, canais: aplicado });
  });
}
