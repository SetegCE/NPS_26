// Classificação de rotas do middleware.
//
// Este arquivo existe por causa de um bug real: a primeira versão do
// middleware listava `/api/projetos`, `/api/ciclos`, `/api/operacao`,
// `/api/historico`, `/api/clientes` e `/api/lideres` como exclusivas do PMO.
// Parecia o lado seguro da escolha e quebrava o sistema inteiro para o líder
// — "Meus Projetos", o filtro de ciclo, o indicador de ISC do dashboard e a
// tela Resultados chamam exatamente essas rotas. Só apareceu quando alguém
// entrou de verdade com uma conta de líder.
//
// Os testes abaixo fixam as duas metades da regra: o que o líder PRECISA
// alcançar e o que ele NÃO pode.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ehPublica, ehSoPmo, PREFIXOS_SO_PMO } from "../lib/rotas.ts";

/**
 * Rotas de API que as telas do líder chamam. Levantadas do código: cada uma
 * tem um `api.get(...)` numa tela que o menu do líder oferece.
 */
const API_QUE_O_LIDER_USA = [
  "/api/auth/sessao",
  "/api/dashboard", //            dashboard
  "/api/operacao/indicadores", // cartão de ISC no dashboard
  "/api/projetos", //             Meus Projetos + vínculos
  "/api/respondentes", //         respondentes dos projetos dele
  "/api/pesquisas", //            Pesquisas
  "/api/pesquisas/abc/link", //   copiar link
  "/api/ciclos", //               filtro de ciclo em Pesquisas e ISC
  "/api/clientes", //             selects
  "/api/lideres", //              selects
  "/api/isc", //                  ISC
  "/api/isc/pendentes",
  "/api/isc/comparativo",
  "/api/historico/lider", //      tela Resultados
];

/** Telas que o menu do líder oferece. */
const TELAS_DO_LIDER = ["/dashboard", "/meus-projetos", "/pesquisas", "/isc", "/resultados"];

/** Telas que só o PMO tem no menu. */
const TELAS_SO_PMO = [
  "/projetos",
  "/projetos/abc-123",
  "/respondentes",
  "/ciclos",
  "/operacao-ciclo",
  "/clientes",
  "/lideres",
  "/historico",
];

describe("rotas públicas", () => {
  test("login, logout e a pergunta 'tem alguém logado?' são públicos", () => {
    for (const r of ["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/sessao"]) {
      assert.equal(ehPublica(r), true, r);
    }
  });

  test("o formulário da pesquisa é público — quem responde é o cliente", () => {
    assert.equal(ehPublica("/pesquisa/AbC123xyz"), true);
    assert.equal(ehPublica("/api/responder"), true);
    assert.equal(ehPublica("/api/responder?token=abc"), true);
  });

  test("comparação exata, não prefixo, nas rotas de sessão", () => {
    // `startsWith` deixaria estas passarem como públicas.
    assert.equal(ehPublica("/login-falso"), false);
    assert.equal(ehPublica("/api/auth/loginX"), false);
    assert.equal(ehPublica("/api/auth/sessaoX"), false);
  });

  test("tela interna não é pública", () => {
    for (const r of [...TELAS_DO_LIDER, ...TELAS_SO_PMO, "/api/projetos"]) {
      assert.equal(ehPublica(r), false, r);
    }
  });
});

describe("o que o líder precisa alcançar", () => {
  test("nenhuma API usada pelas telas do líder é bloqueada no middleware", () => {
    // A regra dessas rotas não é "só PMO": é ler recortado / escrever como
    // PMO. Quem aplica isso é a rota, que enxerga o método e a consulta.
    for (const rota of API_QUE_O_LIDER_USA) {
      assert.equal(
        ehSoPmo(rota),
        false,
        `${rota} está bloqueada no middleware e o líder precisa dela`
      );
    }
  });

  test("as telas do menu do líder passam", () => {
    for (const tela of TELAS_DO_LIDER) {
      assert.equal(ehSoPmo(tela), false, tela);
    }
  });
});

describe("o que o líder não pode alcançar", () => {
  test("as telas do menu do PMO são barradas", () => {
    for (const tela of TELAS_SO_PMO) {
      assert.equal(ehSoPmo(tela), true, tela);
    }
  });

  test("a auditoria e as contas de acesso são as únicas APIs exclusivas", () => {
    assert.equal(ehSoPmo("/api/auditoria"), true);
    assert.equal(ehSoPmo("/api/usuarios"), true);

    const apisBloqueadas = PREFIXOS_SO_PMO.filter((p) => p.startsWith("/api/"));
    assert.deepEqual(
      apisBloqueadas,
      ["/api/auditoria", "/api/usuarios"],
      "outra rota de API entrou na lista de exclusivas — confira se o líder não depende dela"
    );
  });
});
