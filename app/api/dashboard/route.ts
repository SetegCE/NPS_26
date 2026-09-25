// Alimenta o dashboard NPS.
//
// Duas coisas acontecem aqui que antes aconteciam no navegador:
//
//  1. O isolamento do lider. A API devolve apenas os projetos sob
//     responsabilidade de quem esta autenticado — o cliente nao escolhe o que
//     enxerga, e nem o token diz: `projetosVisiveis` consulta o banco.
//  2. O casamento resposta <-> projeto (lib/dashboard.ts). O navegador recebe
//     as linhas ja resolvidas, e o mapeamento legado com nomes de contato de
//     cliente nunca sai do servidor.

import { erro, json, rotaApi, texto } from "@/lib/http";
import { type FiltroValor, selecionar } from "@/lib/db";
import {
  comLiderAtual,
  processarRespostas,
  type ProjetoBruto,
  type RespostaBruta,
} from "@/lib/dashboard";
import { chaveDoEscopo, escopoDoLider, exigirSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Colunas necessarias para o casamento. Pedir `*` traria campos que o
// processamento nao usa e que so engordam a resposta do PostgREST.
const COLUNAS_PROJETO =
  "ciclo,ciclo_id,codigo_clockify,cliente,projeto,lider,classe_contratual,tipo_servico,segmento_cliente,elegivel,ativo,projeto_id";

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const escopo = await escopoDoLider(sessao);

    const query = new URL(req.url).searchParams;
    const fase = texto(query.get("fase"), "fase") || "projetos";

    // Lider sem nenhum projeto: devolve vazio em vez de expor tudo.
    if (escopo !== null && escopo.projetoIds.length === 0) {
      return json({ projetos: [], respostas: [], ciclos: [], respostasPorCiclo: {} });
    }

    // O banco recorta por projeto; o par projeto+ciclo termina o corte aqui.
    //
    // PostgREST nao filtra por tupla, entao `projeto_id in (...)` traz um
    // superconjunto: as respostas do projeto em TODOS os ciclos, inclusive os
    // que foram de outro lider. `doEscopo` e quem descarta essas — sem ele, o
    // recorte por periodo nao existiria de fato.
    const filtroEscopo: Record<string, FiltroValor> = {};
    if (escopo !== null) filtroEscopo.projeto_id = escopo.projetoIds;

    const doEscopo = (r: { projeto_id?: unknown; ciclo?: unknown }): boolean => {
      if (escopo === null) return true;
      // Resposta sem projeto nao tem como ser atribuida a um periodo. Some
      // para o lider, de proposito: na duvida, o corte fecha.
      if (!r.projeto_id) return false;
      return escopo.pares.has(chaveDoEscopo(r.projeto_id, r.ciclo));
    };

    // O universo de projetos e so quem esta ATIVO no ciclo. Quando o PMO
    // retira um projeto de um ciclo, nps_definir_participacao_ciclo nao
    // apaga a linha — marca ativo=false, de proposito, para nao perder o
    // historico. Sem este filtro, "retirar do ciclo" nao retirava nada da
    // tela: o projeto continuava contando no denominador do NPS.
    //
    // Vale so para projetos_nps. respostas_nps nao tem coluna ativo, e
    // resposta orfa de participacao ainda aparece, caindo no cliente/lider
    // gravados na propria resposta (ver processarRespostas).
    //
    // Para o lider o filtro e `lider_id`, e nao `projeto_id in (...)`: a
    // participacao no ciclo JA carrega de quem ela era, entao aqui o corte e
    // exato e nao precisa de peneira depois.
    const filtroProjetos: Record<string, FiltroValor> =
      escopo === null
        ? { ativo: true }
        : { lider_id: sessao.liderId, ativo: true };

    if (fase === "projetos") {
      const [{ dados: projetos }, { dados: ciclos }, { dados: ciclosDasRespostas }] =
        await Promise.all([
          selecionar<ProjetoBruto[]>("projetos_nps", {
            colunas: COLUNAS_PROJETO,
            filtros: filtroProjetos,
            ordem: { campo: "ciclo", ascending: false },
          }),
          selecionar("ciclos_nps", {
            colunas: "id,codigo,status,data_inicio,data_fim",
            ordem: { campo: "data_inicio", ascending: false },
          }),
          // So a coluna `ciclo`, no mesmo escopo do lider. E a informacao que
          // permite a tela abrir num ciclo que tenha dado — ver o comentario
          // em DashboardClient. Uma coluna de ~80 linhas nao pesa.
          selecionar<{ projeto_id: string | null; ciclo: string | null }[]>("respostas_nps", {
            colunas: "projeto_id,ciclo",
            filtros: filtroEscopo,
          }),
        ]);

      const respostasPorCiclo: Record<string, number> = {};
      for (const r of ciclosDasRespostas || []) {
        if (!r.ciclo || !doEscopo(r)) continue;
        respostasPorCiclo[r.ciclo] = (respostasPorCiclo[r.ciclo] || 0) + 1;
      }

      return json({
        projetos: comLiderAtual(projetos || []),
        ciclos: ciclos || [],
        respostasPorCiclo,
      });
    }

    if (fase === "respostas") {
      const ciclo = texto(query.get("ciclo"), "ciclo", { max: 20 });
      const cicloExcluir = texto(query.get("cicloExcluir"), "cicloExcluir", { max: 20 });

      const filtrosResposta: Record<string, FiltroValor> = { ...filtroEscopo };
      if (ciclo) filtrosResposta.ciclo = ciclo;

      // "Todos menos este ciclo" precisa incluir as respostas sem ciclo
      // definido, como fazia a consulta original do dashboard.
      const ou = cicloExcluir
        ? `ciclo.neq.${encodeURIComponent(cicloExcluir)},ciclo.is.null`
        : null;

      // Os projetos vem junto porque sao o outro lado do casamento. E uma
      // consulta a mais por chamada — e uma volta ao servidor a menos do que
      // mandar o navegador buscar e cruzar tudo de novo.
      const [{ dados: respostas }, { dados: projetos }] = await Promise.all([
        selecionar<RespostaBruta[]>("respostas_nps", {
          colunas: "*",
          filtros: filtrosResposta,
          ou,
          ordem: { campo: "timestamp", ascending: false },
        }),
        selecionar<ProjetoBruto[]>("projetos_nps", {
          colunas: COLUNAS_PROJETO,
          filtros: filtroProjetos,
        }),
      ]);

      return json({
        respostas: processarRespostas(
          (respostas || []).filter(doEscopo),
          comLiderAtual(projetos || [])
        ),
      });
    }

    throw erro(400, "FASE_INVALIDA", 'Parametro "fase" deve ser "projetos" ou "respostas".');
  });
}
