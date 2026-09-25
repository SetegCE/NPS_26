// Converte o dump do Supabase (schema public) para o schema do NPS no
// servidor proprio (padrao da casa: banco 7station, um schema por sistema).
//
// Entrada: os dois arquivos SQL gerados pelo pg_dump (ver DEPLOY.md):
//   estrutura.sql  (--schema-only)
//   dados.sql      (--data-only)
// Saida: os mesmos arquivos com sufixo ".<schema>.sql", prontos para o psql.
//
// Por que um script e nao "localizar e substituir": no arquivo de DADOS a
// palavra "public." pode aparecer dentro de um comentario de cliente ou de
// uma descricao da auditoria. La so a linha "COPY public.tabela" e trocada;
// o conteudo das linhas nunca e tocado. Na ESTRUTURA a troca e ampla
// (tabelas, views, funcoes), e o search_path fixado nas funcoes
// ("SET search_path TO 'public', 'extensions'") passa a apontar para o schema
// novo, mantendo public no fim para achar extensoes instaladas la.
//
// Uso:
//   node scripts/converter-dump-schema.mjs estrutura.sql dados.sql [schema=nps]
//   node scripts/converter-dump-schema.mjs migration.sql - [schema=nps]   (so estrutura)

import fs from "node:fs";

const [estrutura, dados, schema = "nps"] = process.argv.slice(2);
if (!estrutura || !dados) {
  console.error("Uso: node scripts/converter-dump-schema.mjs estrutura.sql dados.sql [schema=nps]");
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error(`Schema invalido: ${schema}`);
  process.exit(1);
}

const saida = (arq) => arq.replace(/\.sql$/i, "") + `.${schema}.sql`;

// ── Estrutura ────────────────────────────────────────────────────────────────
let sql = fs.readFileSync(estrutura, "utf8");

// O schema public ja existe em qualquer banco: o dump nao deve recria-lo nem
// mexer no comentario dele.
sql = sql
  .split(/\r?\n/)
  .filter((l) => !/^(CREATE SCHEMA public;|COMMENT ON SCHEMA public IS)/.test(l))
  .join("\n");

sql = sql.replace(/\bpublic\./g, `${schema}.`);
sql = sql.replace(
  /SET search_path TO 'public', 'extensions'/g,
  `SET search_path TO '${schema}', 'extensions', 'public'`
);
sql = sql.replace(/SET search_path TO 'public'/g, `SET search_path TO '${schema}', 'extensions', 'public'`);
// Forma sem aspas, usada nas migrations escritas a mao (ex.: a 13).
sql = sql.replace(/set search_path = public\b/gi, `set search_path = ${schema}, extensions, public`);

sql =
  `-- Convertido para o schema "${schema}" por scripts/converter-dump-schema.mjs\n` +
  `CREATE SCHEMA IF NOT EXISTS ${schema};\n` +
  `CREATE SCHEMA IF NOT EXISTS extensions;\n\n` +
  sql;

fs.writeFileSync(saida(estrutura), sql);

// Sobra de "public" que nao seja o search_path ja tratado: conferir a mao.
const sobras = sql
  .split("\n")
  .map((l, i) => ({ l, n: i + 1 }))
  // "from public"/"to public" em GRANT/REVOKE e o papel PUBLIC, nao o schema.
  .filter(
    ({ l }) =>
      /\bpublic\b/.test(l) &&
      !/extensions'?, '?public/.test(l) &&
      !/\b(from|to) public\b/i.test(l) &&
      !/^--/.test(l.trim())
  );

// ── Dados ────────────────────────────────────────────────────────────────────
let linhasCopy = 0;
if (dados === "-") {
  console.log(`
  Estrutura -> ${saida(estrutura)}`);
  if (sobras.length) for (const s of sobras.slice(0, 30)) console.log(`    conferir ${s.n}: ${s.l.trim().slice(0, 140)}`);
  process.exit(0);
}
const dadosSql = fs
  .readFileSync(dados, "utf8")
  .split(/\r?\n/)
  .map((l) => {
    if (/^COPY public\./.test(l)) {
      linhasCopy++;
      return l.replace(/^COPY public\./, `COPY ${schema}.`);
    }
    if (/^SELECT pg_catalog\.setval\('public\./.test(l)) {
      return l.replace("'public.", `'${schema}.`);
    }
    return l;
  })
  .join("\n");
fs.writeFileSync(saida(dados), dadosSql);

console.log(`\n  Estrutura -> ${saida(estrutura)}`);
console.log(`  Dados     -> ${saida(dados)} (${linhasCopy} tabelas)`);
if (sobras.length) {
  console.log(`\n  Conferir estas linhas, que ainda citam "public":`);
  for (const s of sobras.slice(0, 30)) console.log(`    ${s.n}: ${s.l.trim().slice(0, 140)}`);
} else {
  console.log(`\n  Nenhuma referencia a "public" sobrou fora do search_path.`);
}
console.log("");
