// Faz a lista de participantes de um ciclo bater com a planilha.
//
//   node scripts/sincronizar-ciclo.mjs "caminho/CLIENTES_ATIVOS.csv" --ciclo=2026.2
//   node scripts/sincronizar-ciclo.mjs "caminho/CLIENTES_ATIVOS.csv" --ciclo=2026.2 --aplicar
//   ... --aplicar --incluir     # tambem coloca no ciclo os que faltam
//
// ── Por que este script existe ─────────────────────────────────────────────
//
// A lista de participantes de 2026.2 foi montada antes da planilha entrar no
// banco. Ficou com projetos de edicoes antigas (#0006-4-2024 ao lado do
// #0006-5-2025 que os substituiu), e o dashboard passou a mostrar mais
// projeto do que a empresa tem em contrato.
//
// ── O que ele faz, e o que NAO faz ─────────────────────────────────────────
//
// RETIRA do ciclo o projeto que nao esta na planilha. Retirar aqui e o mesmo
// que o PMO faz na tela: nps_definir_participacao_ciclo com participar=false,
// que marca ativo=false e registra na auditoria. A linha continua no banco,
// com tudo que ela carrega, e voltar e so marcar de novo.
//
// NUNCA toca em resposta. E mais: se o projeto fora da planilha TEM resposta
// naquele ciclo, ele nao e retirado. Tirar a participacao de um projeto que
// ja respondeu deixaria a resposta orfa do cadastro, e o numero do ciclo
// mudaria de lugar sem ninguem ter pedido.
//
// So INCLUI com --incluir, separado do --aplicar. Colocar projeto em ciclo
// aberto e decidir que aquele cliente vai ser pesquisado; quem decide isso e
// o PMO, na tela de Operacao de Ciclo. A flag existe para o caso de virar
// trabalho manual demais, e mesmo assim ela pede o gesto explicito.
//
// Ciclo encerrado e recusado: o passado nao se reescreve.

import {
  verde,
  vermelho,
  amarelo,
  ciano,
  cinza,
  conectar,
  chaveCodigo,
  lerPlanilha,
  csvDoArgumento,
} from "./comum.mjs";

const ATOR = "SINCRONIZACAO PLANILHA";

const argumentos = process.argv.slice(2);
const APLICAR = argumentos.includes("--aplicar");
const INCLUIR = argumentos.includes("--incluir");
const CICLO = (argumentos.find((a) => a.startsWith("--ciclo=")) || "").slice(8).trim();
const ORIGEM = csvDoArgumento(
  argumentos,
  'node scripts/sincronizar-ciclo.mjs "C:/.../CLIENTES_ATIVOS.csv" --ciclo=2026.2'
);

if (!CICLO) {
  console.log(`\n  ${vermelho("✖")} Informe o ciclo: ${ciano("--ciclo=2026.2")}\n`);
  process.exit(1);
}

const { db, rpc } = conectar();

const q = (v) => encodeURIComponent(v);

async function principal() {
  console.log("");
  console.log(
    `  ${APLICAR ? vermelho("MODO GRAVAÇÃO") : amarelo("SIMULAÇÃO")}  ciclo ${ciano(CICLO)}`
  );
  if (!APLICAR) console.log(`  ${cinza("Nada será gravado. Use --aplicar para valer.")}`);
  console.log("");

  const [ciclo] = await db(`ciclos_nps?select=id,codigo,status&codigo=eq.${q(CICLO)}`);
  if (!ciclo) {
    console.log(`  ${vermelho("✖")} Ciclo ${CICLO} não existe no banco.\n`);
    process.exit(1);
  }
  if (ciclo.status === "encerrado") {
    console.log(`  ${vermelho("✖")} Ciclo ${CICLO} está encerrado — não se mexe no passado.\n`);
    process.exit(1);
  }

  const daPlanilha = new Map();
  for (const r of lerPlanilha(ORIGEM)) daPlanilha.set(chaveCodigo(r.codigo), r);

  const [participacoes, respostas, mestres] = await Promise.all([
    db(
      `projetos_nps?select=id,projeto_id,codigo_clockify,cliente,projeto,lider,ativo&ciclo_id=eq.${ciclo.id}`
    ),
    db(`respostas_nps?select=codigo_clockify&ciclo=eq.${q(CICLO)}`),
    db(`projetos_mestre_nps?select=id,codigo_clockify,nome,ativo`),
  ]);

  const respondeuNoCiclo = new Set(respostas.map((r) => chaveCodigo(r.codigo_clockify)));
  const mestrePorCodigo = new Map(mestres.map((m) => [chaveCodigo(m.codigo_clockify), m]));

  const ativos = participacoes.filter((p) => p.ativo !== false);

  const retirar = [];
  const protegidos = [];
  for (const p of ativos) {
    const codigo = chaveCodigo(p.codigo_clockify);
    if (daPlanilha.has(codigo)) continue;
    (respondeuNoCiclo.has(codigo) ? protegidos : retirar).push(p);
  }

  const noCiclo = new Set(ativos.map((p) => chaveCodigo(p.codigo_clockify)));
  const faltando = [];
  const semCadastro = [];
  for (const [codigo, r] of daPlanilha) {
    if (noCiclo.has(codigo)) continue;
    const m = mestrePorCodigo.get(codigo);
    if (!m) semCadastro.push(r);
    else faltando.push({ mestre: m, planilha: r });
  }

  console.log(`  planilha: ${daPlanilha.size} projetos · ciclo ${CICLO}: ${ativos.length} ativos`);
  console.log("");

  if (protegidos.length) {
    console.log(`  ${amarelo("MANTIDOS")} — fora da planilha, mas já responderam neste ciclo:`);
    for (const p of protegidos) {
      console.log(`    ${cinza(`${p.codigo_clockify} — ${p.cliente} / ${p.lider}`)}`);
    }
    console.log("");
  }

  if (retirar.length) {
    console.log(`  ${vermelho("RETIRAR")} do ciclo ${CICLO} (${retirar.length}) — nada é apagado:`);
    for (const p of retirar.sort((a, b) => a.codigo_clockify.localeCompare(b.codigo_clockify))) {
      console.log(`    ${p.codigo_clockify.padEnd(15)} ${String(p.cliente).padEnd(32)} ${p.lider}`);
    }
    console.log("");
  }

  if (faltando.length) {
    const rotulo = INCLUIR ? verde("INCLUIR") : cinza("DA PLANILHA, FORA DO CICLO");
    console.log(`  ${rotulo} (${faltando.length})${INCLUIR ? "" : ` — use ${ciano("--incluir")} para colocá-los`}:`);
    for (const f of faltando.sort((a, b) => a.mestre.codigo_clockify.localeCompare(b.mestre.codigo_clockify))) {
      console.log(
        `    ${f.mestre.codigo_clockify.padEnd(15)} ${String(f.planilha.cliente).padEnd(32)} ${f.planilha.lider}`
      );
    }
    console.log("");
  }

  if (semCadastro.length) {
    console.log(`  ${amarelo("⚠")} ${semCadastro.length} da planilha sem projeto no banco — rode o importador antes.`);
    console.log("");
  }

  const total = retirar.length + (INCLUIR ? faltando.length : 0);
  if (!total) {
    console.log(`  ${verde("Nada a fazer.")} O ciclo ${CICLO} já reflete a planilha.\n`);
    return;
  }

  if (!APLICAR) {
    console.log(`  ${amarelo("Simulação.")} Rode de novo com ${ciano("--aplicar")} para gravar.\n`);
    return;
  }

  let feitas = 0;
  for (const p of retirar) {
    await rpc("nps_definir_participacao_ciclo", {
      p_projeto_id: p.projeto_id,
      p_ciclo_id: ciclo.id,
      p_participar: false,
      p_elegivel: false,
      p_ator: ATOR,
    });
    feitas += 1;
  }
  if (INCLUIR) {
    for (const f of faltando) {
      await rpc("nps_definir_participacao_ciclo", {
        p_projeto_id: f.mestre.id,
        p_ciclo_id: ciclo.id,
        p_participar: true,
        p_elegivel: true,
        p_ator: ATOR,
      });
      feitas += 1;
    }
  }

  console.log(`  ${verde("✔")} ${feitas} alteração(ões) gravada(s) no ciclo ${CICLO}.\n`);
}

principal().catch((e) => {
  console.log(`\n  ${vermelho("✖")} ${e.message}\n`);
  process.exit(1);
});
