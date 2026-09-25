// Contas de acesso ao Dashboard NPS (usuarios_nps).
//
// Fica separado de lib/cadastros.ts de proposito: la o assunto e o CADASTRO
// (quem existe como lider e aparece nos selects), aqui e a CREDENCIAL (quem
// consegue entrar). Sao duas tabelas e duas decisoes diferentes, e confundi-las
// custa caro nos dois sentidos:
//
//  - inativar o CADASTRO de um lider tira o nome das listagens ativas e nao
//    derruba a sessao dele — ele continua entrando e vendo os projetos;
//  - desativar a CONTA bloqueia o login na requisicao seguinte, porque
//    lib/session.ts reconfere `ativo` no banco a cada chamada, e nao deixa o
//    cadastro nem o historico de lideranca de lado.
//
// Ler e escrever aqui e exclusivo do PMO: a lista carrega e-mail, papel e
// ultimo acesso de todo mundo, e isso nao e assunto de lider. O middleware ja
// barra /api/usuarios (lib/rotas.ts), e `exigirPmo` repete a checagem — a
// ultima barreira e sempre a rota, que e quem enxerga o banco.

import { NextResponse } from "next/server";
import {
  booleano,
  erro,
  json,
  lerCorpo,
  ordenacao,
  paginacao,
  texto,
  textoObrigatorio,
  umDe,
  uuid,
} from "@/lib/http";
import { atualizar, auditar, type FiltroValor, inserir, selecionar, um } from "@/lib/db";
import { gerarHash } from "@/lib/senha";
import { exigirPmo } from "@/lib/session";

/**
 * Colunas que podem atravessar a fronteira servidor→cliente.
 *
 * `senha_hash` NUNCA entra nesta lista. Ele nao e a senha, mas tambem nao tem
 * por que sair do servidor — e um `select *` aqui o mandaria junto, dentro do
 * payload da resposta, legivel por qualquer um que abrisse o inspetor. E o
 * mesmo cuidado que a tela de acessos do SGA toma com o `select` explicito.
 */
const COLUNAS = "id,nome,email,papel,lider_id,ativo,ultimo_acesso_em,created_at";

const ORDENAVEIS = ["nome", "email", "ultimo_acesso_em", "created_at"] as const;

/**
 * Piso de 7 caracteres, definido pela Seteg.
 *
 * Fica abaixo dos 12 que o SGA pede, e a diferenca e real: contra quem tem o
 * hash, o que protege e o COMPRIMENTO, nao a mistura de simbolos. O scrypt
 * deste sistema e lento e memory-hard de proposito (lib/senha.ts), o que
 * encarece muito a forca bruta, mas nao compensa a diferenca inteira.
 *
 * Quem for definir uma senha aqui ganha mais protegendo com uma frase curta
 * de tres ou quatro palavras do que com sete caracteres cheios de simbolos —
 * e ainda lembra dela, que e o que evita o bilhete colado no monitor.
 */
const SENHA_MINIMA = 7;

/** Teto alinhado a lib/autenticar.ts, que recusa senha maior que isto no login. */
const SENHA_MAXIMA = 200;

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function senhaValida(valor: unknown): string {
  const v = typeof valor === "string" ? valor : "";
  if (v.length < SENHA_MINIMA) {
    throw erro(
      400,
      "SENHA_CURTA",
      `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`
    );
  }
  if (v.length > SENHA_MAXIMA) {
    throw erro(400, "SENHA_LONGA", `A senha excede ${SENHA_MAXIMA} caracteres.`);
  }
  return v;
}

function emailValido(valor: unknown, campo = "email"): string {
  const v = textoObrigatorio(valor, campo, 200).toLowerCase();
  // O banco tem a mesma checagem em constraint. Repetir aqui é o que troca um
  // erro cru do Postgres por uma frase que a tela sabe mostrar.
  if (!RE_EMAIL.test(v)) {
    throw erro(400, "EMAIL_INVALIDO", "Informe um e-mail valido.");
  }
  return v;
}

export interface Conta extends Record<string, unknown> {
  id: string;
  nome: string;
  email: string;
  papel: "pmo" | "lider";
  lider_id: string | null;
  ativo: boolean;
  ultimo_acesso_em: string | null;
}

/** Listagem das contas. Filtros opcionais: `papel` e `ativo`. */
export async function listarContas(req: Request): Promise<NextResponse> {
  await exigirPmo();
  const query = new URL(req.url).searchParams;

  const { pagina, porPagina, de, ate } = paginacao(query);
  const ordem = ordenacao(query, ORDENAVEIS, "nome");

  const filtros: Record<string, FiltroValor> = {};
  const papel = umDe(query.get("papel"), ["pmo", "lider"] as const, "papel");
  if (papel) filtros.papel = papel;
  const ativo = booleano(query.get("ativo"), null);
  if (ativo !== null) filtros.ativo = ativo;

  const { dados, total } = await selecionar<Conta[]>("usuarios_nps", {
    colunas: COLUNAS,
    filtros,
    ordem,
    de,
    ate,
    contar: true,
  });

  return json({ itens: dados || [], total: total ?? 0, pagina, porPagina });
}

/**
 * Tira do registro o que nao pode sair do servidor.
 *
 * `inserir` e `atualizar` pedem `return=representation` ao PostgREST, e a
 * representacao vem com TODAS as colunas — inclusive `senha_hash`. Tipar o
 * retorno como `Conta` nao remove nada em tempo de execucao: o campo viajaria
 * do mesmo jeito dentro do JSON da resposta. Esta funcao e o unico caminho de
 * volta para a tela.
 */
function semSegredo(registro: Record<string, unknown>): Conta {
  const { senha_hash: _descartado, ...resto } = registro;
  return resto as unknown as Conta;
}

/**
 * Cria a conta de acesso de um lider.
 *
 * A senha e derivada AQUI, com scrypt, e so o hash chega ao banco — o mesmo
 * contrato de scripts/seed-usuarios.mjs. A senha em claro vive o tempo de uma
 * requisicao: nao e gravada, nao volta na resposta e NUNCA entra na
 * auditoria, que registra apenas que houve uma definicao de senha.
 */
export async function criarConta(req: Request): Promise<NextResponse> {
  const sessao = await exigirPmo();
  const corpo = await lerCorpo(req);

  const liderId = uuid(corpo.liderId, "liderId");
  const email = emailValido(corpo.email);
  const senha = senhaValida(corpo.senha);

  const lider = await um<{ id: string; nome: string; email: string | null }>(
    "lideres_nps",
    { id: liderId },
    "id,nome,email"
  );
  if (!lider) throw erro(404, "NAO_ENCONTRADO", "Lider nao encontrado.");

  // Uma conta por lider. Duas seriam duas senhas validas para a mesma pessoa,
  // e desativar uma delas deixaria a outra entrando — exatamente o buraco que
  // a tela de acessos existe para fechar.
  const existente = await um<Conta>(
    "usuarios_nps",
    { lider_id: liderId, papel: "lider" },
    "id,email"
  );
  if (existente) {
    throw erro(
      409,
      "CONTA_EXISTENTE",
      `${lider.nome} ja tem conta de acesso. Use "redefinir senha".`
    );
  }

  const nome = texto(corpo.nome, "nome", { max: 200 }) || lider.nome;

  let criada: Record<string, unknown>;
  try {
    [criada] = await inserir<Record<string, unknown>[]>("usuarios_nps", {
      nome,
      email,
      senha_hash: await gerarHash(senha),
      papel: "lider",
      lider_id: liderId,
      ativo: true,
    });
  } catch (e) {
    // `email_norm` e unico no banco. Traduzir aqui evita que a tela mostre a
    // mensagem crua do Postgres, que cita indice e coluna.
    if (e instanceof Error && /duplicate key|ja existe|unique/i.test(e.message)) {
      throw erro(409, "EMAIL_DUPLICADO", "Ja existe uma conta com este e-mail.");
    }
    throw e;
  }

  // O cadastro do lider guarda uma copia do e-mail, so para exibicao. Se
  // estiver vazio, preenche com o mesmo que acabou de virar login — senao a
  // tela mostraria "—" ao lado de uma conta que existe.
  if (!lider.email) {
    try {
      await atualizar("lideres_nps", { id: liderId }, { email });
    } catch (e) {
      console.warn("[NPS][acessos] nao foi possivel copiar o e-mail para o cadastro:", e);
    }
  }

  await auditar({
    acao: "criar",
    entidade: "conta_acesso",
    registroId: criada.id as string,
    descricao: `conta de acesso criada para ${nome} (${email})`,
    atorTipo: "pmo",
    atorNome: sessao.nome,
    depois: { nome, email, papel: "lider", lider_id: liderId, ativo: true },
  });

  return json({ item: semSegredo(criada) }, 201);
}

/**
 * Altera uma conta: liga/desliga o acesso, redefine a senha, ou as duas.
 *
 * Sao os dois unicos campos que esta tela mexe. Nome e e-mail ficam de fora
 * de proposito: o e-mail e a IDENTIDADE da conta (`email_norm` e unico e e
 * por ele que o login busca), e deixar que se troque por um campo de tela
 * transformaria "corrigir um typo" em "assumir outra conta".
 */
export async function editarConta(req: Request): Promise<NextResponse> {
  const sessao = await exigirPmo();
  const corpo = await lerCorpo(req);
  const id = uuid(corpo.id, "id");

  const mexeNoAtivo = "ativo" in corpo;
  const mexeNaSenha = "senha" in corpo;
  if (!mexeNoAtivo && !mexeNaSenha) {
    throw erro(400, "NADA_A_ALTERAR", "Nenhum campo informado.");
  }

  const antes = await um<Conta>("usuarios_nps", { id }, COLUNAS);
  if (!antes) throw erro(404, "NAO_ENCONTRADO", "Conta de acesso nao encontrada.");

  const campos: Record<string, unknown> = {};
  let novoAtivo: boolean | null = null;

  if (mexeNoAtivo) {
    novoAtivo = booleano(corpo.ativo, null);
    if (novoAtivo === null) {
      throw erro(400, "CAMPO_INVALIDO", 'Campo "ativo" invalido.');
    }
    // Desativar a propria conta derrubaria quem esta no comando na requisicao
    // seguinte, e nao sobraria ninguem para desfazer sem mexer no banco a mao.
    // Mesma regra da tela de acessos do SGA, e pelo mesmo motivo.
    if (id === sessao.usuarioId) {
      throw erro(
        400,
        "CONTA_PROPRIA",
        "Voce nao pode desativar a propria conta. Peca a outro PMO."
      );
    }
    // Ja esta como pedido: a lista da tela pode estar um pouco velha, e isso
    // nao e erro de quem clicou.
    if (novoAtivo !== antes.ativo) campos.ativo = novoAtivo;
  }

  if (mexeNaSenha) {
    // Trocar a senha muda a impressao digital da credencial e, com ela,
    // derruba TODA sessao aberta com a senha antiga — inclusive a de quem
    // esta redefinindo, se for a propria conta (ver lib/senha.ts).
    campos.senha_hash = await gerarHash(senhaValida(corpo.senha));
  }

  if (!Object.keys(campos).length) return json({ item: antes });

  const [depois] = await atualizar<Record<string, unknown>[]>("usuarios_nps", { id }, campos);

  if ("ativo" in campos) {
    await auditar({
      acao: novoAtivo ? "reativar" : "desativar",
      entidade: "conta_acesso",
      registroId: id,
      descricao: `acesso de ${antes.nome} (${antes.email}) ${novoAtivo ? "reativado" : "desativado"}`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      antes: { ativo: antes.ativo },
      depois: { ativo: novoAtivo },
    });
  }

  if ("senha_hash" in campos) {
    // Sem `antes`/`depois`: nem a senha nem o hash entram na trilha. O que
    // importa auditar e QUEM redefiniu a senha de QUEM, e quando.
    await auditar({
      acao: "redefinir_senha",
      entidade: "conta_acesso",
      registroId: id,
      descricao: `senha de ${antes.nome} (${antes.email}) redefinida`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
    });
  }

  return json({ item: semSegredo(depois) });
}
