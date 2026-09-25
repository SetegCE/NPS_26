// Compara os dois motores de banco de lib/db.ts: PostgREST do Supabase x
// Postgres direto (lib/dbPostgres.ts).
//
// Roda as MESMAS consultas de leitura pelos dois caminhos e acusa qualquer
// diferenca de conteudo ou de formato. So le: nenhuma consulta aqui grava.
//
// Precisa, no .env.local, das duas conexoes apontando para o MESMO banco:
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   (motor PostgREST)
//   DATABASE_URL                               (motor Postgres direto)
//
// Uso:
//   node --import ./tests/alias.mjs scripts/comparar-motores.mjs

import { carregarEnv } from "./comum.mjs";

carregarEnv();
const URL_PG = process.env.DATABASE_URL;
if (!URL_PG || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "\n  ✖ Precisa de DATABASE_URL, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local\n"
  );
  process.exit(1);
}

const db = await import("../lib/db.ts");

/** Roda `acao` num motor especifico ligando/desligando DATABASE_URL. */
async function com(motor, acao) {
  if (motor === "pg") process.env.DATABASE_URL = URL_PG;
  else delete process.env.DATABASE_URL;
  try {
    return { ok: true, valor: await acao() };
  } catch (e) {
    return { ok: false, valor: `${e?.status || ""} ${e?.codigo || ""} ${e?.message || e}` };
  }
}

const umCiclo = (
  await com("rest", () => db.selecionar("ciclos_nps", { colunas: "id,codigo", limite: 1 }))
).valor.dados[0];
const umaPesquisa = (
  await com("rest", () =>
    db.selecionar("pesquisas_nps", { colunas: "id,token", limite: 1, ordem: { campo: "id", ascending: true } })
  )
).valor.dados[0];

const ord = (campo, ascending = true) => ({ campo, ascending });

// Cobre os formatos que as rotas usam: *, colunas, relacoes embutidas
// (inclusive aninhadas), filtros eq/in/op, `ou` com ilike/neq/is, paginacao,
// contagem e rpc (lista e escalar).
const CASOS = [
  ["ciclos", () => db.selecionar("ciclos_nps", { ordem: ord("codigo") })],
  ["clientes paginado+contagem", () =>
    db.selecionar("clientes_nps", { ordem: ord("nome"), de: 5, ate: 14, contar: true })],
  ["lideres busca ilike", () =>
    db.selecionar("lideres_nps", { ou: `nome.ilike.${db.termoBusca("a")}`, ordem: ord("nome") })],
  ["projetos admin + filtros", () =>
    db.selecionar("vw_projetos_admin", { filtros: { ativo: true }, ordem: ord("codigo_clockify"), contar: true })],
  ["projetos admin busca ou", () =>
    db.selecionar("vw_projetos_admin", {
      ou: `nome.ilike.${db.termoBusca("gest")},codigo_clockify.ilike.${db.termoBusca("gest")},cliente_nome.ilike.${db.termoBusca("gest")}`,
      ordem: ord("nome"),
    })],
  ["respondentes com cliente embutido", () =>
    db.selecionar("respondentes_nps", { colunas: "*,clientes_nps(id,nome)", ordem: ord("nome"), de: 0, ate: 24, contar: true })],
  ["isc com projeto+cliente aninhado", () =>
    db.selecionar("isc_nps", { colunas: "*,projetos_mestre_nps(id,codigo_clockify,nome,cliente_id,clientes_nps(nome))", ordem: ord("competencia", false) })],
  ["lideranca com projeto aninhado", () =>
    db.selecionar("projeto_lideranca_hist_nps", { colunas: "*,projetos_mestre_nps(id,codigo_clockify,nome,cliente_id,clientes_nps(nome))", ordem: ord("iniciado_em", false) })],
  ["vinculos com respondente", () =>
    db.selecionar("projeto_respondentes_nps", { colunas: "projeto_id,respondente_id,ativo,respondentes_nps(id,nome,email)", ordem: ord("id") })],
  ["respostas (ciclo neq ou null)", () =>
    db.selecionar("respostas_nps", { ou: `ciclo.neq.${encodeURIComponent(umCiclo?.codigo || "x")},ciclo.is.null`, ordem: ord("timestamp", false) })],
  ["respostas enriquecidas", () =>
    db.selecionar("vw_respostas_enriquecidas", { ordem: ord("timestamp", false) })],
  ["pesquisas view", () =>
    db.selecionar("vw_pesquisas", { filtros: { ativo: true }, ordem: ord("data_geracao", false), de: 0, ate: 24, contar: true })],
  ["operacao do ciclo", () =>
    db.selecionar("vw_operacao_ciclo", { filtros: { ciclo_id: umCiclo?.id }, ordem: ord("projeto_nome") })],
  ["participacoes in(...)", () =>
    db.selecionar("projetos_nps", { filtros: { ciclo_id: [umCiclo?.id].filter(Boolean) }, ordem: ord("id") })],
  ["op gte", () =>
    db.selecionar("auditoria_nps", { filtros: { created_at: { op: "gte", valor: "2026-09-25" } }, ordem: ord("created_at"), limite: 30 })],
  ["um() por token", () => db.um("vw_pesquisas", { token: umaPesquisa?.token }, "id,status,ativo")],
  ["rpc lista: participantes do ciclo", () => db.rpc("nps_participantes_do_ciclo", { p_ciclo_id: umCiclo?.id })],
  ["rpc escalar: canal da data", () => db.rpc("nps_canal_da_data", { p_ciclo_id: umCiclo?.id, p_dia: "2026-09-25" })],
  ["erro traduzido (funcao inexistente)", () => db.rpc("nps_nao_existe", {})],
];

/** Ordena chaves para comparar objetos sem depender da ordem das colunas. */
const canonico = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
      : x
  );

function primeiraDiferenca(a, b, caminho = "") {
  if (canonico(a) === canonico(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = primeiraDiferenca(a[k], b[k], `${caminho}.${k}`);
      if (d) return d;
    }
  }
  return `${caminho || "(raiz)"}: rest=${JSON.stringify(a)?.slice(0, 120)} | pg=${JSON.stringify(b)?.slice(0, 120)}`;
}

let falhas = 0;
for (const [nome, acao] of CASOS) {
  const rest = await com("rest", acao);
  const pg = await com("pg", acao);
  // Erro: basta os dois falharem com o mesmo status.
  const iguais =
    rest.ok === pg.ok &&
    (rest.ok ? canonico(rest.valor) === canonico(pg.valor) : rest.valor.split(" ")[0] === pg.valor.split(" ")[0]);
  const qtd = Array.isArray(rest.valor?.dados) ? ` (${rest.valor.dados.length} linhas)` : "";
  // Ordem diferente so entre empates (mesma data/nome): o Postgres nao garante
  // ordem entre empates nem no mesmo banco. Conteudo igual = ok.
  const lista = (v) => (Array.isArray(v?.dados) ? v.dados : Array.isArray(v) ? v : null);
  const mesmoConteudo =
    !iguais && rest.ok && pg.ok && lista(rest.valor) && lista(pg.valor) &&
    canonico(lista(rest.valor).map(canonico).sort()) === canonico(lista(pg.valor).map(canonico).sort()) &&
    (rest.valor?.total ?? null) === (pg.valor?.total ?? null);
  if (iguais) console.log(`  ✔ ${nome}${qtd}`);
  else if (mesmoConteudo) console.log(`  ✔ ${nome}${qtd} — mesmo conteudo; so a ordem entre empates difere`);
  else {
    falhas++;
    console.log(`  ✖ ${nome}${qtd}`);
    console.log(`      ${rest.ok && pg.ok ? primeiraDiferenca(rest.valor, pg.valor) : `rest=${rest.ok ? "ok" : rest.valor} | pg=${pg.ok ? "ok" : pg.valor}`}`);
  }
}

console.log(falhas ? `\n  ${falhas} diferenca(s).\n` : "\n  Os dois motores devolvem o mesmo resultado.\n");
process.exit(falhas ? 1 : 0);
