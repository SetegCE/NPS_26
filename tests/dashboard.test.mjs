// Motor de dados do dashboard: casamento resposta<->projeto, canal, lider
// atual e o calculo do NPS.
//
// Esta e a cobertura que NAO existia antes: toda esta logica morava dentro de
// dashboard.js, num IIFE que dependia do DOM e do localStorage, e por isso
// nao havia como testa-la. Mover para lib/dashboard.ts foi o que a tornou
// verificavel — e as contas aqui sao as que a diretoria le.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  calcularMetricas,
  canalDaResposta,
  categoriaDaNota,
  classificarCanal,
  chaveDoProjeto,
  comLiderAtual,
  normalizar,
  processarRespostas,
  rotuloDoCanal,
} from "../lib/dashboard.ts";

const projeto = (p) => ({
  ciclo: "2026.1",
  codigo_clockify: "CK-1",
  cliente: "AMBEV",
  projeto: "LAGO DO FRANCO",
  lider: "JULIANA",
  classe_contratual: "A",
  tipo_servico: "LICENCIAMENTO",
  segmento_cliente: "INDUSTRIA",
  ...p,
});

const resposta = (r) => ({
  id: "r1",
  identificador: "RAFAELLA ARAUJO",
  ciclo: "2026.1",
  codigo_clockify: "CK-1",
  timestamp: "2026-06-01T10:00:00Z",
  nota_q1: 10,
  nota_q2: 10,
  nota_q3: 10,
  nota_q4: 10,
  ...r,
});

describe("normalizar", () => {
  test("remove acento, colapsa espaco e sobe para maiuscula", () => {
    assert.equal(normalizar("  Mineração   Taboca "), "MINERACAO TABOCA");
    assert.equal(normalizar("José D'Ávila"), "JOSE D'AVILA");
  });

  test("trata nulo e vazio sem quebrar", () => {
    assert.equal(normalizar(null), "");
    assert.equal(normalizar(undefined), "");
  });
});

describe("chaveDoProjeto", () => {
  test("e ciclo + codigo, normalizados", () => {
    assert.equal(chaveDoProjeto({ ciclo: "2026.1", codigo_clockify: "ck-1" }), "2026.1||CK-1");
  });

  test("o mesmo codigo em ciclos diferentes sao projetos diferentes", () => {
    const a = chaveDoProjeto({ ciclo: "2025.2", codigo_clockify: "CK-1" });
    const b = chaveDoProjeto({ ciclo: "2026.1", codigo_clockify: "CK-1" });
    assert.notEqual(a, b);
  });
});

describe("categoriaDaNota", () => {
  test("segue a faixa oficial do NPS", () => {
    assert.equal(categoriaDaNota(10), "PROMOTOR");
    assert.equal(categoriaDaNota(9), "PROMOTOR");
    assert.equal(categoriaDaNota(8), "NEUTRO");
    assert.equal(categoriaDaNota(7), "NEUTRO");
    assert.equal(categoriaDaNota(6), "DETRATOR");
    assert.equal(categoriaDaNota(0), "DETRATOR");
  });

  test("sem nota nao ha categoria", () => {
    assert.equal(categoriaDaNota(null), null);
    assert.equal(categoriaDaNota(""), null);
    assert.equal(categoriaDaNota(11), null);
    assert.equal(categoriaDaNota(-1), null);
  });
});

describe("canalDaResposta", () => {
  test("o canal vem do banco, seja qual for o ciclo", () => {
    // Havia aqui uma regra fixa: "no ciclo 2026.1, ate 11/05/2026 e e-mail do
    // PMO". Ela descartava o `canal_resposta` gravado e recalculava por data.
    // Agora a coluna manda — inclusive nesse ciclo.
    assert.equal(canalDaResposta({ ciclo: "2026.1", canal_resposta: "EMAIL" }), "EMAIL");
    assert.equal(canalDaResposta({ ciclo: "2026.1", canal_resposta: "WHATSAPP" }), "WHATSAPP");
    assert.equal(canalDaResposta({ ciclo: "2025.2", canal_resposta: "EMAIL" }), "EMAIL");
    assert.equal(canalDaResposta({ ciclo: "2026.2", canal_resposta: "LINK" }), "LINK");
  });

  test("a data nao influencia mais o canal", () => {
    // Mesmo timestamp dos dois lados do antigo corte: o resultado e o que a
    // coluna diz, e nada mais.
    assert.equal(
      canalDaResposta({ ciclo: "2026.1", timestamp: "2026-05-10T23:00:00", canal_resposta: "WHATSAPP" }),
      "WHATSAPP"
    );
    assert.equal(
      canalDaResposta({ ciclo: "2026.1", timestamp: "2026-05-12T09:00:00", canal_resposta: "EMAIL" }),
      "EMAIL"
    );
  });

  test("sem canal gravado, nao se inventa um", () => {
    assert.equal(canalDaResposta({ ciclo: "2025.2" }), "NÃO INFORMADO");
    assert.equal(canalDaResposta({ ciclo: "2025.2", canal_resposta: null }), "NÃO INFORMADO");
  });

  test("a classificacao e por conteudo, para aceitar valor novo", () => {
    // Lista fechada fazia canal desconhecido virar zero em silencio — foi o
    // que aconteceu com "LINK", que nao entrava em nenhum dos dois tubos.
    assert.equal(classificarCanal("EMAIL"), "email");
    assert.equal(classificarCanal("EMAIL (PMO)"), "email");
    assert.equal(classificarCanal("WHATSAPP"), "whatsapp");
    assert.equal(classificarCanal("VIA LÍDER"), "whatsapp");
    assert.equal(classificarCanal("LINK"), "outro");
    assert.equal(classificarCanal(null), "outro");
  });

  test("os rotulos curtos traduzem os dois vocabularios", () => {
    assert.equal(rotuloDoCanal("EMAIL (PMO)"), "EMAIL");
    assert.equal(rotuloDoCanal("VIA LÍDER"), "WHATSAPP");
    assert.equal(rotuloDoCanal("WHATSAPP"), "WHATSAPP");
    // Canal que nao se encaixa aparece como esta no banco, em vez de sumir.
    assert.equal(rotuloDoCanal("LINK"), "LINK");
  });
});

describe("comLiderAtual", () => {
  test("usa o lider do ciclo mais recente daquele codigo", () => {
    const r = comLiderAtual([
      projeto({ ciclo: "2025.2", lider: "MARCELO" }),
      projeto({ ciclo: "2026.1", lider: "JULIANA" }),
    ]);
    // Os DOIS recebem JULIANA: trocar o lider em 2026.1 passa a atribuir a
    // ela tambem o historico daquele projeto nas telas por lider atual.
    assert.deepEqual(
      r.map((p) => p.lider_atual),
      ["JULIANA", "JULIANA"]
    );
  });

  test("projeto sem codigo mantem o proprio lider", () => {
    const r = comLiderAtual([projeto({ codigo_clockify: null, lider: "FERNANDO" })]);
    assert.equal(r[0].lider_atual, "FERNANDO");
  });

  test("lista vazia nao quebra", () => {
    assert.deepEqual(comLiderAtual([]), []);
  });
});

describe("processarRespostas", () => {
  const projetos = comLiderAtual([
    projeto({ ciclo: "2025.2", lider: "MARCELO" }),
    projeto({ ciclo: "2026.1", lider: "JULIANA" }),
  ]);

  test("os campos de exibicao vem do projeto, nao da resposta", () => {
    // A resposta traz cliente e projeto errados de proposito: o que vale e o
    // cadastro, nao o que foi digitado.
    const [r] = processarRespostas(
      [resposta({ cliente: "ERRADO", projeto: "ERRADO", lider: "ERRADO" })],
      projetos
    );
    assert.equal(r.cliente, "AMBEV");
    assert.equal(r.projeto, "LAGO DO FRANCO");
    assert.equal(r.lider, "JULIANA");
    assert.equal(r.classe_contratual, "A");
    assert.equal(r.semProjeto, false);
  });

  test("a chave de contagem vem do projeto vinculado", () => {
    const [r] = processarRespostas([resposta()], projetos);
    assert.equal(r.projetoContagemKey, "2026.1||CK-1");
  });

  test("resposta sem projeto correspondente fica marcada e sem chave", () => {
    const [r] = processarRespostas([resposta({ codigo_clockify: "CK-INEXISTENTE" })], projetos);
    assert.equal(r.semProjeto, true);
    assert.equal(r.projetoContagemKey, null);
  });

  test("resposta sem ciclo nao ganha um ciclo inventado", () => {
    // Havia uma inferencia por data ("antes de 2026 e 2025.2, senao 2026.1"),
    // com os codigos escritos no codigo. Atribuir um ciclo adivinhado faz a
    // resposta entrar na conta do ciclo errado; ficar orfa e visivel.
    const [r] = processarRespostas(
      [resposta({ ciclo: null, codigo_clockify: null, timestamp: "2025-11-02T10:00:00Z" })],
      projetos
    );
    assert.equal(r.ciclo, "");
    assert.equal(r.semProjeto, true);
    assert.equal(r.projetoContagemKey, null);
  });

  test("resposta sem Q4 nao e valida para o NPS", () => {
    const [r] = processarRespostas([resposta({ nota_q4: null })], projetos);
    assert.equal(r.respostaValida, false);
    assert.equal(r.categoria, null);
  });

  test("Q4 igual a zero e valida", () => {
    const [r] = processarRespostas([resposta({ nota_q4: 0 })], projetos);
    assert.equal(r.respostaValida, true);
    assert.equal(r.categoria, "DETRATOR");
  });

  test("a media usa so as notas presentes", () => {
    const [r] = processarRespostas(
      [resposta({ nota_q1: 10, nota_q2: null, nota_q3: null, nota_q4: 8 })],
      projetos
    );
    assert.equal(r.media, 9);
  });
});

describe("calcularMetricas", () => {
  const projetos = comLiderAtual([
    projeto({ codigo_clockify: "CK-1" }),
    projeto({ codigo_clockify: "CK-2", projeto: "UMARI" }),
    projeto({ codigo_clockify: "CK-3", projeto: "S11D" }),
    projeto({ codigo_clockify: "CK-4", projeto: "TABOCA" }),
  ]);

  const processar = (rs) => processarRespostas(rs, projetos);

  test("NPS = %promotores - %detratores", () => {
    const rs = processar([
      resposta({ id: "1", nota_q4: 10 }),
      resposta({ id: "2", nota_q4: 9 }),
      resposta({ id: "3", nota_q4: 8 }),
      resposta({ id: "4", nota_q4: 3 }),
    ]);
    const m = calcularMetricas(rs, projetos);
    // 2 promotores, 1 neutro, 1 detrator em 4 -> 50% - 25% = 25
    assert.equal(m.nps, 25);
    assert.equal(m.promotores, 2);
    assert.equal(m.neutros, 1);
    assert.equal(m.detratores, 1);
    assert.equal(m.respostasValidas, 4);
  });

  test("respostas sem Q4 ficam de fora do NPS", () => {
    const rs = processar([
      resposta({ id: "1", nota_q4: 10 }),
      resposta({ id: "2", nota_q4: null }),
    ]);
    const m = calcularMetricas(rs, projetos);
    assert.equal(m.respostasValidas, 1);
    assert.equal(m.nps, 100);
  });

  test("varias respostas do mesmo projeto contam como UM projeto respondido", () => {
    // E o erro classico desta tela: somar respostas e chamar de cobertura.
    const rs = processar([
      resposta({ id: "1", codigo_clockify: "CK-1", respondente_id: "p1" }),
      resposta({ id: "2", codigo_clockify: "CK-1", respondente_id: "p2" }),
      resposta({ id: "3", codigo_clockify: "CK-1", respondente_id: "p3" }),
    ]);
    const m = calcularMetricas(rs, projetos);
    assert.equal(m.respostasValidas, 3);
    assert.equal(m.respondentesDistintos, 3);
    assert.equal(m.projetosRespondidos, 1);
    assert.equal(m.totalProjetos, 4);
    assert.equal(m.percentualProjetos, 25);
  });

  test("a mesma pessoa avaliando dois projetos e UM respondente", () => {
    const rs = processar([
      resposta({ id: "1", codigo_clockify: "CK-1", respondente_id: "p1" }),
      resposta({ id: "2", codigo_clockify: "CK-2", respondente_id: "p1" }),
    ]);
    const m = calcularMetricas(rs, projetos);
    assert.equal(m.respondentesDistintos, 1);
    assert.equal(m.projetosRespondidos, 2);
  });

  test("a cobertura nunca passa de 100%", () => {
    const rs = processar([
      resposta({ id: "1", codigo_clockify: "CK-1" }),
      resposta({ id: "2", codigo_clockify: "CK-2" }),
      resposta({ id: "3", codigo_clockify: "CK-3" }),
      resposta({ id: "4", codigo_clockify: "CK-4" }),
      resposta({ id: "5", codigo_clockify: "CK-4" }),
    ]);
    const m = calcularMetricas(rs, projetos);
    assert.equal(m.percentualProjetos, 100);
  });

  test("conta os canais inclusive de respostas invalidas", () => {
    // "por onde chegou" independe de a avaliacao servir ao NPS.
    const rs = processar([
      resposta({ id: "1", canal_resposta: "EMAIL", nota_q4: null }),
      resposta({ id: "2", canal_resposta: "WHATSAPP", nota_q4: 10 }),
    ]);
    const m = calcularMetricas(rs, projetos);
    assert.equal(m.totalEmail, 1);
    assert.equal(m.totalWhatsApp, 1);
    assert.equal(m.respostasValidas, 1);
  });

  test("canal que nao e e-mail nem WhatsApp entra em totalOutroCanal", () => {
    // Antes sumia da conta e o "Total" do painel de origem ficava menor que o
    // numero real de respostas.
    const rs = processar([
      resposta({ id: "1", canal_resposta: "EMAIL" }),
      resposta({ id: "2", canal_resposta: "LINK" }),
      resposta({ id: "3", canal_resposta: null }),
    ]);
    const m = calcularMetricas(rs, projetos);
    assert.equal(m.totalEmail, 1);
    assert.equal(m.totalWhatsApp, 0);
    assert.equal(m.totalOutroCanal, 2);
    assert.equal(m.totalEmail + m.totalWhatsApp + m.totalOutroCanal, rs.length);
  });

  test("sem respostas devolve zeros, com o universo preservado", () => {
    const m = calcularMetricas([], projetos);
    assert.equal(m.nps, 0);
    assert.equal(m.respostasValidas, 0);
    assert.equal(m.totalProjetos, 4);
    assert.equal(m.percentualProjetos, 0);
  });

  test("respostas de fora do escopo nao inflam a cobertura", () => {
    // Universo recortado a um projeto; a resposta do outro nao entra na conta.
    const escopo = projetos.filter((p) => p.codigo_clockify === "CK-1");
    const rs = processar([
      resposta({ id: "1", codigo_clockify: "CK-1" }),
      resposta({ id: "2", codigo_clockify: "CK-2" }),
    ]);
    const m = calcularMetricas(rs, escopo);
    assert.equal(m.totalProjetos, 1);
    assert.equal(m.projetosRespondidos, 1);
    assert.equal(m.percentualProjetos, 100);
  });

  test("as medias por pergunta saem com duas casas", () => {
    const rs = processar([
      resposta({ id: "1", nota_q1: 10, nota_q2: 9, nota_q3: 8, nota_q4: 10 }),
      resposta({ id: "2", nota_q1: 9, nota_q2: 9, nota_q3: 7, nota_q4: 9 }),
    ]);
    const m = calcularMetricas(rs, projetos);
    assert.equal(m.porPergunta.Q1, 9.5);
    assert.equal(m.porPergunta.Q2, 9);
    assert.equal(m.porPergunta.Q3, 7.5);
    assert.equal(m.porPergunta.Q4, 9.5);
  });
});
