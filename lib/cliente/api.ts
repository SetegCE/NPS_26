"use client";

// Cliente da API usado pelas telas.
//
// ── O que sumiu em relacao a versao anterior ──────────────────────────────
//
// O objeto `sessao` com token, perfil e nome no localStorage. Nao existe
// mais: a sessao viaja num cookie httpOnly que o navegador anexa sozinho, e
// que o JavaScript da pagina nao consegue ler. Quem precisa saber o perfil do
// usuario recebe isso do servidor, por props, ja validado no banco
// (lib/session.ts) — nao de um valor que qualquer um edita no DevTools.
//
// Por isso tambem nao ha mais `Authorization: Bearer`: nada para anexar.

export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly corpo: unknown;

  constructor(status: number, codigo: string, mensagem: string, corpo?: unknown) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.corpo = corpo;
  }
}

export type Params = Record<string, string | number | boolean | null | undefined>;

interface Opcoes {
  metodo?: string;
  corpo?: unknown;
  params?: Params;
  sinal?: AbortSignal;
}

async function requisitar<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const url = new URL(`/api/${caminho}`, window.location.origin);
  if (opcoes.params) {
    for (const [chave, valor] of Object.entries(opcoes.params)) {
      if (valor !== undefined && valor !== null && valor !== "") {
        url.searchParams.set(chave, String(valor));
      }
    }
  }

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: opcoes.metodo || "GET",
      headers: { "Content-Type": "application/json" },
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      // O cookie de sessao acompanha por ser same-origin; explicitar deixa
      // claro que e ele que autentica a chamada.
      credentials: "same-origin",
      signal: opcoes.sinal,
    });
  } catch (e) {
    // Abortar uma requisicao (troca de tela, filtro digitado rapido) nao e
    // falha de rede e nao deve virar toast de erro.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ErroApi(
      0,
      "SEM_CONEXAO",
      "Nao foi possivel conectar ao servidor. Verifique sua conexao."
    );
  }

  const texto = await resposta.text();
  let dados: unknown = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = null;
    }
  }

  if (resposta.status === 401) {
    // A credencial caiu no meio da navegacao (sessao expirada, acesso
    // desativado, senha trocada). Manda para o login em vez de deixar a tela
    // mostrar erro atras de erro.
    if (!window.location.pathname.startsWith("/pesquisa")) {
      window.location.href = "/login?sessao=invalida";
    }
    throw new ErroApi(401, "NAO_AUTENTICADO", "Sessao expirada. Entre novamente.");
  }

  if (!resposta.ok) {
    const corpo = dados as { erro?: string; mensagem?: string } | null;
    throw new ErroApi(
      resposta.status,
      corpo?.erro || "ERRO",
      corpo?.mensagem || "Nao foi possivel completar a operacao.",
      dados
    );
  }

  return dados as T;
}

export const api = {
  get: <T,>(caminho: string, params?: Params, sinal?: AbortSignal) =>
    requisitar<T>(caminho, { params, sinal }),
  post: <T,>(caminho: string, corpo?: unknown, params?: Params) =>
    requisitar<T>(caminho, { metodo: "POST", corpo, params }),
  patch: <T,>(caminho: string, corpo?: unknown) =>
    requisitar<T>(caminho, { metodo: "PATCH", corpo }),

  /** Entra. O servidor responde com Set-Cookie; nada e guardado aqui. */
  entrar: (email: string, senha: string) =>
    requisitar<{ perfil: string; nome: string; email: string; liderId: string | null }>(
      "auth/login",
      { metodo: "POST", corpo: { email, senha } }
    ),

  sair: () => requisitar<{ ok: boolean }>("auth/logout", { metodo: "POST" }),
};

/** Listagem paginada — formato devolvido por quase toda rota de listagem. */
export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
}
