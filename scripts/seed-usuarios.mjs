// Cria e atualiza as contas de acesso a partir de secrets/usuarios-iniciais.json.
//
//   node scripts/seed-usuarios.mjs            # simulação
//   node scripts/seed-usuarios.mjs --aplicar  # grava
//
// ── O que ele garante ─────────────────────────────────────────────────────
//
//  - a senha é derivada com scrypt AQUI e só o hash chega ao banco. Nenhuma
//    senha em claro atravessa a rede nem fica no Postgres;
//  - nenhuma senha aparece na saída do terminal, nem mascarada. Terminal vira
//    histórico de shell, e histórico de shell vaza;
//  - é idempotente: rodar de novo redefine a senha de quem está no arquivo e
//    não toca em mais nada.
//
// Enquanto não existe tela de gestão de acessos, este script é o caminho para
// criar conta e para atender a um "esqueci minha senha".

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO = path.join(RAIZ, "secrets", "usuarios-iniciais.json");
const APLICAR = process.argv.includes("--aplicar");

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const amarelo = (t) => `\x1b[33m${t}\x1b[0m`;
const ciano = (t) => `\x1b[36m${t}\x1b[0m`;
const cinza = (t) => `\x1b[90m${t}\x1b[0m`;

function morrer(...linhas) {
  console.log("");
  for (const l of linhas) console.log(`  ${l}`);
  console.log("");
  process.exit(1);
}

// ── Ambiente ────────────────────────────────────────────────────────────────

for (const arquivo of [".env.local", ".env"]) {
  const caminho = path.join(RAIZ, arquivo);
  if (!fs.existsSync(caminho)) continue;
  for (const linha of fs.readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i < 1) continue;
    let v = l.slice(i + 1).trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    if (v) process.env[l.slice(0, i).trim()] = v;
  }
  break;
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  morrer(`${vermelho("✖")} Falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local`);
}
if (!fs.existsSync(ARQUIVO)) {
  morrer(
    `${vermelho("✖")} Não encontrei ${cinza("secrets/usuarios-iniciais.json")}`,
    `Veja o formato em ${ciano("secrets/README.md")}.`
  );
}

const cabecalhos = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function db(caminho, opcoes = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: { ...cabecalhos, ...opcoes.headers },
    body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${caminho} -> ${r.status} ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

// ── scrypt — mesmo formato de lib/senha.ts ─────────────────────────────────

const derivar = (senha, sal, tamanho) =>
  new Promise((ok, falha) =>
    crypto.scrypt(senha, sal, tamanho, (e, d) => (e ? falha(e) : ok(d)))
  );

async function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const derivada = await derivar(String(senha), sal, 64);
  return `scrypt$${sal.toString("base64")}$${derivada.toString("base64")}`;
}

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Execução ────────────────────────────────────────────────────────────────

async function principal() {
  const { usuarios } = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  if (!Array.isArray(usuarios) || !usuarios.length) {
    morrer(`${vermelho("✖")} O arquivo não tem a lista "usuarios".`);
  }

  console.log("");
  console.log(`  ${APLICAR ? vermelho("MODO GRAVAÇÃO") : amarelo("SIMULAÇÃO")}`);
  if (!APLICAR) console.log(`  ${cinza("Nada será gravado. Use --aplicar para valer.")}`);
  console.log("");

  // Validação inteira ANTES de gravar qualquer coisa: melhor recusar o
  // arquivo do que criar metade das contas e parar no meio.
  const [lideres, existentes] = await Promise.all([
    db("lideres_nps?select=id,nome"),
    db("usuarios_nps?select=id,email,email_norm,papel"),
  ]);
  const porLider = new Map(lideres.map((l) => [norm(l.nome), l]));
  const porEmail = new Map(existentes.map((u) => [u.email_norm, u]));

  const problemas = [];
  const vistos = new Set();

  for (const u of usuarios) {
    const onde = u.email || u.nome || "(sem identificação)";
    if (!u.nome?.trim()) problemas.push(`${onde}: falta "nome"`);
    if (!u.email || !RE_EMAIL.test(u.email.trim())) problemas.push(`${onde}: e-mail inválido`);
    if (!u.senha) problemas.push(`${onde}: falta "senha"`);
    if (!["pmo", "lider"].includes(u.papel)) {
      problemas.push(`${onde}: papel deve ser "pmo" ou "lider", veio "${u.papel}"`);
    }

    const email = String(u.email ?? "").trim().toLowerCase();
    if (vistos.has(email)) problemas.push(`${onde}: e-mail repetido no arquivo`);
    vistos.add(email);

    // Um líder sem vínculo não enxergaria projeto nenhum — é melhor recusar
    // o arquivo do que criar uma conta que abre num painel vazio.
    if (u.papel === "lider") {
      if (!u.lider) problemas.push(`${onde}: papel "lider" exige o campo "lider"`);
      else if (!porLider.has(norm(u.lider))) {
        problemas.push(`${onde}: líder "${u.lider}" não existe em lideres_nps`);
      }
    }
  }

  if (problemas.length) {
    console.log(`  ${vermelho(`${problemas.length} problema(s) — nada foi gravado:`)}`);
    for (const p of problemas) console.log(`    - ${p}`);
    console.log("");
    process.exit(1);
  }

  let criados = 0;
  let atualizados = 0;

  for (const u of usuarios) {
    const email = u.email.trim().toLowerCase();
    const atual = porEmail.get(email);
    const liderId = u.papel === "lider" ? porLider.get(norm(u.lider)).id : null;
    const acao = atual ? "atualizar" : "criar";

    // O hash é gerado mesmo na simulação: é o que confirma que a senha do
    // arquivo é derivável, sem gravar nada.
    const senha_hash = await gerarHash(u.senha);

    console.log(
      `  ${atual ? amarelo("~") : verde("+")} ${u.nome.padEnd(44)} ${cinza(email.padEnd(30))} ${u.papel}${u.lider ? cinza(` → ${u.lider}`) : ""}`
    );

    if (!APLICAR) {
      if (atual) atualizados += 1;
      else criados += 1;
      continue;
    }

    const registro = {
      nome: u.nome.trim(),
      email,
      senha_hash,
      papel: u.papel,
      lider_id: liderId,
      ativo: true,
    };

    if (atual) {
      await db(`usuarios_nps?id=eq.${atual.id}`, { method: "PATCH", body: registro });
      atualizados += 1;
    } else {
      await db("usuarios_nps", { method: "POST", body: registro });
      criados += 1;
    }
  }

  console.log("");
  console.log(`  ${criados} conta(s) a criar · ${atualizados} a atualizar (senha redefinida)`);

  if (APLICAR) {
    console.log("");
    console.log(`  ${verde("✔")} Gravado. Nenhuma senha em claro foi para o banco.`);
    console.log(
      `  ${amarelo("Distribua cada senha pela pessoa e apague")} ${ciano("secrets/usuarios-iniciais.json")}${amarelo(".")}`
    );
  } else {
    console.log(`  ${amarelo("Simulação.")} Rode de novo com ${ciano("--aplicar")} para gravar.`);
  }
  console.log("");
}

principal().catch((e) => morrer(`${vermelho("✖")} ${e.message}`));
