// Padroniza os nomes dos respondentes: primeira letra de cada nome maiuscula e
// o resto minusculo ("MARIA DA SILVA" -> "Maria da Silva"). Acentos ficam; as
// particulas da/de/do/das/dos/e ficam minusculas.
//
// Usa a DATABASE_URL e o DATABASE_SCHEMA do .env. Sem --gravar so mostra o que
// mudaria. Com --gravar guarda antes os nomes originais em
// backup/nomes-respondentes-antes-AAAA-MM-DD.json e altera tudo numa transacao.
//
// Uso:
//   node scripts/padronizar-nomes-respondentes.mjs            (previa)
//   node scripts/padronizar-nomes-respondentes.mjs --gravar

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { RAIZ, carregarEnv, cinza, verde, vermelho } from "./comum.mjs";

carregarEnv();
const schema = process.env.DATABASE_SCHEMA || "public";
const gravar = process.argv.includes("--gravar");

function parar(msg) {
  console.log(`\n  ${vermelho("✖")} ${msg}\n`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) parar("Falta DATABASE_URL no .env");
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) parar(`DATABASE_SCHEMA invalido: ${schema}`);

const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e", "di", "du", "del"]);

const maiusculaInicial = (s) => (s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : s);

export const formatarNome = (nome) =>
  nome
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((p, i) =>
      i > 0 && PARTICULAS.has(p) ? p : p.split(/([-'’])/).map(maiusculaInicial).join("")
    )
    .join(" ");

const cliente = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await cliente.connect();

try {
  const tabela = `"${schema}".respondentes_nps`;
  const { rows } = await cliente.query(`select id, nome from ${tabela} order by nome`);
  const mudar = rows.filter((r) => r.nome && formatarNome(r.nome) !== r.nome);

  console.log(`\n  Schema ${schema}: ${rows.length} respondentes, ${mudar.length} a padronizar\n`);
  for (const r of mudar) console.log(`  ${r.nome} ${cinza("->")} ${formatarNome(r.nome)}`);

  if (!mudar.length) {
    console.log(`\n  ${verde("✔")} Nada a mudar.\n`);
  } else if (!gravar) {
    console.log(cinza("\n  Previa. Rode de novo com --gravar para aplicar.\n"));
  } else {
    const hoje = new Date().toISOString().slice(0, 10);
    const backup = path.join(RAIZ, "backup", `nomes-respondentes-antes-${hoje}.json`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.writeFileSync(backup, JSON.stringify(mudar, null, 2));

    await cliente.query("begin");
    for (const r of mudar) {
      await cliente.query(`update ${tabela} set nome = $1 where id = $2`, [formatarNome(r.nome), r.id]);
    }
    await cliente.query("commit");
    console.log(`\n  ${verde("✔")} ${mudar.length} nomes padronizados. Originais em ${path.relative(RAIZ, backup)}\n`);
  }
} catch (e) {
  await cliente.query("rollback").catch(() => {});
  parar(e.message);
} finally {
  await cliente.end();
}
