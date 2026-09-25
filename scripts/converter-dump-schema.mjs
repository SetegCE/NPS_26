// Converte SQL escrito para o schema public (Supabase) para o schema do NPS no
// servidor proprio (padrao da casa: banco 7station, um schema por sistema).
//
// Usado de dois jeitos:
//  - por scripts/restaurar-banco.mjs, que converte em memoria e ja carrega;
//  - pela linha de comando, gerando arquivos ".<schema>.sql" para conferir:
//      node scripts/converter-dump-schema.mjs estrutura.sql dados.sql [schema=nps]
//      node scripts/converter-dump-schema.mjs migration.sql - [schema=nps]   (so estrutura)
//
// Na ESTRUTURA a troca e ampla (tabelas, views, funcoes): "public." vira
// "<schema>.", o search_path fixado nas funcoes passa a apontar para o schema
// novo (mantendo extensions e public no fim, para achar o pgcrypto), e os
// papeis do Supabase (anon/authenticated/service_role) saem dos GRANT/REVOKE.
//
// Num arquivo de DADOS do pg_dump, "public." pode aparecer dentro de um
// comentario de cliente ou de uma descricao da auditoria: la so a linha
// "COPY public.tabela" e trocada, e o conteudo das linhas nunca e tocado.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function validarSchema(schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Schema invalido: ${schema}`);
  return schema;
}

/** Estrutura/migration do schema public -> schema `schema`. */
export function converterEstrutura(texto, schema = "nps") {
  validarSchema(schema);

  // O schema public ja existe em qualquer banco: nao recriar nem comentar.
  let sql = texto
    .split(/\r?\n/)
    .filter((l) => !/^(CREATE SCHEMA public;|COMMENT ON SCHEMA public IS)/.test(l))
    .join("\n");

  sql = sql.replace(/\bpublic\./g, `${schema}.`);
  sql = sql.replace(
    /SET search_path TO 'public', 'extensions'/gi,
    `SET search_path TO '${schema}', 'extensions', 'public'`
  );
  sql = sql.replace(/SET search_path TO 'public'/gi, `SET search_path TO '${schema}', 'extensions', 'public'`);
  // Forma sem aspas, usada nas migrations escritas a mao (ex.: a 13) e no topo
  // de banco/estrutura.sql.
  sql = sql.replace(/set search_path = public\b/gi, `set search_path = ${schema}, extensions, public`);

  // anon/authenticated/service_role sao papeis do Supabase: num Postgres comum
  // nao existem e o GRANT/REVOKE falha. Saem da lista; se sobrar ninguem, a
  // linha vira comentario (no servidor so o app acessa o banco).
  const PAPEIS_SUPABASE = /\b(anon|authenticated|service_role)\b/i;
  sql = sql
    .split("\n")
    .map((l) => {
      const m = l.match(/^(\s*(?:grant|revoke)\b.*?\b(?:to|from)\s+)(.+?)(;?\s*)$/i);
      if (!m || !PAPEIS_SUPABASE.test(m[2])) return l;
      const resto = m[2]
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p && !PAPEIS_SUPABASE.test(p));
      return resto.length ? `${m[1]}${resto.join(", ")}${m[3]}` : `-- (papel do Supabase) ${l.trim()}`;
    })
    .join("\n");

  sql =
    `-- Convertido para o schema "${schema}" por scripts/converter-dump-schema.mjs\n` +
    `CREATE SCHEMA IF NOT EXISTS ${schema};\n` +
    `CREATE SCHEMA IF NOT EXISTS extensions;\n\n` +
    sql;

  // Sobra de "public" que nao seja o search_path ja tratado: conferir a mao.
  // ("from public"/"to public" em GRANT/REVOKE e o papel PUBLIC, nao o schema.)
  const sobras = sql
    .split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(
      ({ l }) =>
        /\bpublic\b/.test(l) &&
        !/extensions'?, '?public/.test(l) &&
        !/\b(from|to) public\b/i.test(l) &&
        !/^--/.test(l.trim())
    );

  return { sql, sobras };
}

/** Dados do pg_dump (COPY public.x) -> schema `schema`, sem tocar no conteudo. */
export function converterDados(texto, schema = "nps") {
  validarSchema(schema);
  let tabelas = 0;
  const sql = texto
    .split(/\r?\n/)
    .map((l) => {
      if (/^COPY public\./.test(l)) {
        tabelas++;
        return l.replace(/^COPY public\./, `COPY ${schema}.`);
      }
      if (/^SELECT pg_catalog\.setval\('public\./.test(l)) return l.replace("'public.", `'${schema}.`);
      return l;
    })
    .join("\n");
  return { sql, tabelas };
}

// ── Linha de comando ────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [estrutura, dados, schema = "nps"] = process.argv.slice(2);
  if (!estrutura || !dados) {
    console.error("Uso: node scripts/converter-dump-schema.mjs estrutura.sql dados.sql|- [schema=nps]");
    process.exit(1);
  }
  const saida = (arq) => arq.replace(/\.sql$/i, "") + `.${schema}.sql`;

  const e = converterEstrutura(fs.readFileSync(estrutura, "utf8"), schema);
  fs.writeFileSync(saida(estrutura), e.sql);
  console.log(`\n  Estrutura -> ${saida(estrutura)}`);

  if (dados !== "-") {
    const d = converterDados(fs.readFileSync(dados, "utf8"), schema);
    fs.writeFileSync(saida(dados), d.sql);
    console.log(`  Dados     -> ${saida(dados)} (${d.tabelas} tabelas)`);
  }

  if (e.sobras.length) {
    console.log(`\n  Conferir estas linhas, que ainda citam "public":`);
    for (const s of e.sobras.slice(0, 30)) console.log(`    ${s.n}: ${s.l.trim().slice(0, 140)}`);
  } else {
    console.log(`\n  Nenhuma referencia a "public" sobrou fora do search_path.`);
  }
  console.log("");
}
