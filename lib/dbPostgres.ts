// Driver Postgres direto (biblioteca `pg`) — usado quando DATABASE_URL existe.
//
// Existe para a migracao ao servidor proprio: la nao ha a API REST do
// Supabase (PostgREST), so o Postgres. Em vez de reescrever as ~40 rotas, este
// modulo fala a MESMA lingua que elas ja usam em lib/db.ts — `selecionar`,
// `inserir`, `atualizar`, `rpc` — e devolve os dados no mesmo formato que o
// PostgREST devolvia:
//
//  - datas/horas como texto ISO ("2026-09-25T13:40:16.372+00:00"), nao Date;
//  - numeric e bigint como number;
//  - relacoes embutidas em `colunas` ("*,clientes_nps(id,nome)") viram objeto
//    (muitos-para-um) ou lista (um-para-muitos), descobertas pelas chaves
//    estrangeiras do catalogo, como o PostgREST faz;
//  - a sintaxe de filtro do PostgREST usada em `ou` ("nome.ilike.*x*,...").
//
// Schema: no servidor proprio o NPS mora num schema so dele dentro do banco
// compartilhado (padrao da casa: banco 7station, um schema por sistema).
// DATABASE_SCHEMA diz qual; sem ela, "public" (como no Supabase).
//
// Nada aqui monta SQL com texto vindo do usuario: identificadores passam por
// `id()` (so [a-z0-9_]) e valores sempre vao como parametro ($1, $2...).

import { Pool, types } from "pg";
import { erro } from "@/lib/validacao";

/** Falha do banco, traduzida para status/mensagem por lib/db.ts. */
export class FalhaBanco extends Error {
  status: number;
  // Sem "parameter property" (constructor(public status...)): os testes rodam
  // com o Node so removendo tipos, e ele nao aceita essa sintaxe.
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

// ── Tipos no mesmo formato do PostgREST ──────────────────────────────────────

/** "2026-09-25 13:40:16.37+00" -> "2026-09-25T13:40:16.37+00:00" */
const isoComFuso = (v: string) => v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
types.setTypeParser(1184, isoComFuso); // timestamptz
types.setTypeParser(1114, (v: string) => v.replace(" ", "T")); // timestamp
types.setTypeParser(1082, (v: string) => v); // date: fica "AAAA-MM-DD"
types.setTypeParser(20, (v: string) => Number(v)); // int8 (count, bigint)
types.setTypeParser(1700, (v: string) => Number(v)); // numeric

// ── Pool ─────────────────────────────────────────────────────────────────────

// No globalThis para sobreviver ao hot reload do `next dev`, que reavalia o
// modulo e abriria um pool novo a cada edicao.
const global_ = globalThis as unknown as { __npsPool?: Pool };

/** Schema do NPS no banco (DATABASE_SCHEMA), validado como identificador. */
export function esquema(): string {
  const s = process.env.DATABASE_SCHEMA || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) {
    throw erro(500, "CONFIG_INVALIDA", `DATABASE_SCHEMA invalido: ${s}`);
  }
  return s;
}

function pool(): Pool {
  if (!global_.__npsPool) {
    const s = esquema();
    global_.__npsPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      // As funcoes nps_* e os defaults das tabelas chamam nps_norm() e o
      // pgcrypto sem prefixo: o search_path precisa achar os dois.
      options: s === "public" ? undefined : `-c search_path=${s},extensions,public`,
    });
  }
  return global_.__npsPool;
}

async function consultar<R = Record<string, unknown>>(sql: string, valores: unknown[] = []) {
  try {
    const r = await pool().query(sql, valores);
    return r.rows as R[];
  } catch (e) {
    throw falhaDoPg(e);
  }
}

/** Mesmos status que o PostgREST daria, para lib/db.ts traduzir igual. */
function falhaDoPg(e: unknown): FalhaBanco {
  if (e instanceof FalhaBanco) return e;
  const pg = e as { code?: string; message?: string };
  const msg = String(pg?.message || "Falha na consulta ao banco.");
  switch (pg?.code) {
    case "23505": // unique_violation
    case "23503": // foreign_key_violation
      return new FalhaBanco(409, msg);
    case "42883": // funcao inexistente (PostgREST: 404)
    case "42P01": // tabela inexistente
      return new FalhaBanco(404, msg);
    default:
      // P0001 (RAISE EXCEPTION das funcoes), check, not null, tipo invalido...
      if (pg?.code && /^[0-9A-Z]{5}$/.test(pg.code) && !pg.code.startsWith("08")) {
        return new FalhaBanco(400, msg);
      }
      // Sem codigo SQL (conexao recusada, timeout) ou classe 08 (conexao).
      console.error("[NPS][pg] falha de conexao/consulta:", e);
      return new FalhaBanco(503, "Falha na consulta ao banco.");
  }
}

// ── Catalogo (colunas, chaves estrangeiras, funcoes), carregado uma vez ─────

interface Catalogo {
  colunas: Map<string, Map<string, string>>; // tabela -> coluna -> udt_name
  fks: { tabela: string; colunas: string[]; ref: string; refColunas: string[] }[];
  funcoes: Map<
    string,
    { args: { nome: string; tipo: string }[]; retset: boolean; composto: boolean }[]
  >;
}

let catalogo: Promise<Catalogo> | null = null;

function carregarCatalogo(): Promise<Catalogo> {
  if (!catalogo) {
    catalogo = (async () => {
      const [cols, fks, funcs] = await Promise.all([
        consultar<{ tabela: string; coluna: string; tipo: string }>(
          `select table_name as tabela, column_name as coluna, udt_name as tipo
             from information_schema.columns where table_schema = $1`,
          [esquema()]
        ),
        consultar<{ tabela: string; colunas: string[]; ref: string; ref_colunas: string[] }>(
          `select c.conrelid::regclass::text as tabela,
                  array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o)
                        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as colunas,
                  c.confrelid::regclass::text as ref,
                  array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o)
                        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as ref_colunas
             from pg_constraint c
            where c.contype = 'f' and c.connamespace = $1::regnamespace`,
          [esquema()]
        ),
        consultar<{
          nome: string;
          retset: boolean;
          composto: boolean;
          nomes: string[] | null;
          modos: string[] | null;
          tipos: string[] | null;
        }>(
          `select p.proname as nome, p.proretset as retset,
                  (t.typtype in ('c', 'p') and t.typname <> 'void') as composto,
                  p.proargnames as nomes, p.proargmodes::text[] as modos,
                  array(select format_type(x, null) from unnest(p.proargtypes) with ordinality u(x, o) order by o) as tipos
             from pg_proc p join pg_type t on t.oid = p.prorettype
            where p.pronamespace = $1::regnamespace`,
          [esquema()]
        ),
      ]);

      const colunas = new Map<string, Map<string, string>>();
      for (const c of cols) {
        if (!colunas.has(c.tabela)) colunas.set(c.tabela, new Map());
        colunas.get(c.tabela)!.set(c.coluna, c.tipo);
      }

      const funcoes: Catalogo["funcoes"] = new Map();
      for (const f of funcs) {
        // proargtypes so tem os argumentos de ENTRADA; proargnames tem todos
        // (inclusive as colunas OUT de "returns table"), alinhados a proargmodes.
        const nomes = f.nomes || [];
        const entrada = f.modos
          ? nomes.filter((_, i) => ["i", "b", "v"].includes(f.modos![i]))
          : nomes;
        const args = (f.tipos || []).map((tipo, i) => ({ nome: entrada[i] || "", tipo }));
        if (!funcoes.has(f.nome)) funcoes.set(f.nome, []);
        funcoes.get(f.nome)!.push({ args, retset: f.retset, composto: f.composto });
      }

      return {
        colunas,
        fks: fks.map((f) => ({
          // regclass vem com prefixo ("nps.tabela") quando o schema nao esta
          // no search_path; so o nome interessa.
          tabela: f.tabela.replace(/^[^.]+\./, "").replace(/"/g, ""),
          colunas: f.colunas,
          ref: f.ref.replace(/^[^.]+\./, "").replace(/"/g, ""),
          refColunas: f.ref_colunas,
        })),
        funcoes,
      };
    })().catch((e) => {
      catalogo = null; // nao guarda a falha: a proxima chamada tenta de novo
      throw e;
    });
  }
  return catalogo;
}

// ── Montagem segura de SQL ───────────────────────────────────────────────────

function id(nome: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(nome)) {
    throw erro(400, "IDENTIFICADOR_INVALIDO", `Identificador invalido: ${nome}`);
  }
  return `"${nome}"`;
}

/** Nome de tipo para cast ("uuid", "int4"...), vindo do catalogo. */
function tipoSeguro(tipo: string | undefined): string {
  const t = tipo || "text";
  if (!/^[a-z_][a-z0-9_ ]*$/i.test(t)) throw erro(500, "TIPO_INVALIDO", `Tipo invalido: ${t}`);
  return t;
}

class Parametros {
  valores: unknown[] = [];
  add(v: unknown): string {
    this.valores.push(v);
    return `$${this.valores.length}`;
  }
}

/** Valor pronto para o driver: objeto/lista em coluna json vira texto JSON. */
function valorParaColuna(v: unknown, tipo: string | undefined): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object" || v instanceof Date) return v;
  if (tipo && tipo.startsWith("_") && Array.isArray(v)) return v; // coluna array nativa
  return JSON.stringify(v);
}

// ── `colunas` com relacoes embutidas ─────────────────────────────────────────

interface Selecao {
  estrela: boolean;
  colunas: string[];
  embutidas: { relacao: string; selecao: Selecao }[];
}

/** "*,projetos_mestre_nps(id,nome,clientes_nps(nome))" -> arvore. */
function lerColunas(texto: string): Selecao {
  const itens: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of texto) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      itens.push(atual.trim());
      atual = "";
    } else atual += ch;
  }
  if (atual.trim()) itens.push(atual.trim());

  const sel: Selecao = { estrela: false, colunas: [], embutidas: [] };
  for (const item of itens) {
    const m = item.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/i);
    if (item === "*") sel.estrela = true;
    else if (m) sel.embutidas.push({ relacao: m[1], selecao: lerColunas(m[2]) });
    else sel.colunas.push(item);
  }
  return sel;
}

function listaSelect(
  cat: Catalogo,
  tabela: string,
  alias: string,
  sel: Selecao,
  profundidade = 0
): string {
  const partes: string[] = [];
  if (sel.estrela) partes.push(`${alias}.*`);
  for (const c of sel.colunas) partes.push(`${alias}.${id(c)}`);

  for (const emb of sel.embutidas) {
    const sub = `e${profundidade + 1}`;
    const interno = listaSelect(cat, emb.relacao, sub, emb.selecao, profundidade + 1);

    // Muitos-para-um: esta tabela aponta para a relacao -> objeto (ou null).
    const paraUm = cat.fks.find((f) => f.tabela === tabela && f.ref === emb.relacao);
    if (paraUm) {
      const cond = paraUm.colunas
        .map((c, i) => `${sub}.${id(paraUm.refColunas[i])} = ${alias}.${id(c)}`)
        .join(" and ");
      partes.push(
        `(select to_jsonb(s) from (select ${interno} from ${id(esquema())}.${id(emb.relacao)} ${sub} where ${cond} limit 1) s) as ${id(emb.relacao)}`
      );
      continue;
    }
    // Um-para-muitos: a relacao aponta para esta tabela -> lista.
    const paraMuitos = cat.fks.find((f) => f.tabela === emb.relacao && f.ref === tabela);
    if (paraMuitos) {
      const cond = paraMuitos.colunas
        .map((c, i) => `${sub}.${id(c)} = ${alias}.${id(paraMuitos.refColunas[i])}`)
        .join(" and ");
      partes.push(
        `coalesce((select jsonb_agg(to_jsonb(s)) from (select ${interno} from ${id(esquema())}.${id(emb.relacao)} ${sub} where ${cond}) s), '[]'::jsonb) as ${id(emb.relacao)}`
      );
      continue;
    }
    throw erro(500, "RELACAO_DESCONHECIDA", `Sem chave estrangeira entre ${tabela} e ${emb.relacao}.`);
  }
  return partes.join(", ");
}

// ── Filtros ──────────────────────────────────────────────────────────────────

type Filtro =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | { op: string; valor: string | number | null | undefined };

/** Padrao do PostgREST ("*abc*", com \ escapando) -> padrao LIKE ("%abc%"). */
function padraoLike(v: string): string {
  let saida = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === "\\" && i + 1 < v.length) {
      const prox = v[++i];
      saida += "%_\\".includes(prox) ? `\\${prox}` : prox;
    } else if (ch === "*") saida += "%";
    else if (ch === "%" || ch === "_") saida += `\\${ch}`;
    else saida += ch;
  }
  return saida;
}

function condicao(
  alias: string,
  coluna: string,
  op: string,
  valor: string | number | boolean,
  tipo: string | undefined,
  p: Parametros
): string {
  const col = `${alias}.${id(coluna)}`;
  const v = valor;
  switch (op) {
    case "eq":
      return `${col} = ${p.add(v)}`;
    case "neq":
      return `${col} <> ${p.add(v)}`;
    case "gt":
      return `${col} > ${p.add(v)}`;
    case "gte":
      return `${col} >= ${p.add(v)}`;
    case "lt":
      return `${col} < ${p.add(v)}`;
    case "lte":
      return `${col} <= ${p.add(v)}`;
    case "like":
      return `${col}::text like ${p.add(padraoLike(String(v)))}`;
    case "ilike":
      return `${col}::text ilike ${p.add(padraoLike(String(v)))}`;
    case "is": {
      const s = String(v).toLowerCase();
      if (s === "null") return `${col} is null`;
      if (s === "true") return `${col} is true`;
      if (s === "false") return `${col} is false`;
      throw erro(400, "FILTRO_INVALIDO", `Valor invalido para is: ${v}`);
    }
    case "in": {
      const lista = String(v)
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((x) => x.trim().replace(/^"|"$/g, ""));
      return `${col} = any(${p.add(lista)}::${tipoSeguro(tipo)}[])`;
    }
    default:
      throw erro(400, "FILTRO_INVALIDO", `Operador nao suportado: ${op}`);
  }
}

/** Divide por virgula que nao esteja escapada com \ nem dentro de parenteses. */
function dividir(texto: string): string[] {
  const partes: string[] = [];
  let atual = "";
  let nivel = 0;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === "\\" && i + 1 < texto.length) {
      atual += ch + texto[++i];
      continue;
    }
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual) partes.push(atual);
  return partes;
}

/** `ou` no formato do PostgREST: "col.op.valor,col.op.valor" -> (a OR b). */
function condicaoOu(
  cat: Catalogo,
  tabela: string,
  alias: string,
  ou: string,
  p: Parametros
): string {
  const conds = dividir(ou).map((parte) => {
    const m = parte.match(/^([a-z_][a-z0-9_]*)\.([a-z]+)\.([\s\S]*)$/i);
    if (!m) throw erro(400, "FILTRO_INVALIDO", `Filtro "ou" invalido: ${parte}`);
    let valor = m[3];
    try {
      valor = decodeURIComponent(valor); // algumas rotas codificam para URL
    } catch {
      /* mantem como veio */
    }
    // Fora do LIKE, o \ so escapava a virgula/parenteses para o PostgREST.
    if (m[2] !== "ilike" && m[2] !== "like") valor = valor.replace(/\\(.)/g, "$1");
    return condicao(alias, m[1], m[2], valor, cat.colunas.get(tabela)?.get(m[1]), p);
  });
  return `(${conds.join(" or ")})`;
}

function where(
  cat: Catalogo,
  tabela: string,
  alias: string,
  filtros: Record<string, Filtro>,
  ou: string | null,
  p: Parametros
): string {
  const tipos = cat.colunas.get(tabela);
  const conds: string[] = [];
  for (const [coluna, bruto] of Object.entries(filtros)) {
    if (bruto === undefined || bruto === null) continue;
    if (typeof bruto === "object" && !Array.isArray(bruto) && "op" in bruto) {
      if (bruto.valor === undefined || bruto.valor === null || bruto.valor === "") continue;
      conds.push(condicao(alias, coluna, bruto.op, bruto.valor, tipos?.get(coluna), p));
    } else if (Array.isArray(bruto)) {
      if (!bruto.length) continue;
      const tipo = tipoSeguro(tipos?.get(coluna));
      conds.push(`${alias}.${id(coluna)} = any(${p.add(bruto.map(String))}::${tipo}[])`);
    } else {
      conds.push(`${alias}.${id(coluna)} = ${p.add(bruto)}`);
    }
  }
  if (ou) conds.push(condicaoOu(cat, tabela, alias, ou, p));
  return conds.length ? ` where ${conds.join(" and ")}` : "";
}

// ── API (mesma assinatura de lib/db.ts) ──────────────────────────────────────

export async function pgSelecionar(
  tabela: string,
  opcoes: {
    colunas: string;
    filtros: Record<string, Filtro>;
    ordem: { campo: string; ascending: boolean } | null;
    de: number | null;
    ate: number | null;
    contar: boolean;
    ou: string | null;
    limite: number | null;
  }
): Promise<{ dados: unknown; total: number | null }> {
  const cat = await carregarCatalogo();
  const t = "t0";
  const p = new Parametros();
  const lista = listaSelect(cat, tabela, t, lerColunas(opcoes.colunas || "*"));
  const cond = where(cat, tabela, t, opcoes.filtros || {}, opcoes.ou, p);

  let sql = `select ${lista} from ${id(esquema())}.${id(tabela)} ${t}${cond}`;
  if (opcoes.ordem) {
    sql += ` order by ${t}.${id(opcoes.ordem.campo)} ${opcoes.ordem.ascending ? "asc" : "desc"} nulls last`;
  }
  if (opcoes.de !== null && opcoes.ate !== null) {
    sql += ` limit ${Math.max(0, opcoes.ate - opcoes.de + 1)} offset ${Math.max(0, opcoes.de)}`;
  } else if (opcoes.limite !== null) {
    sql += ` limit ${Math.max(0, Math.floor(opcoes.limite))}`;
  }

  const [linhas, contagem] = await Promise.all([
    consultar(sql, p.valores),
    opcoes.contar
      ? consultar<{ n: number }>(
          `select count(*) as n from ${id(esquema())}.${id(tabela)} ${t}${cond}`,
          p.valores
        )
      : Promise.resolve(null),
  ]);
  return { dados: linhas, total: contagem ? Number(contagem[0]?.n ?? 0) : null };
}

export async function pgInserir(
  tabela: string,
  registros: unknown,
  retornar: boolean
): Promise<unknown> {
  const cat = await carregarCatalogo();
  const tipos = cat.colunas.get(tabela);
  const linhas = (Array.isArray(registros) ? registros : [registros]) as Record<string, unknown>[];
  if (!linhas.length) return retornar ? [] : null;

  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const p = new Parametros();
  const valores = linhas.map(
    (l) =>
      `(${colunas
        .map((c) => (c in l && l[c] !== undefined ? p.add(valorParaColuna(l[c], tipos?.get(c))) : "default"))
        .join(", ")})`
  );
  const sql =
    `insert into ${id(esquema())}.${id(tabela)} (${colunas.map(id).join(", ")}) values ${valores.join(", ")}` +
    (retornar ? " returning *" : "");
  const r = await consultar(sql, p.valores);
  return retornar ? r : null;
}

export async function pgAtualizar(
  tabela: string,
  filtros: Record<string, string | number | boolean>,
  valores: Record<string, unknown>
): Promise<unknown> {
  const cat = await carregarCatalogo();
  const tipos = cat.colunas.get(tabela);
  const p = new Parametros();
  const sets = Object.entries(valores)
    .filter(([, v]) => v !== undefined)
    .map(([c, v]) => `${id(c)} = ${p.add(valorParaColuna(v, tipos?.get(c)))}`);
  if (!sets.length) return [];
  const conds = Object.entries(filtros).map(([c, v]) => `${id(c)} = ${p.add(v)}`);
  // Update sem filtro alteraria a tabela inteira; nenhuma rota faz isso.
  if (!conds.length) throw erro(500, "ATUALIZAR_SEM_FILTRO", "Atualizacao sem filtro recusada.");
  return consultar(
    `update ${id(esquema())}.${id(tabela)} set ${sets.join(", ")} where ${conds.join(" and ")} returning *`,
    p.valores
  );
}

export async function pgRpc(funcao: string, argumentos: Record<string, unknown>): Promise<unknown> {
  const cat = await carregarCatalogo();
  const candidatas = cat.funcoes.get(funcao) || [];
  const nomes = Object.keys(argumentos);
  // Sobrecarga: fica a versao que aceita todos os argumentos passados.
  const f = candidatas.find((c) => nomes.every((n) => c.args.some((a) => a.nome === n)));
  if (!f) throw new FalhaBanco(404, `Funcao ${funcao} nao encontrada.`);

  const p = new Parametros();
  const lista = f.args
    .filter((a) => a.nome in argumentos)
    .map((a) => {
      const v = argumentos[a.nome];
      const tipo = a.tipo;
      const valor =
        v !== null && typeof v === "object" && (tipo === "jsonb" || tipo === "json")
          ? JSON.stringify(v)
          : v === undefined
            ? null
            : v;
      return `${id(a.nome)} => ${p.add(valor)}::${tipoSeguro(tipo)}`;
    })
    .join(", ");

  // Como o PostgREST: "returns setof/table" -> lista; escalar/json -> o valor.
  if (f.retset) return consultar(`select * from ${id(esquema())}.${id(funcao)}(${lista})`, p.valores);
  if (f.composto) {
    const r = await consultar(`select * from ${id(esquema())}.${id(funcao)}(${lista})`, p.valores);
    return r[0] ?? null;
  }
  const r = await consultar<{ r: unknown }>(`select ${id(esquema())}.${id(funcao)}(${lista}) as r`, p.valores);
  return r[0]?.r ?? null;
}
