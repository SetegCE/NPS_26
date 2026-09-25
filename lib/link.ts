// Monta o link publico da pesquisa a partir do token.
//
// Sai dos cabecalhos da requisicao, e nao de uma variavel de ambiente, para
// que o link gerado em preview aponte para o proprio preview e o gerado em
// producao aponte para producao — sem ninguem lembrar de configurar nada.

/** Ex.: https://nps.setegce.com/pesquisa/AbC123... */
export function montarLinkDaPesquisa(req: Request, token: string): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  // Em producao a Vercel envia x-forwarded-proto. Sem ele, so o ambiente local
  // roda em http — em qualquer outro host o padrao seguro continua sendo https.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = req.headers.get("x-forwarded-proto") || (local ? "http" : "https");
  return `${proto}://${host}/pesquisa/${token}`;
}
