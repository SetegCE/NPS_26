// Em qual ciclo o dashboard abre.
//
// Este arquivo nasceu de um relato de "não tá puxando o banco, o dashboard
// está vazio". Os dados estavam lá — 78 respostas carregadas — mas o painel
// abria filtrado num ciclo cadastrado para outubro, com 2 respostas soltas.
//
// O primeiro cenário abaixo é exatamente o estado do banco naquele dia.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { cicloInicial } from "../lib/cicloInicial.ts";

describe("cicloInicial", () => {
  test("o caso real: ignora o ciclo que ainda não começou", () => {
    const ciclos = ["2025.2", "2026.1", "2026.2"];
    const inicio = {
      "2025.2": "2025-07-01",
      "2026.1": "2026-01-01",
      "2026.2": "2026-10-01", // ainda não começou em setembro
    };
    const respostas = { "2025.2": 36, "2026.1": 40, "2026.2": 2 };

    assert.equal(cicloInicial(ciclos, inicio, respostas, "2026-09-21"), "2026.1");
  });

  test("em outubro, quando o ciclo novo começa E já tem resposta, migra para ele", () => {
    const ciclos = ["2025.2", "2026.1", "2026.2"];
    const inicio = {
      "2025.2": "2025-07-01",
      "2026.1": "2026-01-01",
      "2026.2": "2026-10-01",
    };
    const respostas = { "2025.2": 36, "2026.1": 40, "2026.2": 2 };

    assert.equal(cicloInicial(ciclos, inicio, respostas, "2026-10-02"), "2026.2");
  });

  test("ciclo que começou mas ainda não recebeu resposta não é escolhido", () => {
    // Do contrário o painel abriria vazio no primeiro dia de cada ciclo.
    const ciclos = ["2026.1", "2026.2"];
    const inicio = { "2026.1": "2026-01-01", "2026.2": "2026-10-01" };
    const respostas = { "2026.1": 40 };

    assert.equal(cicloInicial(ciclos, inicio, respostas, "2026-10-02"), "2026.1");
  });

  test("nenhum ciclo tem resposta ainda: fica no mais recente que começou", () => {
    const ciclos = ["2026.1", "2026.2"];
    const inicio = { "2026.1": "2026-01-01", "2026.2": "2026-10-01" };

    assert.equal(cicloInicial(ciclos, inicio, {}, "2026-10-02"), "2026.2");
    assert.equal(cicloInicial(ciclos, inicio, {}, "2026-09-21"), "2026.1");
  });

  test("todos os ciclos são futuros: fica no primeiro, em vez de nenhum", () => {
    const ciclos = ["2027.1", "2027.2"];
    const inicio = { "2027.1": "2027-01-01", "2027.2": "2027-07-01" };

    assert.equal(cicloInicial(ciclos, inicio, {}, "2026-09-21"), "2027.1");
  });

  test("ciclo sem data cadastrada conta como iniciado", () => {
    // A data é opcional no cadastro; sumir do padrão por falta dela seria
    // pior do que incluí-lo.
    const ciclos = ["2025.2", "2026.1"];
    const inicio = { "2025.2": "2025-07-01", "2026.1": null };
    const respostas = { "2025.2": 36, "2026.1": 40 };

    assert.equal(cicloInicial(ciclos, inicio, respostas, "2026-09-21"), "2026.1");
  });

  test("sem ciclo nenhum devolve vazio, sem quebrar", () => {
    assert.equal(cicloInicial([], {}, {}), "");
  });

  test("um ciclo só é sempre a resposta", () => {
    assert.equal(
      cicloInicial(["2026.1"], { "2026.1": "2026-01-01" }, { "2026.1": 5 }, "2026-09-21"),
      "2026.1"
    );
    // Mesmo sem resposta e mesmo no futuro.
    assert.equal(cicloInicial(["2027.1"], { "2027.1": "2027-01-01" }, {}, "2026-09-21"), "2027.1");
  });
});
