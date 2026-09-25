// Peças que os scripts de manutenção compartilham: ambiente, acesso ao banco
// e leitura da planilha. Ficam aqui para que "o que é uma linha válida da
// planilha" tenha uma definição só — dois scripts com regras parecidas mas
// não idênticas é como um deles passa a enxergar projetos que o outro não vê.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const verde = (t) => `\x1b[32m${t}\x1b[0m`;
export const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
export const amarelo = (t) => `\x1b[33m${t}\x1b[0m`;
export const ciano = (t) => `\x1b[36m${t}\x1b[0m`;
export const cinza = (t) => `\x1b[90m${t}\x1b[0m`;

// ── Ambiente ────────────────────────────────────────────────────────────────

export function carregarEnv() {
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
    return arquivo;
  }
  return null;
}

/** Carrega o .env e devolve {db, rpc} já autenticados. Aborta se faltar chave. */
export function conectar() {
  carregarEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log(`\n  ${vermelho("✖")} Falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local\n`);
    process.exit(1);
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

  const rpc = (funcao, args) => db(`rpc/${funcao}`, { method: "POST", body: args });

  return { db, rpc };
}

// ── Leitura da planilha ─────────────────────────────────────────────────────

/** Normalização canônica — a mesma de public.nps_norm() e de lib/dashboard.ts. */
export const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/**
 * Chave de comparacao do codigo do projeto — mesma regra de lib/clockrview.ts.
 * A planilha escreve "#0221-2-2025"; o Clockrview (e o banco, depois da
 * sincronizacao) escreve "0221-02-2025". Sao o mesmo projeto.
 */
export const chaveCodigo = (v) =>
  String(v ?? "")
    .replace(/[^0-9-]/g, "")
    .split("-")
    .filter(Boolean)
    .map((p) => String(parseInt(p, 10)))
    .join("-");

export function lerPlanilha(arquivo) {
  // windows-1252, não utf-8: o Excel exporta assim e "LICENÇAS" chegaria
  // corrompido se fosse lido como utf-8.
  const texto = new TextDecoder("windows-1252").decode(fs.readFileSync(arquivo));
  const linhas = texto.split(/\r?\n/);

  const esperado = ["CLIENTE", "SEGMENTO DO CLIENTE", "LIDER", "VENDEDOR", "CÓDIGO DO PROJETO", "ACESSO", "PROJETO", "ESCOPO GERAL", "STATUS"];
  const cabecalho = linhas[0].split(";").map((c) => c.trim());
  for (let i = 0; i < esperado.length; i += 1) {
    if (norm(cabecalho[i]) !== norm(esperado[i])) {
      throw new Error(
        `Coluna ${i + 1} deveria ser "${esperado[i]}" e veio "${cabecalho[i]}". ` +
          `A planilha mudou de formato — confira antes de importar.`
      );
    }
  }

  const campo = (v) => {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    return !t || t === "-" ? null : t;
  };

  const registros = [];
  for (let i = 1; i < linhas.length; i += 1) {
    if (!linhas[i] || /^[;\s-]*$/.test(linhas[i])) continue;
    const c = linhas[i].split(";");
    const r = {
      linha: i + 1,
      cliente: campo(c[0]),
      segmento: campo(c[1]),
      lider: campo(c[2]),
      vendedor: campo(c[3]),
      codigo: campo(c[4]),
      acesso: campo(c[5]),
      projeto: campo(c[6]),
      escopo: campo(c[7]),
      // "SATAND BY" é como a planilha grafa standby. Aceito as duas formas
      // para que corrigir o typo lá não quebre a importação aqui.
      status: /^SATAND ?BY$|^STAND ?BY$|^STANDBY$/.test(norm(c[8])) ? "standby" : "ativo",
    };
    if (!r.cliente) continue;
    if (!r.codigo || !r.projeto) {
      throw new Error(`Linha ${r.linha}: falta CÓDIGO DO PROJETO ou PROJETO (${r.cliente}).`);
    }
    registros.push(r);
  }

  const vistos = new Map();
  for (const r of registros) {
    const k = norm(r.codigo);
    if (vistos.has(k)) {
      throw new Error(`Código ${r.codigo} repetido nas linhas ${vistos.get(k)} e ${r.linha}.`);
    }
    vistos.set(k, r.linha);
  }

  return registros;
}

/** O caminho do CSV vindo da linha de comando, já conferido. */
export function csvDoArgumento(argumentos, exemplo) {
  const origem = argumentos.find((a) => !a.startsWith("--"));
  if (!origem) {
    console.log(`\n  Informe o caminho do CSV:\n`);
    console.log(`     ${ciano(exemplo)}\n`);
    process.exit(1);
  }
  if (!fs.existsSync(origem)) {
    console.log(`\n  ${vermelho("✖")} Arquivo não encontrado: ${origem}\n`);
    process.exit(1);
  }
  return origem;
}
