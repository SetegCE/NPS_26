// Refaz, com os dados reais, a conta que o dashboard faz para um ciclo:
// busca as mesmas linhas que /api/dashboard busca e passa pelas mesmas funcoes
// de lib/dashboard.ts. Mostra quantos projetos casam pelo id e pelo codigo.
// So le; nao altera nada.
//
// Uso: node --import ./tests/alias.mjs scripts/conferir-dashboard.mjs 2026.2
import pg from "pg";
import { carregarEnv } from "./comum.mjs";
import { calcularMetricas, comLiderAtual, processarRespostas } from "../lib/dashboard.ts";

carregarEnv();
const ciclo = process.argv[2];
if (!ciclo) {
  console.log("Informe o ciclo. Ex.: 2026.2");
  process.exit(1);
}
const schema = process.env.DATABASE_SCHEMA || "public";
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});
await c.connect();
await c.query(`set search_path to ${schema}`);

const projetos = comLiderAtual(
  (await c.query(`select ciclo, ciclo_id, codigo_clockify, cliente, projeto, lider,
                         classe_contratual, tipo_servico, segmento_cliente, elegivel, ativo, projeto_id
                    from projetos_nps where ativo`)).rows
);
const brutas = (await c.query(`select * from respostas_nps where ciclo = $1`, [ciclo])).rows;
await c.end();

const respostas = processarRespostas(brutas, projetos).filter((r) => r.ciclo === ciclo);
const doCiclo = projetos.filter((p) => p.ciclo === ciclo);
const m = calcularMetricas(respostas, doCiclo);

const comIds = brutas.filter((r) => r.projeto_id && r.ciclo_id).length;
console.log(`
Ciclo ${ciclo}
  respostas no banco ............ ${brutas.length}  (com projeto_id e ciclo_id: ${comIds})
  respostas ligadas a projeto ... ${respostas.filter((r) => !r.semProjeto).length}
  projetos respondidos .......... ${m.projetosRespondidos} / ${m.totalProjetos}  (${m.percentualProjetos}%)
`);
const soltas = respostas.filter((r) => r.semProjeto);
if (soltas.length) {
  console.log("Respostas sem projeto (exemplos):");
  console.table(soltas.slice(0, 10).map((r) => ({ codigo: r.codigo_clockify, projeto: r.projeto, ciclo: r.ciclo })));
  const ex = brutas.find((b) => String(b.id) === soltas[0].id);
  console.log("tipos de projeto_id / ciclo_id na resposta:", typeof ex?.projeto_id, typeof ex?.ciclo_id);
  console.log("tipos na participacao:", typeof projetos[0]?.projeto_id, typeof projetos[0]?.ciclo_id);
}
