// Sincronizacao Clockrview -> espelho de projetos.
//
// Testa so o planejamento (funcao pura): e nele que moram as regras que, se
// quebrarem, reatribuem NPS para a pessoa errada ou enchem o sistema de
// projetos encerrados.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { chaveCodigo } from "../lib/clockrview.ts";
import { planejar } from "../lib/sincronizarProjetos.ts";

const tresLideres = [
  { id: "l1", nome: "MARIA SOUZA", email: "maria@setegce.com", ativo: true },
  { id: "l2", nome: "JOÃO LIMA", email: "joao@setegce.com", ativo: true },
  { id: "l3", nome: "ANA PAZ", email: "ana@setegce.com", ativo: true },
];
const comLider = (lider_id, lider_clockrview) => ({
  lideres: tresLideres,
  projetos: [
    {
      id: "p1",
      codigo_clockify: "0221-02-2025",
      nome: "SOLAR SERRA DA PALMEIRA",
      cliente_id: "c1",
      lider_id,
      lider_clockrview,
      ativo: true,
    },
  ],
});

const api = (x = {}) => ({
  codigo: "0221-02-2025",
  nome: "SOLAR SERRA DA PALMEIRA",
  status: "ativo",
  clienteNome: "AUREN",
  liderNome: "Maria Souza",
  liderEmail: "maria@setegce.com",
  coLiderNome: null,
  coLiderEmail: null,
  ...x,
});

const estado = (x = {}) => ({
  projetos: [
    {
      id: "p1",
      codigo_clockify: "#0221-2-2025",
      nome: "SOLAR SERRA DA PALMEIRA",
      cliente_id: "c1",
      lider_id: "l1",
      lider_clockrview: "maria@setegce.com",
      ativo: true,
    },
  ],
  lideres: [{ id: "l1", nome: "MARIA SOUZA", email: "maria@setegce.com", ativo: true }],
  clientes: [{ id: "c1", nome: "AUREN" }],
  usuarios: [],
  ...x,
});

describe("código do projeto", () => {
  test("formato do Clockrview e da planilha antiga são o mesmo projeto", () => {
    assert.equal(chaveCodigo("0221-02-2025"), chaveCodigo("#0221-2-2025"));
    assert.notEqual(chaveCodigo("0221-02-2025"), chaveCodigo("0221-03-2025"));
  });
});

describe("planejar", () => {
  test("projeto igual nos dois lados só ganha o código no formato do Clockrview", () => {
    const p = planejar([api()], estado());
    assert.equal(p.projetosNovos.length, 0);
    assert.equal(p.trocasLider.length, 0);
    assert.equal(p.situacao.length, 0);
    assert.deepEqual(p.projetosAlterados[0].campos, { codigo_clockify: "0221-02-2025" });
  });

  test("inativo no Clockrview inativa no NPS, sem apagar", () => {
    const p = planejar([api({ codigo: "#0221-2-2025", status: "inativo" })], estado());
    assert.deepEqual(p.situacao, [{ id: "p1", codigo: "#0221-2-2025", ativo: false }]);
  });

  test("troca de líder vira troca com histórico, casada pelo e-mail", () => {
    const e = estado({
      lideres: [
        { id: "l1", nome: "MARIA SOUZA", email: "maria@setegce.com", ativo: true },
        { id: "l2", nome: "JOÃO LIMA", email: "joao@setegce.com", ativo: true },
      ],
    });
    // Nome escrito diferente do cadastro: o e-mail é que casa.
    const p = planejar([api({ liderNome: "Joao Lima Filho", liderEmail: "JOAO@setegce.com" })], e);
    assert.equal(p.trocasLider.length, 1);
    assert.deepEqual(p.trocasLider[0].lider, { id: "l2" });
    assert.equal(p.lideresNovos.length, 0);
  });

  test("líder inativo no NPS não recebe o projeto e gera aviso", () => {
    const e = estado({
      lideres: [
        { id: "l1", nome: "MARIA SOUZA", email: "maria@setegce.com", ativo: true },
        { id: "l2", nome: "JOÃO LIMA", email: "joao@setegce.com", ativo: false },
      ],
    });
    const p = planejar([api({ liderEmail: "joao@setegce.com", liderNome: "João Lima" })], e);
    assert.equal(p.trocasLider.length, 0);
    assert.equal(p.avisos.length, 1);
  });

  test("sem líder ou cliente no Clockrview, o NPS mantém o que tem", () => {
    const p = planejar(
      [api({ codigo: "#0221-2-2025", liderNome: null, liderEmail: null, clienteNome: null })],
      estado()
    );
    assert.equal(p.trocasLider.length, 0);
    assert.equal(p.projetosAlterados.length, 0);
  });

  test("projeto novo ativo é criado; inativo que nunca passou pelo NPS é ignorado", () => {
    const p = planejar(
      [
        api(),
        api({ codigo: "0300-01-2026", nome: "NOVO", clienteNome: "CLIENTE NOVO", liderEmail: "ana@setegce.com", liderNome: "Ana" }),
        api({ codigo: "0301-01-2020", nome: "VELHO", status: "inativo" }),
      ],
      estado()
    );
    assert.equal(p.projetosNovos.length, 1);
    assert.equal(p.projetosNovos[0].codigo, "0300-01-2026");
    assert.deepEqual(p.clientesNovos, ["CLIENTE NOVO"]);
    assert.deepEqual(p.lideresNovos, [{ nome: "Ana", email: "ana@setegce.com" }]);
    assert.equal(p.inativosIgnorados, 1);
  });

  test("líder achado pelo nome e sem e-mail ganha o e-mail do Clockrview", () => {
    const e = estado({ lideres: [{ id: "l1", nome: "MARIA SOUZA", email: null, ativo: true }] });
    const p = planejar([api()], e);
    assert.deepEqual(p.lideresEmail, [{ id: "l1", nome: "MARIA SOUZA", email: "maria@setegce.com" }]);
    assert.equal(p.trocasLider.length, 0);
  });

  test("projeto do NPS fora do Clockrview é listado, não apagado", () => {
    const p = planejar([], estado());
    assert.deepEqual(p.foraDoClockrview, [{ codigo: "#0221-2-2025", nome: "SOLAR SERRA DA PALMEIRA" }]);
  });

  test("troca de líder feita no NPS é mantida enquanto o Clockrview não muda", () => {
    // PMO trocou Maria -> Ana no NPS; o Clockrview continua dizendo Maria.
    const p = planejar([api()], estado(comLider("l3", "maria@setegce.com")));
    assert.equal(p.trocasLider.length, 0);
    assert.equal(p.lideresMantidos.length, 1);
    assert.equal(p.lideresVistos.length, 0);
  });

  test("se depois o Clockrview muda o líder, a mudança dele vale", () => {
    const p = planejar(
      [api({ liderNome: "João Lima", liderEmail: "joao@setegce.com" })],
      estado(comLider("l3", "maria@setegce.com"))
    );
    assert.equal(p.trocasLider.length, 1);
    assert.deepEqual(p.trocasLider[0].lider, { id: "l2" });
    assert.deepEqual(p.lideresVistos, [{ id: "p1", valor: "joao@setegce.com" }]);
  });

  test("primeira sincronização só registra o líder visto quando ele já é o atual", () => {
    const p = planejar([api()], estado(comLider("l1", null)));
    assert.equal(p.trocasLider.length, 0);
    assert.deepEqual(p.lideresVistos, [{ id: "p1", valor: "maria@setegce.com" }]);
  });

  test("líder inativo não é marcado como visto, para tentar de novo após reativar", () => {
    const e = estado({
      lideres: [
        { id: "l1", nome: "MARIA SOUZA", email: "maria@setegce.com", ativo: true },
        { id: "l2", nome: "JOÃO LIMA", email: "joao@setegce.com", ativo: false },
      ],
    });
    const p = planejar([api({ liderEmail: "joao@setegce.com", liderNome: "João Lima" })], e);
    assert.equal(p.lideresVistos.length, 0);
  });
});
