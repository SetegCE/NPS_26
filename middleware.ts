// Middleware do Next.js — o porteiro leve de autenticacao e autorizacao.
//
// Ele roda em Edge Runtime e NAO consulta o banco: so confere a assinatura do
// cookie de sessao. E a primeira barreira, nao a ultima. Cada pagina e cada
// rota de API repetem a checagem de verdade via lib/session.ts
// (exigirSessao / exigirPmo / exigirAcessoAoProjeto), que le o banco e sabe
// se a conta foi desativada ou se a senha mudou depois que o token foi
// emitido.
//
// Importa APENAS lib/token.ts e lib/rotas.ts, nunca lib/session.ts nem
// lib/senha.ts: aqueles puxariam consulta ao banco e `node:crypto` para
// dentro do bundle de Edge.

import { NextRequest, NextResponse } from "next/server";
import { ehPublica, ehSoPmo } from "@/lib/rotas";
import { COOKIE_SESSAO, PERFIL_PMO, verificarToken } from "@/lib/token";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (ehPublica(pathname)) {
    // `?sessao=invalida` significa que a pagina mandou para ca porque o BANCO
    // (que o middleware nao consulta) rejeitou o cookie. Sem este desvio, o
    // middleware veria a mesma assinatura como valida e devolveria a pessoa
    // para /dashboard — laco infinito entre as duas rotas.
    if (pathname === "/login" && !request.nextUrl.searchParams.has("sessao")) {
      const token = request.cookies.get(COOKIE_SESSAO);
      if (token && (await verificarToken(token.value))) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_SESSAO);
  const sessao = cookie ? await verificarToken(cookie.value) : null;

  if (!sessao) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { erro: "NAO_AUTENTICADO", mensagem: "Sessao expirada ou invalida. Entre novamente." },
        { status: 401 }
      );
    }
    // Cookie presente mas recusado (assinatura invalida, expirado, corrompido)
    // e diferente de nunca ter entrado: havia uma sessao, entao a tela de
    // login explica "sua sessao expirou" em vez de abrir em branco.
    return NextResponse.redirect(
      new URL(cookie ? "/login?sessao=invalida" : "/login", request.url)
    );
  }

  if (sessao.perfil !== PERFIL_PMO && ehSoPmo(pathname)) {
    return pathname.startsWith("/api/")
      ? NextResponse.json(
          { erro: "NAO_AUTORIZADO", mensagem: "Esta acao e exclusiva do PMO." },
          { status: 403 }
        )
      : NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Tudo passa pelo middleware, menos o que o navegador busca sozinho
  // (chunks do Next, fontes, imagens) — rodar o porteiro em cada .woff2 so
  // gastaria invocacao.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|imagens/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2)$).*)",
  ],
};
