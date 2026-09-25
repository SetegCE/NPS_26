import { NextResponse } from "next/server";
import { COOKIE_SESSAO } from "@/lib/token";

export const dynamic = "force-dynamic";

/**
 * Encerra a sessao apagando o cookie.
 *
 * E POST, e nao GET, de proposito: um GET de logout pode ser disparado por um
 * `<img src="/api/auth/logout">` em qualquer pagina que a pessoa visite, e
 * derrubar a sessao dela sem que ela peca.
 *
 * Nao exige sessao valida — sair deve funcionar inclusive quando o cookie ja
 * esta expirado ou corrompido, que e justamente quando a pessoa quer limpar o
 * estado e entrar de novo.
 */
export async function POST() {
  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set(COOKIE_SESSAO, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return resposta;
}
