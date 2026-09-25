// Assinatura e verificacao do cookie de sessao via JWT (HS256).
//
// Usa `jose`, e nao `jsonwebtoken`, porque este modulo e importado pelo
// middleware.ts, que roda em Edge Runtime: jsonwebtoken depende do `crypto`
// nativo do Node, que o Edge nao tem. Mesma escolha do SGA.
//
// ── O que mudou em relacao as versoes anteriores ──────────────────────────
//
// v1: HMAC artesanal em api/_lib/auth.js, token no localStorage e enviado em
// `Authorization: Bearer`. Qualquer XSS na pagina lia o token e roubava a
// sessao. O segredo tinha fallback para a service_role key e, na falta dela,
// para string VAZIA — quem lesse o repositorio forjava um token de PMO.
//
// v2: cookie httpOnly, jose, segredo obrigatorio. Mas a identidade ainda era
// a SENHA: o token guardava qual credencial compartilhada tinha sido usada.
//
// Agora: a identidade e a PESSOA. O token carrega o id do usuario, e a
// auditoria passa a registrar quem fez o quê, em vez de "alguem que sabia a
// senha do PMO".

import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

const SEGREDO_ENV = process.env.NPS_SESSION_SECRET;
if (!SEGREDO_ENV) {
  throw new Error(
    "NPS_SESSION_SECRET nao esta definida. Configure a variavel de ambiente " +
      "(veja .env.example) antes de iniciar a aplicacao — sem ela nao e seguro assinar sessoes."
  );
}
const SEGREDO = new TextEncoder().encode(SEGREDO_ENV);

export type Perfil = "pmo" | "lider";

export const PERFIL_PMO: Perfil = "pmo";
export const PERFIL_LIDER: Perfil = "lider";

export interface SessaoPayload {
  /** `usuarios_nps.id`. E por ele que lib/session.ts reconfere a conta no
   *  banco a cada requisicao. */
  usuarioId: string;
  nome: string;
  email: string;
  perfil: Perfil;
  /** Escopo do lider (`lideres_nps.id`). null para o PMO, que enxerga tudo. */
  liderId: string | null;
  /** Impressao digital da senha vigente quando o token foi emitido — ver
   *  `impressaoDaCredencial` em lib/senha.ts. Trocar a senha muda a impressao
   *  e derruba as sessoes abertas com a senha antiga. */
  cred: string;
}

export const COOKIE_SESSAO = "nps_session";

/** 12 horas: cobre um dia de trabalho sem pedir login de novo e expira antes
 *  do dia seguinte. */
export const SESSAO_MAX_AGE_SEGUNDOS = 60 * 60 * 12;

export async function assinarToken(carga: SessaoPayload): Promise<string> {
  return new SignJWT({ ...carga })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(SEGREDO);
}

export async function verificarToken(token: string): Promise<SessaoPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SEGREDO);
    const p = payload as unknown as SessaoPayload;
    // Perfil fora do esperado nao e sessao valida: o resto do sistema decide
    // permissao a partir deste campo, entao um valor estranho nao pode passar.
    if (p.perfil !== PERFIL_PMO && p.perfil !== PERFIL_LIDER) return null;
    if (!p.usuarioId) return null;
    return p;
  } catch {
    // Assinatura invalida, token expirado ou corrompido caem todos aqui. Quem
    // chama trata `null` como "nao autenticado" — nao ha o que distinguir.
    return null;
  }
}
