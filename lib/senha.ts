// Hash, conferencia e impressao digital de senha.
//
// ── Por que scrypt e nao bcrypt ───────────────────────────────────────────
//
// O SGA usa bcryptjs. Aqui ficou scrypt, de proposito, por dois motivos:
//
//  1. As senhas ja gravadas no banco estao em `scrypt$sal$derivada`. Trocar o
//     algoritmo obrigaria ou a invalidar todas as senhas, ou a carregar dois
//     formatos para sempre — custo sem ganho.
//  2. scrypt e memory-hard; bcrypt nao. Trocar um pelo outro seria alinhar a
//     letra do SGA as custas da forca real do hash.
//
// O que MUDOU em relacao a api/_lib/auth.js foi o que de fato importava: era
// `scryptSync`, que trava o event loop por ~100ms a cada tentativa de login.
// Numa funcao serverless isso significa que nenhuma outra requisicao daquela
// instancia anda enquanto a senha e derivada — um login errado em rajada
// derruba a latencia do sistema inteiro. Aqui e a versao assincrona.
//
// Este modulo importa `node:crypto` e por isso NUNCA pode ser importado pelo
// middleware.ts, que roda em Edge Runtime. Para o JWT da sessao, que precisa
// funcionar em Edge, use lib/token.ts.

import crypto from "node:crypto";

const TAMANHO_SAL = 16;
const TAMANHO_DERIVADA = 64;

function derivar(senha: string, sal: Buffer, tamanho: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(senha, sal, tamanho, (e, derivada) => {
      if (e) reject(e);
      else resolve(derivada);
    });
  });
}

export async function gerarHash(senha: string): Promise<string> {
  const sal = crypto.randomBytes(TAMANHO_SAL);
  const derivada = await derivar(String(senha), sal, TAMANHO_DERIVADA);
  return `scrypt$${sal.toString("base64")}$${derivada.toString("base64")}`;
}

export async function conferirHash(senha: string, hash: string): Promise<boolean> {
  try {
    const [algoritmo, salB64, esperadoB64] = String(hash).split("$");
    if (algoritmo !== "scrypt" || !salB64 || !esperadoB64) return false;
    const esperado = Buffer.from(esperadoB64, "base64");
    const derivada = await derivar(String(senha), Buffer.from(salB64, "base64"), esperado.length);
    return crypto.timingSafeEqual(esperado, derivada);
  } catch {
    return false;
  }
}

/**
 * Comparacao de texto em tempo constante, para as senhas legadas que ainda
 * estao em texto plano no banco. Comparar com `===` vazaria o tamanho do
 * prefixo correto pelo tempo de resposta.
 */
export function iguaisSeguro(a: unknown, b: unknown): boolean {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ba.length !== bb.length) {
    // Compara consigo mesmo para gastar o mesmo tempo do caminho positivo.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Impressao digital da credencial vigente, gravada dentro do token de sessao.
 *
 * Existe para resolver um buraco que a versao anterior tinha: o token era
 * imutavel por 12 horas, entao trocar a senha do PMO — inclusive depois de um
 * vazamento — nao derrubava ninguem que ja estivesse dentro. Guardando este
 * resumo do hash no token e reconferindo a cada requisicao (lib/session.ts),
 * qualquer troca de senha invalida na hora todas as sessoes abertas com a
 * senha antiga.
 *
 * E um resumo do HASH, nunca da senha, e truncado: serve so para detectar
 * mudanca, nao para reconstruir nada.
 */
export function impressaoDaCredencial(hash: string | null | undefined): string {
  return crypto
    .createHash("sha256")
    .update(String(hash ?? ""))
    .digest("base64url")
    .slice(0, 16);
}
