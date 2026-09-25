// Confere se as credenciais do .env.local realmente funcionam contra o banco.
// Diz exatamente o que está errado, em vez de deixar o login falhar sem pista.
//
//   npm run check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const amarelo = (t) => `\x1b[33m${t}\x1b[0m`;
const ciano = (t) => `\x1b[36m${t}\x1b[0m`;

function carregarEnv() {
  for (const arquivo of ['.env.local', '.env']) {
    const caminho = path.join(RAIZ, arquivo);
    if (!fs.existsSync(caminho)) continue;
    for (const linha of fs.readFileSync(caminho, 'utf8').split(/\r?\n/)) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#')) continue;
      const i = limpa.indexOf('=');
      if (i < 1) continue;
      let valor = limpa.slice(i + 1).trim();
      if (/^".*"$|^'.*'$/.test(valor)) valor = valor.slice(1, -1);
      if (valor) process.env[limpa.slice(0, i).trim()] = valor;
    }
    return arquivo;
  }
  return null;
}

function falhar(titulo, ...detalhes) {
  console.log('');
  console.log(`  ${vermelho('✖')} ${titulo}`);
  for (const d of detalhes) console.log(`    ${d}`);
  console.log('');
  process.exit(1);
}

console.log('');
console.log('  Verificando configuração...');

const origem = carregarEnv();
if (!origem) {
  falhar('Não existe .env.local.', `Crie com: ${ciano('cp .env.example .env.local')}`);
}
console.log(`    origem: ${origem}`);

const url = process.env.SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
const segredo = process.env.NPS_SESSION_SECRET;

if (!segredo) {
  falhar(
    'NPS_SESSION_SECRET não está definida.',
    `Gere uma: ${ciano('node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"')}`,
  );
}

// ---- Modo Postgres direto (servidor próprio) --------------------------------
// Com DATABASE_URL, o sistema ignora SUPABASE_* (ver lib/db.ts). Confere a
// conexão, as extensões de que as funções dependem e se há conta de PMO.
if (process.env.DATABASE_URL) {
  const { default: pg } = await import('pg');
  const schema = process.env.DATABASE_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) falhar(`DATABASE_SCHEMA inválido: ${schema}`);
  const cliente = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    options: schema === 'public' ? undefined : `-c search_path=${schema},extensions,public`,
  });
  console.log(`    modo:   Postgres direto (DATABASE_URL), schema ${schema}`);
  console.log('');
  console.log('  Testando acesso ao banco...');
  try {
    await cliente.connect();
  } catch (e) {
    falhar('Não foi possível conectar ao Postgres.', e.message, 'Confira DATABASE_URL e DATABASE_SSL.');
  }
  const q = async (sql, v = []) => (await cliente.query(sql, v)).rows;
  const [versao] = await q('show server_version');
  console.log(`    ${verde('✔')} conectado (PostgreSQL ${versao.server_version})`);

  const ext = (await q("select extname from pg_extension")).map((r) => r.extname);
  for (const e of ['pgcrypto', 'uuid-ossp']) {
    if (!ext.includes(e)) falhar(`Extensão ${e} não instalada.`, 'As funções nps_* dependem dela (schema extensions).');
  }
  console.log(`    ${verde('✔')} extensões pgcrypto e uuid-ossp`);

  const [{ n: tabelas }] = await q(
    "select count(*)::int n from information_schema.tables where table_schema=$1 and table_name like '%_nps'",
    [schema]
  );
  if (!tabelas) falhar('Nenhuma tabela *_nps encontrada.', 'O banco foi restaurado?');
  const [{ n: funcoes }] = await q(
    "select count(*)::int n from pg_proc where pronamespace=$1::regnamespace and proname like 'nps_%'",
    [schema]
  );
  console.log(`    ${verde('✔')} ${tabelas} tabelas *_nps e ${funcoes} funções nps_*`);

  const contas = await q("select papel from usuarios_nps where ativo");
  const pmo = contas.filter((c) => c.papel === 'pmo').length;
  if (!contas.length) console.log(`    ${amarelo('!')} nenhuma conta ativa em usuarios_nps — ninguém consegue entrar`);
  else console.log(`    ${verde('✔')} ${contas.length} conta(s) ativa(s), ${pmo} com acesso total`);

  await cliente.end();
  console.log('');
  console.log(`  ${verde('Tudo certo.')} Rode ${ciano('npm run dev')}.`);
  console.log('');
  process.exit(0);
}

if (!url) falhar('SUPABASE_URL não está definida.');
if (!chave) {
  falhar(
    'SUPABASE_SERVICE_ROLE_KEY está vazia.',
    'Painel do Supabase → Project Settings → API Keys → service_role (secret).',
    `Projeto: ${ciano(url)}`,
  );
}

// A chave publicável é um engano comum: ela não serve para a API.
if (/^sb_publishable_/.test(chave) || /^sb_anon/.test(chave)) {
  falhar(
    'A chave informada é a PUBLICÁVEL, não a de serviço.',
    'A publicável (sb_publishable_...) não consegue escrever nem chamar as',
    'funções de negócio. Use a marcada como "service_role (secret)".',
  );
}

console.log(`    URL:    ${url}`);
console.log(`    chave:  ${chave.slice(0, 12)}… (${chave.length} caracteres)`);
console.log(`    sessão: definida (${segredo.length} caracteres)`);

// ---- Teste real contra o banco ----------------------------------------------

async function consultar(caminho) {
  return fetch(`${url}/rest/v1/${caminho}`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
}

console.log('');
console.log('  Testando acesso ao banco...');

let resposta;
try {
  resposta = await consultar('projetos_nps?select=id&limit=1');
} catch (e) {
  falhar('Não foi possível alcançar o Supabase.', e.message, 'Verifique sua conexão e a SUPABASE_URL.');
}

if (resposta.status === 401) {
  falhar('A chave foi recusada (401).', 'Ela pode estar incompleta, expirada ou ser de outro projeto.');
}
if (!resposta.ok) {
  falhar(`O banco respondeu ${resposta.status}.`, (await resposta.text()).slice(0, 300));
}

console.log(`    ${verde('✔')} leitura de projetos_nps`);

// Só a service_role enxerga as tabelas novas (RLS fechada para as demais).
const mestre = await consultar('projetos_mestre_nps?select=id&limit=1');
if (!mestre.ok) {
  falhar(
    'A chave lê as tabelas antigas, mas não as novas.',
    'Isso indica chave publicável em vez de service_role.',
  );
}
console.log(`    ${verde('✔')} leitura das tabelas do módulo PMO`);

// Confere se há conta de acesso cadastrada, senão ninguém entra.
// O login deixou de usar config_acesso/acessos_lideres: agora é usuarios_nps
// (migration 15), com e-mail e senha por pessoa.
const contas = await consultar('usuarios_nps?select=papel,ativo&ativo=eq.true');
const usuarios = contas.ok ? await contas.json() : [];
const comPmo = usuarios.filter((u) => u.papel === 'pmo').length;

if (!usuarios.length) {
  console.log(`    ${amarelo('!')} nenhuma conta ativa em usuarios_nps — ninguém consegue entrar`);
  console.log(`      Rode ${ciano('node scripts/seed-usuarios.mjs --aplicar')}`);
} else if (!comPmo) {
  // Sem PMO não há quem administre: cadastros, ciclos e auditoria ficam
  // inalcançáveis, e não existe tela para promover ninguém.
  console.log(`    ${amarelo('!')} ${usuarios.length} conta(s), mas nenhuma com papel 'pmo'`);
} else {
  console.log(`    ${verde('✔')} ${usuarios.length} conta(s) ativa(s), ${comPmo} com acesso total`);
}

// Senha em claro no banco é falha de segurança, não detalhe.
const fora = await consultar('usuarios_nps?select=id&senha_hash=not.like.scrypt$*');
const semHash = fora.ok ? (await fora.json()).length : 0;
if (semHash) {
  console.log(`    ${vermelho('✖')} ${semHash} conta(s) com senha fora do formato scrypt`);
}

console.log('');
console.log(`  ${verde('Tudo certo.')} Rode ${ciano('npm run dev')} e acesse http://localhost:3000`);
console.log('');
