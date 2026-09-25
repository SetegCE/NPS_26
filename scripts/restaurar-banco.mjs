// Monta o banco do NPS no servidor proprio, em um comando:
//
//   1. banco/estrutura.sql      (tabelas, funcoes, views, triggers)
//   2. migration 13             (freio de forca bruta do login)
//      migration 20             (plano de acao)
//      migration 21             (evidencia da acao concluida)
//   3. arquivo de dados         (gerado por scripts/exportar-dados.mjs)
//
// Converte para o schema do .env (DATABASE_SCHEMA, ex. "nps") em memoria e
// carrega pela DATABASE_URL. Nao precisa de psql nem de pg_dump.
//
// Seguranca: RECUSA rodar se o schema ja tiver tabelas do NPS — carregar duas
// vezes duplicaria ou quebraria. Para refazer do zero, apague o schema antes
// (drop schema nps cascade) conscientemente.
//
// Uso:
//   node scripts/restaurar-banco.mjs backup/dados-nps-AAAA-MM-DD.sql

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { RAIZ, carregarEnv, verde, vermelho } from "./comum.mjs";
import { converterEstrutura } from "./converter-dump-schema.mjs";

carregarEnv();
const url = process.env.DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA || "public";
const arquivoDados = process.argv[2];

function parar(msg) {
  console.error(`\n  ${vermelho("✖")} ${msg}\n`);
  process.exit(1);
}

if (!url) parar("DATABASE_URL nao esta no .env.");
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) parar(`DATABASE_SCHEMA invalido: ${schema}`);
if (!arquivoDados || !fs.existsSync(arquivoDados)) {
  parar("Informe o arquivo de dados: node scripts/restaurar-banco.mjs backup/dados-nps-AAAA-MM-DD.sql");
}
const dados = fs.readFileSync(arquivoDados, "utf8");
const destinoDoArquivo = dados.match(/^-- Schema de destino: ([a-z0-9_]+)\./m)?.[1];
if (destinoDoArquivo && destinoDoArquivo !== schema) {
  parar(`O arquivo de dados foi gerado para o schema "${destinoDoArquivo}", mas DATABASE_SCHEMA e "${schema}".`);
}

const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8");
const etapas = [
  ["estrutura", converterEstrutura(ler("banco/estrutura.sql"), schema).sql],
  ["freio de login (migration 13)", converterEstrutura(ler("supabase/migrations/13_freio_de_forca_bruta_no_banco.sql"), schema).sql],
  ["plano de ação (migration 20)", converterEstrutura(ler("supabase/migrations/20_plano_de_acao.sql"), schema).sql],
  ["evidência da ação (migration 21)", converterEstrutura(ler("supabase/migrations/21_evidencia_da_acao.sql"), schema).sql],
  ["dados", dados],
];

const cliente = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await cliente.connect();
const q = async (sql, v = []) => (await cliente.query(sql, v)).rows;

const [{ n: existentes }] = await q(
  "select count(*)::int n from information_schema.tables where table_schema = $1 and table_name like '%_nps'",
  [schema]
);
if (existentes) {
  await cliente.end();
  parar(`O schema "${schema}" ja tem ${existentes} tabela(s) do NPS. Nada foi feito.`);
}

console.log(`\n  Restaurando no schema "${schema}"...`);
for (const [nome, sql] of etapas) {
  const t0 = Date.now();
  try {
    await cliente.query(sql);
  } catch (e) {
    await cliente.end();
    parar(`Falhou na etapa "${nome}": ${e.message}`);
  }
  console.log(`    ${verde("✔")} ${nome} (${Date.now() - t0} ms)`);
}

// Conferencia: contagem de cada tabela contra o cabecalho do arquivo de dados.
const esperado = Object.fromEntries(
  (dados.match(/^-- Linhas: (.+)$/m)?.[1] || "")
    .split(", ")
    .filter(Boolean)
    .map((p) => p.split("="))
    .map(([t, n]) => [t, Number(n)])
);
let divergencias = 0;
console.log("\n  Conferencia de linhas:");
for (const [tabela, n] of Object.entries(esperado)) {
  const [{ c }] = await q(`select count(*)::int c from "${schema}"."${tabela}"`);
  const ok = c === n;
  if (!ok) divergencias++;
  console.log(`    ${ok ? verde("✔") : vermelho("✖")} ${tabela.padEnd(28)} ${c}${ok ? "" : ` (esperado ${n})`}`);
}
await cliente.end();

if (divergencias) parar(`${divergencias} tabela(s) com contagem diferente do arquivo de dados.`);
console.log(`\n  ${verde("Banco pronto.")} Rode npm run check e depois npm run build && npm start.\n`);
