import { NextResponse } from "next/server";
import { autenticar } from "@/lib/autenticar";
import { auditar } from "@/lib/db";
import { erro, json, lerCorpo, rotaApi } from "@/lib/http";
import {
  chaveDoFreio,
  obterIpCliente,
  registrarFalha,
  registrarSucesso,
  verificarLimite,
} from "@/lib/rateLimit";
import { assinarToken, COOKIE_SESSAO, SESSAO_MAX_AGE_SEGUNDOS } from "@/lib/token";

export const dynamic = "force-dynamic";
// scrypt vem de node:crypto: esta rota nao roda em Edge.
export const runtime = "nodejs";

/**
 * Registra um evento de seguranca na auditoria do sistema.
 *
 * Antes isto so ia para `console`. Log de console na Vercel tem retencao
 * curta e ninguem abre o painel para procurar — na pratica, um ataque de
 * forca bruta passaria despercebido. Gravado na mesma tabela de auditoria do
 * resto, vira algo que da para consultar com SQL depois ("quantas tentativas
 * falharam esta semana, e de onde").
 *
 * Grava o e-mail tentado, nunca a senha.
 */
async function registrarEventoSeguranca(
  acao: string,
  ip: string,
  email: string,
  motivo?: string
) {
  console.warn(`[SECURITY] ${acao} ip=${ip} email=${email}${motivo ? ` motivo=${motivo}` : ""}`);
  await auditar({
    acao,
    entidade: "sessao",
    registroId: null,
    descricao: motivo ? `${acao} (${motivo})` : acao,
    // "sistema" e nao "anonimo": `auditoria_nps.ator_tipo` tem CHECK que so
    // aceita pmo | lider | sistema | respondente. Quem falhou o login nao tem
    // identidade confirmada — o evento e do sistema.
    atorTipo: "sistema",
    atorNome: email || ip,
    depois: { ip, email, ...(motivo ? { motivo } : {}) },
  });
}

export async function POST(req: Request) {
  return rotaApi(async () => {
    const corpo = await lerCorpo(req);
    const emailBruto = typeof corpo.email === "string" ? corpo.email : "";
    const email = emailBruto.trim().toLowerCase();

    // Freio de forca bruta por IP + e-mail, contado no banco.
    const ip = obterIpCliente(req);
    const chave = chaveDoFreio(ip, email);

    const limite = await verificarLimite(chave);
    if (limite.bloqueado) {
      await registrarEventoSeguranca("login_bloqueado", ip, email);
      throw erro(
        429,
        "MUITAS_TENTATIVAS",
        `Muitas tentativas com credenciais inválidas. Tente novamente em ${limite.segundosRestantes} segundos.`
      );
    }

    const r = await autenticar(corpo.email, corpo.senha);

    if (!r.ok) {
      // Banco fora do ar nao e culpa de quem esta tentando entrar: 503 com
      // mensagem propria, e sem contar como tentativa no freio.
      if (r.motivo === "banco_indisponivel") {
        throw erro(
          503,
          "BANCO_INDISPONIVEL",
          "O sistema não conseguiu falar com o banco de dados. Tente de novo em instantes."
        );
      }

      await registrarFalha(chave);
      await registrarEventoSeguranca("login_falhou", ip, email, r.motivo);

      // Mesma mensagem para "e-mail inexistente", "conta inativa" e "senha
      // errada". Diferenciar entregaria a quem tenta adivinhar quais e-mails
      // tem conta no sistema.
      throw erro(401, "CREDENCIAL_INVALIDA", "E-mail ou senha incorretos.");
    }

    await registrarSucesso(chave);
    await auditar({
      acao: "login",
      entidade: "sessao",
      registroId: null,
      descricao: `Acesso de ${r.sessao.nome}`,
      atorTipo: r.sessao.perfil,
      atorNome: r.sessao.nome,
      depois: { email: r.sessao.email, ip },
    });

    const token = await assinarToken(r.sessao);

    // O corpo devolve apenas o que a interface precisa exibir. O TOKEN NAO VAI
    // AQUI: ele viaja so no cookie httpOnly, que o JavaScript da pagina nao
    // le. Era exatamente isso que o token no localStorage da versao anterior
    // permitia — um XSS roubava a sessao inteira.
    const resposta = NextResponse.json({
      perfil: r.sessao.perfil,
      nome: r.sessao.nome,
      email: r.sessao.email,
      liderId: r.sessao.liderId,
    });

    resposta.cookies.set(COOKIE_SESSAO, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSAO_MAX_AGE_SEGUNDOS,
    });

    return resposta;
  });
}

export async function GET() {
  return json({ erro: "METODO_NAO_PERMITIDO", mensagem: "Use POST para autenticar." }, 405);
}
