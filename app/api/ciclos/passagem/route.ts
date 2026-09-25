// Confirma a passagem de ciclo: grava, de uma vez e numa transacao so, o que
// acontece com cada projeto do ciclo de origem.

import { erro, json, lerCorpo, rotaApi, texto, umDe, uuid, uuidOpcional } from "@/lib/http";
import { rpc } from "@/lib/db";
import { DECISOES_PASSAGEM, MOTIVOS_PASSAGEM } from "@/lib/listas";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);

    const origem = uuidOpcional(corpo.ciclo_origem_id, "ciclo_origem_id");
    const destino = uuid(corpo.ciclo_destino_id, "ciclo_destino_id");

    if (!Array.isArray(corpo.decisoes) || !corpo.decisoes.length) {
      throw erro(400, "DECISOES_INVALIDAS", "Informe ao menos uma decisao.");
    }
    if (corpo.decisoes.length > 500) {
      throw erro(400, "DECISOES_EXCESSIVAS", "Envie no maximo 500 decisoes por vez.");
    }

    const decisoes = (corpo.decisoes as Record<string, unknown>[]).map((d, i) => {
      const decisao = umDe(d.decisao, DECISOES_PASSAGEM, `decisoes[${i}].decisao`, {
        obrigatorio: true,
      });
      const motivo = umDe(d.motivo, MOTIVOS_PASSAGEM, `decisoes[${i}].motivo`);
      const observacao = texto(d.observacao, `decisoes[${i}].observacao`, { max: 1000 });

      // "Outro" sem explicacao e um registro que ninguem consegue interpretar
      // seis meses depois, que e exatamente quando a passagem e consultada.
      if (motivo === "outro" && !observacao) {
        throw erro(
          400,
          "OBSERVACAO_OBRIGATORIA_PARA_OUTRO",
          'Informe a observacao quando o motivo for "Outro".'
        );
      }

      return {
        projeto_id: uuid(d.projeto_id, `decisoes[${i}].projeto_id`),
        decisao,
        motivo,
        observacao,
      };
    });

    const resultado = await rpc("nps_passagem_ciclo", {
      p_ciclo_origem_id: origem,
      p_ciclo_destino_id: destino,
      p_decisoes: decisoes,
      p_ator: sessao.nome,
    });

    return json(resultado);
  });
}
