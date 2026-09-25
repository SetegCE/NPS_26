// Exporta os DADOS do banco atual (Supabase) para um SQL de carga no schema
// do servidor proprio. Complementa banco/estrutura.sql, que tem so a estrutura.
//
// O arquivo gerado contem dado pessoal (respondentes, respostas), hashes de
// senha e os tokens dos links de pesquisa: vai para backup/, que o .gitignore
// ignora. NUNCA versionar — o repositorio e publico.
//
// Como o arquivo carrega sem alterar nada:
//  - cada tabela entra num INSERT ... SELECT json_populate_recordset: o proprio
//    Postgres converte o JSON para o tipo de cada coluna (uuid, jsonb, data);
//  - os triggers de usuario ficam DESLIGADOS durante a carga — senao o
//    nps_canal_pela_janela preencheria o canal de respostas antigas que estao
//    sem canal, e os touch_updated_at reescreveriam updated_at;
//  - pesquisas_nps e respostas_nps apontam uma para a outra: a pesquisa entra
//    sem resposta_id, a resposta entra, e o vinculo e refeito no fim;
//  - tudo numa transacao: ou carrega inteiro, ou nada.
//
// Uso:
//   node scripts/exportar-dados.mjs [schema=nps]
// Carga no servidor (depois de banco/estrutura convertida + migration 13):
//   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backup/dados-nps-AAAA-MM-DD.sql

import fs from "node:fs";
import path from "node:path";
import { RAIZ, conectar, verde } from "./comum.mjs";

const schema = process.argv[2] || "nps";
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error(`Schema invalido: ${schema}`);
  process.exit(1);
}

// Ordem das chaves estrangeiras: quem e referenciado entra antes.
const TABELAS = [
  "clientes_nps",
  "lideres_nps",
  "ciclos_nps",
  "projetos_mestre_nps",
  "respondentes_nps",
  "projetos_nps",
  "projeto_respondentes_nps",
  "projeto_lideranca_hist_nps",
  "ciclo_transicao_nps",
  "isc_nps",
  "usuarios_nps",
  "auditoria_nps",
  "pesquisas_nps",
  "respostas_nps",
  "planos_acao_nps",
  "plano_acao_itens_nps",
];
const COM_TRIGGER = [
  "ciclos_nps",
  "clientes_nps",
  "isc_nps",
  "lideres_nps",
  "pesquisas_nps",
  "projeto_respondentes_nps",
  "projetos_mestre_nps",
  "projetos_nps",
  "respondentes_nps",
  "respostas_nps",
  "usuarios_nps",
  "planos_acao_nps",
  "plano_acao_itens_nps",
];

// Colunas calculadas (GENERATED ... STORED): o Postgres recalcula na carga e
// recusa valor vindo de fora, entao ficam fora do INSERT.
const CALCULADAS = {
  clientes_nps: ["nome_norm"],
  lideres_nps: ["nome_norm"],
  projetos_mestre_nps: ["codigo_norm"],
  respondentes_nps: ["email_norm", "nome_norm"],
  usuarios_nps: ["email_norm"],
};

const { db } = conectar();

async function tudo(tabela) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const lote = await db(`${tabela}?select=*&order=id.asc`, {
      headers: { Range: `${de}-${de + 999}` },
    });
    linhas.push(...lote);
    if (lote.length < 1000) return linhas;
  }
}

const TAG = "$nps_dados$";
const json = (v) => {
  const t = JSON.stringify(v);
  if (t.includes(TAG)) throw new Error("Dados contem o delimitador " + TAG);
  return `${TAG}${t}${TAG}`;
};

const dados = {};
for (const t of TABELAS) {
  dados[t] = await tudo(t);
  console.log(`  ${t.padEnd(28)} ${String(dados[t].length).padStart(4)} linhas`);
}

const hoje = new Date().toISOString().slice(0, 10);
const partes = [
  `-- Dados do Dashboard NPS exportados do Supabase em ${new Date().toISOString()}`,
  `-- Schema de destino: ${schema}. CONTEM DADO PESSOAL E TOKENS — nao versionar.`,
  `-- Linhas: ${TABELAS.map((t) => `${t}=${dados[t].length}`).join(", ")}`,
  "",
  "BEGIN;",
  `SET search_path = ${schema}, extensions, public;`,
  "",
  ...COM_TRIGGER.map((t) => `ALTER TABLE ${schema}.${t} DISABLE TRIGGER USER;`),
  "",
];

for (const t of TABELAS) {
  let linhas = dados[t];
  if (!linhas.length) continue;
  // A resposta ainda nao existe quando a pesquisa entra: vinculo refeito no fim.
  if (t === "pesquisas_nps") linhas = linhas.map(({ resposta_id, ...resto }) => resto);
  const fora = new Set(CALCULADAS[t] || []);
  const colunas = Object.keys(linhas[0]).filter((k) => !fora.has(k));
  linhas = linhas.map((l) => Object.fromEntries(colunas.map((k) => [k, l[k]])));
  const lista = colunas.map((k) => `"${k}"`).join(", ");
  partes.push(
    `INSERT INTO ${schema}.${t} (${lista})`,
    `  SELECT ${lista} FROM json_populate_recordset(null::${schema}.${t}, ${json(linhas)});`,
    ""
  );
}

const vinculos = dados.pesquisas_nps
  .filter((p) => p.resposta_id)
  .map((p) => ({ id: p.id, resposta_id: p.resposta_id }));
if (vinculos.length) {
  partes.push(
    `UPDATE ${schema}.pesquisas_nps p SET resposta_id = x.resposta_id`,
    `  FROM json_to_recordset(${json(vinculos)}) AS x(id uuid, resposta_id uuid)`,
    ` WHERE p.id = x.id;`,
    ""
  );
}

partes.push(
  ...COM_TRIGGER.map((t) => `ALTER TABLE ${schema}.${t} ENABLE TRIGGER USER;`),
  "",
  "COMMIT;",
  ""
);

const pasta = path.join(RAIZ, "backup");
fs.mkdirSync(pasta, { recursive: true });
const arquivo = path.join(pasta, `dados-${schema}-${hoje}.sql`);
fs.writeFileSync(arquivo, partes.join("\n"));
console.log(`\n  ${verde("✔")} ${path.relative(RAIZ, arquivo)} (${(fs.statSync(arquivo).size / 1024).toFixed(0)} KB)\n`);
