// Importa a planilha CLIENTES_ATIVOS para o banco.
//
//   node scripts/importar-planilha.mjs "caminho/CLIENTES_ATIVOS.csv"            # simulação
//   node scripts/importar-planilha.mjs "caminho/CLIENTES_ATIVOS.csv" --aplicar  # grava
//
// ── O que ele faz, e o que NÃO faz ─────────────────────────────────────────
//
// Faz: cria clientes e líderes que faltam, cria os projetos novos e atualiza
// os que já existem. É idempotente — rodar duas vezes seguidas não muda nada
// na segunda.
//
// NÃO faz, de propósito:
//
//  - não apaga nada. Projeto que sumiu da planilha continua no banco, porque
//    ele tem respostas e histórico de ciclo pendurados. Quem decide tirar de
//    circulação é o PMO, inativando pela tela;
//  - não coloca projeto novo em ciclo nenhum. Participação em ciclo é decisão
//    do PMO na tela de Ciclos, e mexer nela aqui mudaria o denominador do NPS
//    sem ninguém pedir;
//  - não troca líder por UPDATE direto. Usa nps_alterar_lider, que fecha o
//    período do líder anterior e abre o do novo. É isso que mantém a regra
//    "resposta nunca é reatribuída" — um UPDATE cru faria o NPS histórico
//    mudar de dono em silêncio.
//
// A planilha é a fonte de verdade para: cliente, líder, segmento, escopo,
// status, vendedor e acesso. O código do projeto é a chave e nunca muda.

import path from "node:path";

import {
  verde,
  vermelho,
  amarelo,
  ciano,
  cinza,
  conectar,
  norm,
  lerPlanilha,
  csvDoArgumento,
} from "./comum.mjs";

const ATOR = "IMPORTACAO PLANILHA";

const argumentos = process.argv.slice(2);
const APLICAR = argumentos.includes("--aplicar");
const ORIGEM = csvDoArgumento(
  argumentos,
  'node scripts/importar-planilha.mjs "C:/.../CLIENTES_ATIVOS.csv"'
);

// DESATIVADO: os projetos agora vem do Clockrview (lib/sincronizarProjetos.ts,
// botao "Sincronizar com Clockrview" na tela de Projetos e cron diario).
// Rodar este importador depois da sincronizacao CRIARIA DUPLICATAS: o banco
// passa a guardar o codigo no formato do Clockrview ("0221-02-2025") e a
// planilha escreve "#0221-2-2025", que este script nao reconhece como o mesmo.
console.log(`
  ${vermelho("✖")} Importador desativado: os projetos vêm do Clockrview.`);
console.log(`    Use ${ciano("Sincronizar com Clockrview")} na tela de Projetos.
`);
process.exit(1);

const { db, rpc } = conectar();

// ── Execução ────────────────────────────────────────────────────────────────

const acoes = [];
const registrar = (tipo, texto) => acoes.push({ tipo, texto });

async function principal() {
  console.log("");
  console.log(`  ${APLICAR ? vermelho("MODO GRAVAÇÃO") : amarelo("SIMULAÇÃO")}  ${cinza(path.basename(ORIGEM))}`);
  if (!APLICAR) console.log(`  ${cinza("Nada será gravado. Use --aplicar para valer.")}`);
  console.log("");

  const planilha = lerPlanilha(ORIGEM);
  console.log(`  ${planilha.length} projetos na planilha`);

  const [clientes, lideres, projetos] = await Promise.all([
    db("clientes_nps?select=id,nome,segmento"),
    db("lideres_nps?select=id,nome,ativo"),
    db("projetos_mestre_nps?select=id,codigo_clockify,nome,cliente_id,lider_id,segmento_cliente,escopo_geral,status,vendedor,acesso"),
  ]);

  const porCliente = new Map(clientes.map((c) => [norm(c.nome), c]));
  const porLider = new Map(lideres.map((l) => [norm(l.nome), l]));
  const porCodigo = new Map(projetos.map((p) => [norm(p.codigo_clockify), p]));

  // ── Clientes ──────────────────────────────────────────────────────────────
  for (const nome of [...new Set(planilha.map((r) => r.cliente))]) {
    const segmento = planilha.find((r) => r.cliente === nome)?.segmento ?? null;
    const atual = porCliente.get(norm(nome));

    if (!atual) {
      registrar("cliente+", `criar cliente ${nome}${segmento ? ` (${segmento})` : ""}`);
      if (APLICAR) {
        const [criado] = await db("clientes_nps", {
          method: "POST",
          body: { nome, segmento },
          headers: { Prefer: "return=representation" },
        });
        porCliente.set(norm(nome), criado);
      } else {
        porCliente.set(norm(nome), { id: `novo:${nome}`, nome, segmento });
      }
    } else if (segmento && norm(atual.segmento) !== norm(segmento)) {
      registrar("cliente~", `cliente ${nome}: segmento "${atual.segmento || "—"}" -> "${segmento}"`);
      if (APLICAR) {
        await db(`clientes_nps?id=eq.${atual.id}`, { method: "PATCH", body: { segmento } });
      }
    }
  }

  // ── Líderes ───────────────────────────────────────────────────────────────
  //
  // A planilha traz o líder pelo primeiro nome ("FERNANDO", "LAIZE") ou pelo
  // sobrenome ("HADDAD"); o cadastro guarda o nome completo. Casar só por
  // igualdade exata, como esta etapa fazia, criava um cadastro novo a cada
  // importação e em seguida movia os projetos para ele — foi assim que
  // nasceram os "JULIANA", "TIAGO" e "GUSTAVO" que conviviam com as pessoas
  // de verdade, cada um com metade do histórico e nenhum com conta de acesso.
  //
  // Agora o casamento é: igual > único que comece pelo termo > único que
  // tenha o termo como um dos nomes. Ambiguidade NÃO vira cadastro novo: o
  // importador para e mostra os candidatos, porque escolher entre duas
  // pessoas é decisão de quem conhece a equipe, e errar aqui reatribui
  // projeto e NPS para a pessoa errada.
  //
  // Só cadastro ATIVO entra no casamento. Um inativo é justamente o que já
  // saiu de circulação — contá-lo tornaria "CARINA" ambíguo entre a pessoa
  // atual e o cadastro antigo que a substituiu, e `nps_alterar_lider` recusa
  // líder inativo de qualquer forma (LIDER_INATIVO).
  const ambiguidades = [];
  const inativosPedidos = [];

  function casar(lista, alvo) {
    const exato = lista.filter((l) => norm(l.nome) === alvo);
    if (exato.length) return exato;
    return lista.filter((l) => {
      const n = norm(l.nome);
      return n.startsWith(`${alvo} `) || n.split(" ").includes(alvo);
    });
  }

  function acharLider(nomePlanilha) {
    const alvo = norm(nomePlanilha);

    const ativos = casar(lideres.filter((l) => l.ativo), alvo);
    if (ativos.length === 1) return ativos[0];
    if (ativos.length > 1) {
      ambiguidades.push({ nome: nomePlanilha, candidatos: ativos.map((c) => c.nome) });
      return null;
    }

    // Nenhum ativo, mas existe um cadastro inativo com esse nome: criar outro
    // seria fabricar um duplicado da mesma pessoa. Melhor parar e pedir que
    // reativem — a tela de Líderes faz isso em um clique.
    const inativos = casar(lideres.filter((l) => !l.ativo), alvo);
    if (inativos.length) {
      inativosPedidos.push({ nome: nomePlanilha, candidatos: inativos.map((c) => c.nome) });
      return null;
    }
    return null;
  }

  const liderDaPlanilha = new Map();
  for (const nome of [...new Set(planilha.map((r) => r.lider).filter(Boolean))]) {
    const achado = acharLider(nome);
    if (achado) {
      if (norm(achado.nome) !== norm(nome)) {
        registrar("lider=", `"${nome}" reconhecido como ${achado.nome}`);
      }
      liderDaPlanilha.set(norm(nome), achado);
      continue;
    }
    const parou = [...ambiguidades, ...inativosPedidos].some(
      (a) => norm(a.nome) === norm(nome)
    );
    if (parou) continue;

    registrar("lider+", `criar líder ${nome}`);
    if (APLICAR) {
      const [criado] = await db("lideres_nps", {
        method: "POST",
        body: { nome },
        headers: { Prefer: "return=representation" },
      });
      lideres.push(criado);
      porLider.set(norm(nome), criado);
      liderDaPlanilha.set(norm(nome), criado);
    } else {
      const fake = { id: `novo:${nome}`, nome };
      liderDaPlanilha.set(norm(nome), fake);
    }
  }

  if (ambiguidades.length || inativosPedidos.length) {
    console.log("");
    console.log(`  ${vermelho("✖")} Não deu para identificar o líder. Nada foi gravado.`);
    console.log("");
    for (const a of ambiguidades) {
      console.log(`    "${a.nome}" pode ser: ${ciano(a.candidatos.join(" ou "))}`);
    }
    for (const a of inativosPedidos) {
      console.log(`    "${a.nome}" só existe como cadastro INATIVO: ${ciano(a.candidatos.join(", "))}`);
    }
    console.log("");
    if (ambiguidades.length) {
      console.log(`  ${amarelo("Ambíguo: use o nome completo na coluna LIDER da planilha.")}`);
    }
    if (inativosPedidos.length) {
      console.log(`  ${amarelo("Inativo: reative o cadastro na tela de Líderes e rode de novo.")}`);
    }
    console.log("");
    process.exit(1);
  }

  // ── Projetos ──────────────────────────────────────────────────────────────
  for (const r of planilha) {
    const cliente = porCliente.get(norm(r.cliente));
    // `liderDaPlanilha`, e nao `porLider`: e o mapa que ja passou pelo
    // casamento de nome curto -> cadastro completo.
    const lider = r.lider ? liderDaPlanilha.get(norm(r.lider)) : null;
    const atual = porCodigo.get(norm(r.codigo));

    if (!atual) {
      registrar("projeto+", `criar ${r.codigo} — ${r.cliente} / ${r.projeto} (${r.lider || "sem líder"})`);
      if (APLICAR) {
        // nps_criar_projeto abre o período de liderança e audita. Sem ciclo:
        // a participação é decisão do PMO na tela de Ciclos.
        const resultado = await rpc("nps_criar_projeto", {
          p_dados: {
            codigo_clockify: r.codigo,
            nome: r.projeto,
            cliente_id: cliente?.id ?? null,
            lider_id: lider?.id ?? null,
            segmento_cliente: r.segmento,
            escopo_geral: r.escopo,
            status: r.status,
            ciclo_id: null,
            elegivel: true,
          },
          p_ator: ATOR,
        });
        // vendedor e acesso não passam pela função do banco (ver migration 14).
        const id = resultado?.projeto?.id ?? resultado?.id;
        if (id && (r.vendedor || r.acesso)) {
          await db(`projetos_mestre_nps?id=eq.${id}`, {
            method: "PATCH",
            body: { vendedor: r.vendedor, acesso: r.acesso },
          });
        }
      }
      continue;
    }

    // Já existe: atualiza o que divergir.
    const campos = {};
    const dif = [];
    const comparar = (chave, planilhado, atualValor, rotulo) => {
      if (norm(planilhado) === norm(atualValor)) return;
      campos[chave] = planilhado;
      dif.push(`${rotulo}: "${atualValor || "—"}" -> "${planilhado || "—"}"`);
    };

    comparar("nome", r.projeto, atual.nome, "nome");
    comparar("segmento_cliente", r.segmento, atual.segmento_cliente, "segmento");
    comparar("escopo_geral", r.escopo, atual.escopo_geral, "escopo");
    comparar("vendedor", r.vendedor, atual.vendedor, "vendedor");
    comparar("acesso", r.acesso, atual.acesso, "acesso");
    if (r.status !== atual.status) {
      campos.status = r.status;
      dif.push(`status: "${atual.status}" -> "${r.status}"`);
    }
    if (cliente && cliente.id !== atual.cliente_id) {
      campos.cliente_id = cliente.id;
      dif.push(`cliente -> ${r.cliente}`);
    }

    if (dif.length) {
      registrar("projeto~", `${r.codigo} — ${dif.join(" · ")}`);
      if (APLICAR) {
        await db(`projetos_mestre_nps?id=eq.${atual.id}`, { method: "PATCH", body: campos });
      }
    }

    // Líder muda por fluxo próprio, nunca por UPDATE.
    if (lider && lider.id !== atual.lider_id) {
      const de = lideres.find((l) => l.id === atual.lider_id)?.nome || "sem líder";
      registrar("lider~", `${r.codigo} — líder ${de} -> ${r.lider}`);
      if (APLICAR) {
        await rpc("nps_alterar_lider", {
          p_projeto_id: atual.id,
          p_lider_id: lider.id,
          p_ator: ATOR,
          p_observacao: "Atualização pela planilha CLIENTES_ATIVOS",
        });
      }
    }
  }

  // ── Relatório ─────────────────────────────────────────────────────────────
  const foraDaPlanilha = projetos.filter(
    (p) => !planilha.some((r) => norm(r.codigo) === norm(p.codigo_clockify))
  );

  console.log("");
  if (!acoes.length) {
    console.log(`  ${verde("Nada a fazer.")} O banco já reflete a planilha.`);
  } else {
    const grupos = {
      "cliente+": "Clientes criados",
      "cliente~": "Clientes atualizados",
      "lider=": "Líderes reconhecidos pelo primeiro nome",
      "lider+": "Líderes criados",
      "projeto+": "Projetos criados",
      "projeto~": "Projetos atualizados",
      "lider~": "Trocas de líder",
    };
    for (const [tipo, titulo] of Object.entries(grupos)) {
      const doTipo = acoes.filter((a) => a.tipo === tipo);
      if (!doTipo.length) continue;
      console.log(`  ${ciano(`${titulo} (${doTipo.length})`)}`);
      for (const a of doTipo) console.log(`    ${a.texto}`);
      console.log("");
    }
  }

  console.log(`  ${cinza(`${foraDaPlanilha.length} projeto(s) no banco fora da planilha — preservados:`)}`);
  for (const p of foraDaPlanilha) console.log(`    ${cinza(`${p.codigo_clockify} — ${p.nome}`)}`);

  console.log("");
  if (APLICAR) {
    console.log(`  ${verde("✔")} ${acoes.length} alteração(ões) gravada(s).`);
  } else {
    console.log(`  ${amarelo("Simulação.")} Rode de novo com ${ciano("--aplicar")} para gravar.`);
  }
  console.log("");
}

principal().catch((e) => {
  console.log(`\n  ${vermelho("✖")} ${e.message}\n`);
  process.exit(1);
});
