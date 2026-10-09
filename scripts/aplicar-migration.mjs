// Aplica UMA migration num banco que ja esta no ar (o do servidor).
//
// Converte para o schema do .env (DATABASE_SCHEMA, ex. "nps") como o
// restaurar-banco.mjs faz, e roda tudo numa transacao: se uma linha falhar,
// nada fica pela metade.
//
// Uso:
//   node scripts/aplicar-migration.mjs supabase/migrations/24_link_elegiveis_e_canal_email.sql

import fs from "node:fs";
import pg from "pg";
import { carregarEnv, verde, vermelho } from "./comum.mjs";
import { converterEstrutura } from "./converter-dump-schema.mjs";

carregarEnv();
const url = process.env.DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA || "public";
const arquivo = process.argv[2];

function parar(msg) {
  console.error(`\n  ${vermelho("✖")} ${msg}\n`);
  process.exit(1);
}

if (!url) parar("DATABASE_URL nao esta no .env.");
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) parar(`DATABASE_SCHEMA invalido: ${schema}`);
if (!arquivo || !fs.existsSync(arquivo)) {
  parar("Informe a migration: node scripts/aplicar-migration.mjs supabase/migrations/NN_nome.sql");
}

const sql = converterEstrutura(fs.readFileSync(arquivo, "utf8"), schema).sql;

const cliente = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await cliente.connect();
try {
  await cliente.query("begin");
  await cliente.query(sql);
  await cliente.query("commit");
} catch (e) {
  await cliente.query("rollback").catch(() => {});
  await cliente.end();
  parar(`Falhou, nada foi aplicado: ${e.message}`);
}
await cliente.end();
console.log(`\n  ${verde("✔")} ${arquivo} aplicada no schema "${schema}".\n`);
