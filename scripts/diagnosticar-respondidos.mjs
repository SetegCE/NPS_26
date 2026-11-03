// Diagnostico do KPI "Projetos Respondidos": por que respostas de um ciclo nao
// viram projeto respondido. So le; nao altera nada.
//
// Uso: node scripts/diagnosticar-respondidos.mjs [ciclo]   (ex.: 2026.2)
import pg from "pg";
import { carregarEnv } from "./comum.mjs";

carregarEnv();
const schema = process.env.DATABASE_SCHEMA || "public";
const ciclo = process.argv[2] || null;
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});
await c.connect();
await c.query(`set search_path to ${schema}`);
const q = async (titulo, sql, p = []) => {
  console.log(`\n== ${titulo}`);
  console.table((await c.query(sql, p)).rows);
};

await q("Respostas por ciclo x casamento com projetos_nps (ativo)", `
  select r.ciclo, count(*) respostas,
         count(*) filter (where r.nota_q4 between 0 and 10) validas,
         count(distinct r.codigo_clockify) codigos_distintos,
         count(distinct pn.codigo_clockify) projetos_casados,
         count(*) filter (where pn.codigo_clockify is null) respostas_sem_casar
    from respostas_nps r
    left join projetos_nps pn
      on pn.ciclo = r.ciclo and pn.ativo
     and upper(trim(pn.codigo_clockify)) = upper(trim(r.codigo_clockify))
   where ($1::text is null or r.ciclo = $1)
   group by r.ciclo order by r.ciclo desc nulls first`, [ciclo]);

await q("Projetos do ciclo (denominador)", `
  select ciclo, count(*) filter (where ativo) ativos,
         count(*) filter (where ativo and elegivel) elegiveis
    from projetos_nps where ($1::text is null or ciclo = $1)
   group by ciclo order by ciclo desc`, [ciclo]);

await q("Respostas por projeto (quantas respostas cada projeto recebeu)", `
  select r.ciclo, r.codigo_clockify, max(r.projeto) projeto, count(*) respostas,
         count(distinct r.respondente_id) respondentes,
         bool_or(pn.codigo_clockify is not null) casa_com_projeto,
         bool_or(pn.elegivel) elegivel
    from respostas_nps r
    left join projetos_nps pn
      on pn.ciclo = r.ciclo and pn.ativo
     and upper(trim(pn.codigo_clockify)) = upper(trim(r.codigo_clockify))
   where ($1::text is null or r.ciclo = $1)
   group by r.ciclo, r.codigo_clockify order by r.ciclo desc, respostas desc`, [ciclo]);

await q("Respostas que NAO casam pelo codigo, com o motivo", `
  select r.ciclo, r.codigo_clockify codigo_da_resposta, r.projeto, r.identificador,
         pid.codigo_clockify codigo_no_ciclo, pid.ativo participacao_ativa,
         case
           when r.nota_q4 is null then 'sem nota Q4'
           when r.ciclo is null then 'resposta sem ciclo'
           when pid.id is null then 'projeto nao esta no ciclo'
           when not pid.ativo then 'projeto retirado do ciclo'
           when upper(trim(pid.codigo_clockify)) <> upper(trim(r.codigo_clockify))
             then 'codigo mudou (corrigido pelo vinculo por id)'
           else 'outro'
         end motivo
    from respostas_nps r
    left join projetos_nps pid on pid.projeto_id = r.projeto_id and pid.ciclo_id = r.ciclo_id
   where ($1::text is null or r.ciclo = $1)
     and not exists (select 1 from projetos_nps pn
                      where pn.ciclo = r.ciclo and pn.ativo
                        and upper(trim(pn.codigo_clockify)) = upper(trim(r.codigo_clockify)))
   order by motivo, r.ciclo, r.projeto`, [ciclo]);

await c.end();
