// Validadores de entrada e resposta padrao da API.
//
// Porte literal de api/_lib/http.js para TypeScript: as regras nao mudaram,
// so ganharam tipo. O que mudou foi a borda — em vez de `res.end(...)` do
// Node, quem responde e o NextResponse do App Router.

import { NextResponse } from "next/server";
import { ErroHttp, erro } from "@/lib/validacao";

// Os validadores sao reexportados para que as rotas continuem importando
// tudo de um lugar so.
export * from "@/lib/validacao";

export function json(corpo: unknown, status = 200): NextResponse {
  return NextResponse.json(corpo as object, { status });
}

/**
 * Envelope de toda rota de API.
 *
 * Existe para que nenhum route handler precise repetir o try/catch: o que era
 * o try/catch unico de `api/[...rota].js` virou esta funcao. Um ErroHttp
 * lancado em qualquer profundidade vira resposta com o status certo; qualquer
 * outra excecao vira 500 generico, com o detalhe no log do servidor e NUNCA
 * na resposta — mensagem de erro de banco costuma revelar nome de tabela,
 * coluna e ate trecho de consulta.
 */
export async function rotaApi(
  acao: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await acao();
  } catch (e) {
    if (e instanceof ErroHttp) {
      return json({ erro: e.codigo, mensagem: e.message }, e.status);
    }
    console.error("[NPS][API] Erro nao tratado:", e);
    return json(
      { erro: "ERRO_INTERNO", mensagem: "Erro inesperado no servidor. Tente novamente." },
      500
    );
  }
}

/** Le e valida o corpo JSON da requisicao. */
export async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  // 1 MB, como no servidor anterior. Corpo maior que isso nao e uso legitimo
  // de nenhuma tela deste sistema.
  const tamanho = Number(req.headers.get("content-length") || 0);
  if (tamanho > 1_000_000) {
    throw erro(413, "CORPO_MUITO_GRANDE", "Corpo da requisicao excede o limite.");
  }

  let bruto: string;
  try {
    bruto = await req.text();
  } catch {
    throw erro(400, "CORPO_ILEGIVEL", "Nao foi possivel ler o corpo da requisicao.");
  }

  if (bruto.length > 1_000_000) {
    throw erro(413, "CORPO_MUITO_GRANDE", "Corpo da requisicao excede o limite.");
  }
  if (!bruto) return {};

  try {
    const dados = JSON.parse(bruto);
    // `null`, numero ou array no lugar de objeto quebrariam todo acesso por
    // chave logo adiante. Rejeitar aqui da erro claro em vez de TypeError.
    if (dados === null || typeof dados !== "object" || Array.isArray(dados)) {
      throw new Error("nao e objeto");
    }
    return dados as Record<string, unknown>;
  } catch {
    throw erro(400, "JSON_INVALIDO", "Corpo da requisicao nao e um JSON valido.");
  }
}
