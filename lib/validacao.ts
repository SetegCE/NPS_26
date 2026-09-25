// Validadores de entrada.
//
// Vivem separados de lib/http.ts porque nao dependem de NADA do Next: sao
// funcoes puras sobre valores vindos do cliente. Essa separacao e o que
// permite testa-los com `node --test` sem subir o framework — ver
// tests/validacao.test.mjs.
//
// As regras sao as mesmas de api/_lib/http.js; o que mudou foi o tipo.

export class ErroHttp extends Error {
  readonly status: number;
  readonly codigo: string;

  constructor(status: number, codigo: string, mensagem?: string) {
    super(mensagem || codigo);
    this.status = status;
    this.codigo = codigo;
  }
}

export const erro = (status: number, codigo: string, mensagem?: string) =>
  new ErroHttp(status, codigo, mensagem);

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Caracteres de controle removidos na sanitizacao de texto.
const RE_CONTROLE = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]", "g");

/** Valida um UUID vindo do cliente. */
export function uuid(valor: unknown, campo: string): string {
  const v = String(valor ?? "").trim();
  if (!RE_UUID.test(v)) {
    throw erro(400, "ID_INVALIDO", `Campo "${campo}" nao e um identificador valido.`);
  }
  return v;
}

export function uuidOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  return uuid(valor, campo);
}

/** Texto saneado: remove caracteres de controle e limita tamanho. */
export function texto(
  valor: unknown,
  campo: string,
  { obrigatorio = false, max = 500 }: { obrigatorio?: boolean; max?: number } = {}
): string | null {
  let v = valor === undefined || valor === null ? "" : String(valor);
  v = v.replace(RE_CONTROLE, "").trim();
  if (!v) {
    if (obrigatorio) throw erro(400, "CAMPO_OBRIGATORIO", `Campo "${campo}" e obrigatorio.`);
    return null;
  }
  if (v.length > max) {
    throw erro(400, "CAMPO_MUITO_LONGO", `Campo "${campo}" excede ${max} caracteres.`);
  }
  return v;
}

/** Igual a `texto`, mas para quando o chamador exige string de volta. */
export function textoObrigatorio(valor: unknown, campo: string, max = 500): string {
  return texto(valor, campo, { obrigatorio: true, max }) as string;
}

export function nota(
  valor: unknown,
  campo: string,
  { obrigatorio = false }: { obrigatorio?: boolean } = {}
): number | null {
  if (valor === undefined || valor === null || valor === "") {
    if (obrigatorio) throw erro(400, "CAMPO_OBRIGATORIO", `Campo "${campo}" e obrigatorio.`);
    return null;
  }
  // Booleano fica de fora explicitamente: `Number(true)` e 1, entao um corpo
  // com `nota_q4: true` viraria silenciosamente a nota 1 — um detrator
  // inventado no meio do indice.
  const n = typeof valor === "boolean" ? NaN : Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 10) {
    throw erro(400, "NOTA_INVALIDA", `Campo "${campo}" deve ser um inteiro entre 0 e 10.`);
  }
  return n;
}

export function booleano(valor: unknown, padrao: boolean | null = null): boolean | null {
  if (valor === undefined || valor === null || valor === "") return padrao;
  if (typeof valor === "boolean") return valor;
  const v = String(valor).toLowerCase();
  if (["true", "1", "sim"].includes(v)) return true;
  if (["false", "0", "nao"].includes(v)) return false;
  return padrao;
}

export function umDe<T extends string>(
  valor: unknown,
  opcoes: readonly T[],
  campo: string,
  { obrigatorio = false }: { obrigatorio?: boolean } = {}
): T | null {
  const v = texto(valor, campo, { obrigatorio, max: 60 });
  if (v === null) return null;
  if (!(opcoes as readonly string[]).includes(v)) {
    throw erro(400, "VALOR_INVALIDO", `Campo "${campo}" deve ser um de: ${opcoes.join(", ")}.`);
  }
  return v as T;
}

/** Competencia mensal AAAA-MM -> primeiro dia do mes. */
export function competencia(
  valor: unknown,
  campo: string,
  { obrigatorio = false }: { obrigatorio?: boolean } = {}
): string | null {
  const v = texto(valor, campo, { obrigatorio, max: 10 });
  if (v === null) return null;
  const m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(v);
  if (!m) {
    throw erro(400, "COMPETENCIA_INVALIDA", `Campo "${campo}" deve estar no formato AAAA-MM.`);
  }
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) {
    throw erro(400, "COMPETENCIA_INVALIDA", "Mes da competencia invalido.");
  }
  return `${m[1]}-${m[2]}-01`;
}

export interface Paginacao {
  pagina: number;
  porPagina: number;
  de: number;
  ate: number;
}

/** Paginacao segura: teto de 200 por pagina, piso de 1. */
export function paginacao(query: URLSearchParams): Paginacao {
  const pagina = Math.max(1, parseInt(query.get("pagina") || "", 10) || 1);
  const porPagina = Math.min(200, Math.max(1, parseInt(query.get("porPagina") || "", 10) || 25));
  return { pagina, porPagina, de: (pagina - 1) * porPagina, ate: pagina * porPagina - 1 };
}

export interface Ordem {
  campo: string;
  ascending: boolean;
}

/** Whitelist de ordenacao — impede injecao via parametro de ordem. */
export function ordenacao(
  query: URLSearchParams,
  permitidos: readonly string[],
  padrao: string
): Ordem {
  const pedido = query.get("ordenarPor") || "";
  const campo = permitidos.includes(pedido) ? pedido : padrao;
  const desc = (query.get("ordem") || "").toLowerCase() === "desc";
  return { campo, ascending: !desc };
}
