// Freio de tentativas de login, contado NO BANCO.
//
// ── Por que saiu da memoria do processo ───────────────────────────────────
//
// A versao original guardava o contador num `Map` do processo. Isso faz
// sentido num servidor Node unico, mas este sistema roda na Vercel: cada
// invocacao pode cair numa instancia nova, e o contador zera a cada cold
// start. Bastava espacar as tentativas para nunca bater no limite — ou seja,
// na pratica o freio quase nao existia, justamente no ambiente em que mais
// importava. E a mesma correcao que o SGA ja aplicou.
//
// ── Por que a chave e IP + e-mail ─────────────────────────────────────────
//
// Enquanto o login era por senha unica nao havia identidade para compor a
// chave, e o freio era so por IP. Com e-mail, a chave passa a ser
// `ip::email`: um escritorio inteiro atras do mesmo IP nao trava porque um
// colega errou a senha tres vezes, e ainda assim cada conta tem seu proprio
// contador.
//
// ── Por que falha ABERTO ──────────────────────────────────────────────────
//
// Se a consulta do freio quebrar, a tentativa e permitida em vez de negada.
// Um limitador que derruba o login inteiro quando o banco soluca e pior do
// que limitador nenhum — e nao abre brecha real: sem banco, o login tambem
// nao consegue conferir a senha, entao nao ha o que forcar.
//
// Isso tambem significa que o sistema continua subindo antes da migration 13
// ser aplicada: as funcoes ainda nao existem, o RPC falha, e o login segue
// funcionando sem freio ate o SQL rodar.

import { rpc } from "@/lib/db";

/**
 * IP de quem chamou.
 *
 * Na Vercel o `x-forwarded-for` e preenchido pela borda e o primeiro item e o
 * IP real — diferente de um servidor exposto direto, onde o cliente poderia
 * forjar o cabecalho.
 */
export function obterIpCliente(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "desconhecido";
}

/** Chave do contador. O e-mail entra normalizado, como no login. */
export function chaveDoFreio(ip: string, email: unknown): string {
  const e = String(email ?? "").trim().toLowerCase().slice(0, 254);
  return `${ip}::${e}`;
}

export interface ResultadoLimite {
  bloqueado: boolean;
  /** Segundos restantes do bloqueio, presente apenas se bloqueado. */
  segundosRestantes?: number;
}

/** Confere se esta combinacao IP+e-mail esta bloqueada agora. Nao registra nada. */
export async function verificarLimite(chave: string): Promise<ResultadoLimite> {
  try {
    const restante = await rpc<number | null>("nps_freio_login_verificar", { p_chave: chave });
    const segundos = Number(restante ?? 0);
    if (!Number.isFinite(segundos) || segundos <= 0) return { bloqueado: false };
    return { bloqueado: true, segundosRestantes: segundos };
  } catch (e) {
    console.error("[NPS][freio] falha ao consultar — liberando a tentativa:", e);
    return { bloqueado: false };
  }
}

/** Registra uma tentativa que falhou. */
export async function registrarFalha(chave: string): Promise<void> {
  try {
    await rpc("nps_freio_login_falha", { p_chave: chave });
  } catch (e) {
    console.error("[NPS][freio] falha ao registrar tentativa:", e);
  }
}

/** Login certo: zera o historico daquela combinacao. */
export async function registrarSucesso(chave: string): Promise<void> {
  try {
    await rpc("nps_freio_login_sucesso", { p_chave: chave });
  } catch (e) {
    console.error("[NPS][freio] falha ao limpar tentativas:", e);
  }
}
