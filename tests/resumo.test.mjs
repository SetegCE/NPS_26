// Resumo de respostas — a formula de NPS compartilhada pelo historico por
// cliente e pelo historico por lider.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resumirRespostas } from "../lib/resumo.ts";

const r = (o) => ({
  resposta_valida: true,
  categoria: "PROMOTOR",
  respondente_id: "p1",
  projeto_id: "proj1",
  nota_q1: 10,
  nota_q2: 10,
  nota_q3: 10,
  nota_q4: 10,
  ...o,
});

describe("resumirRespostas", () => {
  test("lista vazia devolve zeros e medias nulas", () => {
    const s = resumirRespostas([]);
    assert.equal(s.nps, 0);
    assert.equal(s.respostas, 0);
    assert.equal(s.respondentes, 0);
    assert.equal(s.projetos_com_resposta, 0);
    assert.deepEqual(s.medias, { Q1: null, Q2: null, Q3: null, Q4: null });
  });

  test("so respostas validas entram na conta", () => {
    const s = resumirRespostas([
      r({ categoria: "PROMOTOR" }),
      r({ resposta_valida: false, categoria: "DETRATOR" }),
    ]);
    assert.equal(s.respostas, 1);
    assert.equal(s.nps, 100);
    assert.equal(s.detratores, 0);
  });

  test("promotores menos detratores, em porcentagem", () => {
    const s = resumirRespostas([
      r({ categoria: "PROMOTOR", respondente_id: "a" }),
      r({ categoria: "NEUTRO", respondente_id: "b" }),
      r({ categoria: "DETRATOR", respondente_id: "c" }),
      r({ categoria: "DETRATOR", respondente_id: "d" }),
    ]);
    // 25% promotores - 50% detratores = -25
    assert.equal(s.nps, -25);
  });

  test("respondentes e projetos sao contados como distintos", () => {
    const s = resumirRespostas([
      r({ respondente_id: "a", projeto_id: "p1" }),
      r({ respondente_id: "a", projeto_id: "p2" }),
      r({ respondente_id: "b", projeto_id: "p1" }),
    ]);
    assert.equal(s.respostas, 3);
    assert.equal(s.respondentes, 2);
    assert.equal(s.projetos_com_resposta, 2);
  });

  test("a media de cada pergunta ignora as notas ausentes", () => {
    const s = resumirRespostas([
      r({ nota_q1: 10, nota_q2: null }),
      r({ nota_q1: 8, nota_q2: 6 }),
    ]);
    assert.equal(s.medias.Q1, 9);
    // So uma resposta tem Q2 — a media e ela mesma, nao 3.
    assert.equal(s.medias.Q2, 6);
  });
});
