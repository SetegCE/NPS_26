// Formulario publico da pesquisa.
//
// Regras de seguranca desta rota, que e a unica alcancavel sem sessao:
//  - o unico dado aceito do respondente sao as notas e o feedback;
//  - projeto, cliente, lider, ciclo, tipo e identificacao vem SEMPRE do token;
//  - um token da acesso exclusivamente a propria pesquisa;
//  - o token nunca e devolvido ao navegador, apenas consumido.

import { erro, json, lerCorpo, nota, rotaApi, texto } from "@/lib/http";
import { rpc, um } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// O token e gerado pelo banco com 32 bytes em base64url. A faixa larga
// acomoda tokens antigos sem abrir a porta para qualquer string.
const RE_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

function validarToken(valor: unknown): string {
  const t = String(valor ?? "").trim();
  if (!RE_TOKEN.test(t)) {
    // 404, e nao 400: um formato invalido e indistinguivel de um link que
    // nunca existiu, e nao ha motivo para informar a diferenca a quem tenta.
    throw erro(404, "PESQUISA_NAO_ENCONTRADA", "Link de pesquisa invalido ou expirado.");
  }
  return t;
}

interface Pesquisa {
  ativo: boolean;
  status: string;
  data_resposta: string | null;
  respondente_nome: string | null;
  cliente_nome: string | null;
  projeto_nome: string | null;
  codigo_clockify: string | null;
  lider_nome: string | null;
  tipo: string | null;
  ciclo_codigo: string | null;
}

/** Carrega o contexto da pesquisa para preencher o formulario. */
export async function GET(req: Request) {
  return rotaApi(async () => {
    const query = new URL(req.url).searchParams;
    const token = validarToken(query.get("token"));

    const pesquisa = await um<Pesquisa>("vw_pesquisas", { token });

    if (!pesquisa) {
      throw erro(404, "PESQUISA_NAO_ENCONTRADA", "Link de pesquisa invalido ou expirado.");
    }
    if (!pesquisa.ativo) {
      throw erro(410, "PESQUISA_ENCERRADA", "Esta pesquisa foi encerrada.");
    }
    if (pesquisa.status === "respondida") {
      return json({
        ja_respondida: true,
        respondente: pesquisa.respondente_nome,
        data_resposta: pesquisa.data_resposta,
      });
    }

    // Devolve apenas o que o formulario precisa exibir. Sem ids internos,
    // sem token.
    return json({
      ja_respondida: false,
      respondente: pesquisa.respondente_nome,
      cliente: pesquisa.cliente_nome,
      projeto: pesquisa.projeto_nome,
      codigo_projeto: pesquisa.codigo_clockify,
      lider: pesquisa.lider_nome,
      tipo: pesquisa.tipo,
      ciclo: pesquisa.ciclo_codigo,
    });
  });
}

/** Grava a resposta. Todo o vinculo vem do token — o respondente nao escolhe
 *  projeto, ciclo nem a propria identidade. */
export async function POST(req: Request) {
  return rotaApi(async () => {
    const corpo = await lerCorpo(req);
    const query = new URL(req.url).searchParams;
    const token = validarToken(corpo.token || query.get("token"));

    const resultado = await rpc<{ ok?: boolean }>("nps_responder_pesquisa", {
      p_token: token,
      p_q1: nota(corpo.nota_q1, "nota_q1", { obrigatorio: true }),
      p_q2: nota(corpo.nota_q2, "nota_q2", { obrigatorio: true }),
      p_q3: nota(corpo.nota_q3, "nota_q3", { obrigatorio: true }),
      p_q4: nota(corpo.nota_q4, "nota_q4", { obrigatorio: true }),
      p_feedback: texto(corpo.feedback, "feedback", { max: 4000 }),
    });

    return json({ ok: true, registrada: Boolean(resultado?.ok) }, 201);
  });
}
