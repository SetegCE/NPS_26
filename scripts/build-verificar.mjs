// Build de produção para CONFERIR o código, sem derrubar o `next dev`.
//
//   npm run build:verificar
//
// Por que existe: `next build` e `next dev` escrevem na mesma pasta `.next`.
// Rodar o build com o servidor de desenvolvimento ligado substitui os chunks
// que ele está servindo, e a página passa a responder 200 apontando para
// arquivos que não existem mais — o HTML carrega, todo CSS e JS dá 404, e a
// tela fica branca. O sintoma não acusa a causa, e já custou tempo aqui duas
// vezes.
//
// Este script manda o build para `.next-build` (ver distDir em
// next.config.js), então os dois convivem.
//
// O deploy continua usando `npm run build`, que grava em `.next` — é o que a
// Vercel espera.

import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: ".next-build" },
  // Sem isto o Windows não encontra o npx.cmd.
  shell: process.platform === "win32",
});

process.exit(r.status ?? 1);
