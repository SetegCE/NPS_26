// Login por e-mail e senha.
//
// ── O que saiu daqui ──────────────────────────────────────────────────────
//
// A versao anterior nao tinha usuario: a senha ERA a identidade. Havia uma
// senha global do PMO em `config_acesso` e uma por lider em
// `acessos_lideres`, e autenticar significava varrer as duas tabelas
// comparando a senha digitada contra cada linha.
//
// Isso tinha tres consequencias praticas: a auditoria registrava "Acesso como
// pmo" sem dizer quem; desligar uma pessoa obrigava a trocar a senha de todos
// que a conheciam; e o custo do login crescia com o numero de lideres, porque
// era um scrypt por linha.
//
// Agora e uma busca por e-mail (indice unico) e UM scrypt. As duas tabelas
// antigas continuam no banco como registro historico, mas nao sao mais
// consultadas por ninguem.
//
// Importa node:crypto atraves de lib/senha.ts e portanto roda somente em
// runtime Node.js, nunca em Edge.

import { atualizar, um } from "@/lib/db";
import { conferirHash, impressaoDaCredencial } from "@/lib/senha";
import { PERFIL_LIDER, PERFIL_PMO, type Perfil, type SessaoPayload } from "@/lib/token";

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  senha_hash: string;
  papel: Perfil;
  lider_id: string | null;
  ativo: boolean;
}

export type ResultadoLogin =
  | { ok: true; sessao: SessaoPayload }
  | { ok: false; motivo: "credencial_invalida" | "conta_inativa" | "banco_indisponivel" };

/**
 * Confere e-mail e senha.
 *
 * Devolve o motivo da recusa para a AUDITORIA, nunca para a tela: quem errou
 * recebe sempre a mesma mensagem, porque distinguir "este e-mail nao existe"
 * de "a senha esta errada" entrega a quem tenta adivinhar a lista de quem tem
 * conta no sistema.
 */
export async function autenticar(
  emailBruto: unknown,
  senha: unknown
): Promise<ResultadoLogin> {
  if (typeof emailBruto !== "string" || typeof senha !== "string" || !emailBruto || !senha) {
    return { ok: false, motivo: "credencial_invalida" };
  }
  // 254 e o limite pratico de e-mail (RFC 5321); 200 e folga para a senha.
  // O scrypt trunca bem antes — isto so rejeita payload absurdo cedo, antes
  // de gastar CPU derivando o hash.
  if (emailBruto.length > 254 || senha.length > 200) {
    return { ok: false, motivo: "credencial_invalida" };
  }

  const email = emailBruto.trim().toLowerCase();

  let usuario: LinhaUsuario | null;
  try {
    usuario = await um<LinhaUsuario>(
      "usuarios_nps",
      { email_norm: email },
      "id,nome,email,senha_hash,papel,lider_id,ativo"
    );
  } catch (e) {
    // Banco fora do ar NAO e credencial errada. Sem esta distincao, a tela
    // culparia a pessoa por uma falha de infraestrutura e a faria tentar a
    // senha de novo.
    console.error("[NPS][login] banco indisponivel:", e);
    return { ok: false, motivo: "banco_indisponivel" };
  }

  if (!usuario) return { ok: false, motivo: "credencial_invalida" };
  if (!usuario.ativo) return { ok: false, motivo: "conta_inativa" };
  if (!(await conferirHash(senha, usuario.senha_hash))) {
    return { ok: false, motivo: "credencial_invalida" };
  }

  // "Ultimo acesso" e informacao de apoio. Falhar aqui nao pode impedir um
  // login que ja foi validado.
  try {
    await atualizar(
      "usuarios_nps",
      { id: usuario.id },
      { ultimo_acesso_em: new Date().toISOString() }
    );
  } catch (e) {
    console.warn("[NPS][login] nao foi possivel registrar o ultimo acesso:", e);
  }

  return {
    ok: true,
    sessao: {
      usuarioId: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.papel === PERFIL_PMO ? PERFIL_PMO : PERFIL_LIDER,
      // O PMO enxerga tudo: escopo nulo mesmo que a conta tenha lider_id.
      liderId: usuario.papel === PERFIL_PMO ? null : usuario.lider_id,
      cred: impressaoDaCredencial(usuario.senha_hash),
    },
  };
}
