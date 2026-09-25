// Faz o Node entender duas convencoes do TypeScript que o bundler do Next
// resolve sozinho e o Node nao:
//
//  1. o atalho `@/...`, que e o alias declarado no tsconfig;
//  2. import sem extensao (`@/lib/dashboard` em vez de `.../dashboard.ts`).
//
// Sem isto, rodar os testes contra os arquivos .ts falharia em
// ERR_MODULE_NOT_FOUND na primeira importacao interna de lib/.
//
// Registrado por `node --import ./tests/alias.mjs` (ver o script `test` no
// package.json). Existe so para o teste: nada em producao passa por aqui.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

const RAIZ = pathToFileURL(`${import.meta.dirname}/../`).href;

const resolvedor = `
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ = ${JSON.stringify(RAIZ)};

/** Acrescenta .ts/.tsx quando o caminho nao tem extensao e o arquivo existe. */
function comExtensao(url) {
  if (/\\.[a-zA-Z]+$/.test(url.pathname)) return url.href;
  for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
    const tentativa = new URL(url.href + ext);
    if (existsSync(fileURLToPath(tentativa))) return tentativa.href;
  }
  return url.href;
}

export async function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith("@/")) {
    return proximo(comExtensao(new URL(especificador.slice(2), RAIZ)), contexto);
  }
  if (especificador.startsWith(".") && contexto.parentURL) {
    return proximo(comExtensao(new URL(especificador, contexto.parentURL)), contexto);
  }
  return proximo(especificador, contexto);
}
`;

register(`data:text/javascript,${encodeURIComponent(resolvedor)}`, import.meta.url);
