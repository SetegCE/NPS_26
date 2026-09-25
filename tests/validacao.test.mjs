// Validadores de entrada.
//
// Rodam contra lib/validacao.ts direto — Node 22+ remove os tipos sozinho, e
// o modulo nao depende do Next justamente para permitir isto.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ErroHttp,
  booleano,
  competencia,
  nota,
  ordenacao,
  paginacao,
  texto,
  umDe,
  uuid,
  uuidOpcional,
} from "../lib/validacao.ts";

/** Executa `fn` e devolve o ErroHttp lancado, ou falha o teste. */
function capturar(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ErroHttp, `esperava ErroHttp, veio ${e}`);
    return e;
  }
  assert.fail("esperava que lancasse ErroHttp");
}

describe("uuid", () => {
  const valido = "3f8a1c2e-9b4d-4a7f-8e1b-2c5d6a7f8b9c";

  test("aceita um UUID bem formado", () => {
    assert.equal(uuid(valido, "id"), valido);
  });

  test("aceita maiusculas e espaco em volta", () => {
    assert.equal(uuid(`  ${valido.toUpperCase()}  `, "id"), valido.toUpperCase());
  });

  test("recusa qualquer coisa que nao seja UUID", () => {
    for (const ruim of ["1", "abc", "", null, undefined, "3f8a1c2e9b4d4a7f8e1b2c5d6a7f8b9c"]) {
      const e = capturar(() => uuid(ruim, "id"));
      assert.equal(e.status, 400);
      assert.equal(e.codigo, "ID_INVALIDO");
    }
  });

  test("uuidOpcional deixa passar vazio, mas nao lixo", () => {
    assert.equal(uuidOpcional("", "id"), null);
    assert.equal(uuidOpcional(null, "id"), null);
    assert.equal(uuidOpcional(undefined, "id"), null);
    capturar(() => uuidOpcional("nao-e-uuid", "id"));
  });
});

describe("texto", () => {
  test("apara espacos", () => {
    assert.equal(texto("  Seteg  ", "nome"), "Seteg");
  });

  test("devolve null para vazio quando nao e obrigatorio", () => {
    assert.equal(texto("   ", "nome"), null);
    assert.equal(texto(null, "nome"), null);
  });

  test("exige quando obrigatorio", () => {
    const e = capturar(() => texto("", "nome", { obrigatorio: true }));
    assert.equal(e.codigo, "CAMPO_OBRIGATORIO");
  });

  test("remove caracteres de controle", () => {
    assert.equal(texto("Se\u0000te\u0007g", "nome"), "Seteg");
  });

  test("respeita o limite de tamanho", () => {
    const e = capturar(() => texto("x".repeat(11), "nome", { max: 10 }));
    assert.equal(e.codigo, "CAMPO_MUITO_LONGO");
  });
});

describe("nota", () => {
  test("aceita inteiros de 0 a 10", () => {
    for (let i = 0; i <= 10; i += 1) assert.equal(nota(i, "q4"), i);
    assert.equal(nota("7", "q4"), 7);
  });

  test("recusa fora da faixa e nao inteiros", () => {
    for (const ruim of [-1, 11, 7.5, "abc", true]) {
      const e = capturar(() => nota(ruim, "q4"));
      assert.equal(e.codigo, "NOTA_INVALIDA");
    }
  });

  test("vazio e null quando opcional, erro quando obrigatorio", () => {
    assert.equal(nota("", "q1"), null);
    assert.equal(nota(null, "q1"), null);
    const e = capturar(() => nota(undefined, "q4", { obrigatorio: true }));
    assert.equal(e.codigo, "CAMPO_OBRIGATORIO");
  });

  test("zero e uma nota valida, nao um vazio", () => {
    // O detrator mais grave da base responde 0. Tratar 0 como ausente o
    // apagaria da conta do NPS.
    assert.equal(nota(0, "q4", { obrigatorio: true }), 0);
  });
});

describe("booleano", () => {
  test("interpreta as formas usadas nos filtros", () => {
    assert.equal(booleano(true), true);
    assert.equal(booleano("true"), true);
    assert.equal(booleano("1"), true);
    assert.equal(booleano("sim"), true);
    assert.equal(booleano("false"), false);
    assert.equal(booleano("0"), false);
    assert.equal(booleano("nao"), false);
  });

  test("devolve o padrao para vazio ou desconhecido", () => {
    assert.equal(booleano("", null), null);
    assert.equal(booleano(undefined, true), true);
    assert.equal(booleano("talvez", false), false);
  });
});

describe("umDe", () => {
  const opcoes = ["ativo", "encerrado"];

  test("aceita valor da lista", () => {
    assert.equal(umDe("ativo", opcoes, "status"), "ativo");
  });

  test("recusa valor fora da lista", () => {
    const e = capturar(() => umDe("qualquer", opcoes, "status"));
    assert.equal(e.codigo, "VALOR_INVALIDO");
  });

  test("vazio devolve null, salvo se obrigatorio", () => {
    assert.equal(umDe("", opcoes, "status"), null);
    capturar(() => umDe("", opcoes, "status", { obrigatorio: true }));
  });
});

describe("competencia", () => {
  test("converte AAAA-MM no primeiro dia do mes", () => {
    assert.equal(competencia("2026-05", "competencia"), "2026-05-01");
    assert.equal(competencia("2026-05-17", "competencia"), "2026-05-01");
  });

  test("recusa formato e mes invalidos", () => {
    for (const ruim of ["2026", "05-2026", "2026-13", "2026-00"]) {
      const e = capturar(() => competencia(ruim, "competencia"));
      assert.equal(e.codigo, "COMPETENCIA_INVALIDA");
    }
  });
});

describe("paginacao", () => {
  const q = (obj) => new URLSearchParams(obj);

  test("usa os padroes quando nao vem nada", () => {
    assert.deepEqual(paginacao(q({})), { pagina: 1, porPagina: 25, de: 0, ate: 24 });
  });

  test("calcula o intervalo a partir da pagina", () => {
    assert.deepEqual(paginacao(q({ pagina: "3", porPagina: "10" })), {
      pagina: 3,
      porPagina: 10,
      de: 20,
      ate: 29,
    });
  });

  test("aplica limites seguros", () => {
    // Sem o teto, `porPagina=100000` faria o PostgREST devolver a tabela
    // inteira numa requisicao.
    assert.equal(paginacao(q({ porPagina: "100000" })).porPagina, 200);
    assert.equal(paginacao(q({ porPagina: "0" })).porPagina, 25);
    assert.equal(paginacao(q({ pagina: "-4" })).pagina, 1);
    assert.equal(paginacao(q({ pagina: "abc" })).pagina, 1);
  });
});

describe("ordenacao", () => {
  const permitidos = ["nome", "created_at"];
  const q = (obj) => new URLSearchParams(obj);

  test("aceita coluna da whitelist", () => {
    assert.deepEqual(ordenacao(q({ ordenarPor: "created_at", ordem: "desc" }), permitidos, "nome"), {
      campo: "created_at",
      ascending: false,
    });
  });

  test("cai no padrao quando a coluna nao esta na whitelist", () => {
    // Sem a whitelist, o parametro de ordem iria cru para o PostgREST.
    assert.equal(ordenacao(q({ ordenarPor: "senha_hash" }), permitidos, "nome").campo, "nome");
    assert.equal(
      ordenacao(q({ ordenarPor: "nome;drop table" }), permitidos, "nome").campo,
      "nome"
    );
  });

  test("ascendente e o padrao", () => {
    assert.equal(ordenacao(q({}), permitidos, "nome").ascending, true);
    assert.equal(ordenacao(q({ ordem: "DESC" }), permitidos, "nome").ascending, false);
  });
});
