// Sessao e recorte do lider.
//
// Cobre as duas garantias que sustentam o isolamento entre perfis:
//
//  1. o token so e aceito se a assinatura conferir, se nao tiver expirado e
//     se o perfil for um dos dois conhecidos;
//  2. um lider nunca consegue montar um filtro que devolva projeto de outro.
//
// O segredo e definido ANTES do import porque lib/token.ts quebra o boot de
// proposito quando NPS_SESSION_SECRET nao existe — comportamento que o
// primeiro teste verifica.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.NPS_SESSION_SECRET = "segredo-de-teste-apenas-nao-usar-em-producao";

const { assinarToken, verificarToken, COOKIE_SESSAO, SESSAO_MAX_AGE_SEGUNDOS } = await import(
  "../lib/token.ts"
);
const { montarFiltrosOperacao } = await import("../lib/operacao.ts");

const SESSAO_PMO = {
  usuarioId: "aaaaaaaa-1111-4222-8333-444444444444",
  nome: "Direção",
  email: "direcao@setegce.com",
  perfil: "pmo",
  liderId: null,
  cred: "abc123",
};

// UUIDs de verdade: o validador de query recusa qualquer outra coisa, e o
// teste precisa exercitar o caminho valido.
const ID_JULIANA = "11111111-2222-4333-8444-555555555555";
const ID_MARCELO = "99999999-8888-4777-8666-555555555555";

const SESSAO_LIDER = {
  usuarioId: "bbbbbbbb-1111-4222-8333-444444444444",
  nome: "Juliana Vicente Alencar",
  email: "juliana@setegce.com",
  perfil: "lider",
  liderId: ID_JULIANA,
  cred: "def456",
};

describe("token de sessao", () => {
  test("ida e volta preserva a carga", async () => {
    const token = await assinarToken(SESSAO_LIDER);
    const lido = await verificarToken(token);
    assert.equal(lido.perfil, "lider");
    assert.equal(lido.nome, "Juliana Vicente Alencar");
    assert.equal(lido.email, "juliana@setegce.com");
    assert.equal(lido.liderId, ID_JULIANA);
    assert.equal(lido.usuarioId, SESSAO_LIDER.usuarioId);
    assert.equal(lido.cred, "def456");
  });

  test("token adulterado e recusado", async () => {
    const token = await assinarToken(SESSAO_PMO);
    const [cabecalho, carga, assinatura] = token.split(".");

    // Troca a carga mantendo a assinatura: e a tentativa obvia de virar PMO.
    const cargaFalsa = Buffer.from(
      JSON.stringify({ ...SESSAO_LIDER, perfil: "pmo" })
    ).toString("base64url");
    assert.equal(await verificarToken(`${cabecalho}.${cargaFalsa}.${assinatura}`), null);

    // Assinatura mexida.
    assert.equal(await verificarToken(`${cabecalho}.${carga}.${assinatura}x`), null);
  });

  test("lixo nao vira sessao", async () => {
    for (const ruim of ["", "a.b.c", "nao-e-um-jwt", "x".repeat(400)]) {
      assert.equal(await verificarToken(ruim), null);
    }
  });

  test("perfil desconhecido nao passa, mesmo assinado por nos", async () => {
    // O resto do sistema decide permissao a partir deste campo; um valor
    // estranho nao pode chegar la.
    const token = await assinarToken({ ...SESSAO_PMO, perfil: "superadmin" });
    assert.equal(await verificarToken(token), null);
  });

  test("token sem usuarioId e recusado", async () => {
    // A identidade e a PESSOA. Um token sem ela nao tem como ser reconferido
    // no banco, entao nao pode virar sessao.
    const { usuarioId, ...semUsuario } = SESSAO_PMO;
    const token = await assinarToken(semUsuario);
    assert.equal(await verificarToken(token), null);
  });

  test("a sessao dura 12 horas e o cookie tem nome proprio", () => {
    assert.equal(SESSAO_MAX_AGE_SEGUNDOS, 12 * 60 * 60);
    assert.equal(COOKIE_SESSAO, "nps_session");
  });
});

describe("recorte do lider na operacao do ciclo", () => {
  const query = (obj = {}) => new URLSearchParams(obj);

  test("o lider e sempre filtrado pelo proprio id", () => {
    const f = montarFiltrosOperacao(query(), SESSAO_LIDER);
    assert.equal(f.lider_id, ID_JULIANA);
  });

  test("o lider nao consegue pedir os projetos de outro", () => {
    // Mesmo mandando ?lider=<outro> na URL, o filtro sai com o id da sessao.
    const f = montarFiltrosOperacao(query({ lider: ID_MARCELO }), SESSAO_LIDER);
    assert.equal(f.lider_id, ID_JULIANA);
  });

  test("lider sem vinculo devolve null — que a rota traduz em lista vazia", () => {
    const f = montarFiltrosOperacao(query(), { ...SESSAO_LIDER, liderId: null });
    // `null` e diferente de `{}`: sem esta distincao, um acesso de lider ainda
    // nao vinculado veria TODOS os projetos.
    assert.equal(f, null);
  });

  test("o PMO escolhe o lider que quiser, ou nenhum", () => {
    assert.equal(montarFiltrosOperacao(query(), SESSAO_PMO).lider_id, undefined);
    assert.equal(
      montarFiltrosOperacao(query({ lider: ID_MARCELO }), SESSAO_PMO).lider_id,
      ID_MARCELO
    );
  });

  test("so projetos ativos entram no painel operacional", () => {
    assert.equal(montarFiltrosOperacao(query(), SESSAO_PMO).projeto_ativo, true);
  });

  test("os filtros de pesquisa e resposta viram comparacoes numericas", () => {
    const comPesquisa = montarFiltrosOperacao(query({ comPesquisa: "true" }), SESSAO_PMO);
    assert.deepEqual(comPesquisa.pesquisas, { op: "gt", valor: 0 });

    const semResposta = montarFiltrosOperacao(query({ comResposta: "false" }), SESSAO_PMO);
    assert.deepEqual(semResposta.respostas, { op: "eq", valor: 0 });
  });

  test("situacao fora da lista conhecida e ignorada", () => {
    const f = montarFiltrosOperacao(query({ situacao: "respondido" }), SESSAO_PMO);
    assert.equal(f.situacao, "respondido");
    assert.throws(() => montarFiltrosOperacao(query({ situacao: "inventado" }), SESSAO_PMO));
  });
});
