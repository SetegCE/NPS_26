"use client";

// Tela de login — painel duplo (marca a esquerda, formulario a direita), a
// mesma do Controle de Folgas e dos demais sistemas Seteg. O HTML e as
// classes vieram inteiros do index.html anterior: a tela nao mudou de cara,
// mudou de motor.
//
// O acesso passou a ser por e-mail e senha. Antes a SENHA era a identidade:
// uma senha global do PMO e uma por lider, compartilhadas. A auditoria
// registrava "Acesso como pmo" sem dizer quem, e desligar uma pessoa obrigava
// a trocar a senha de todos que a conheciam.

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ErroApi } from "@/lib/cliente/api";

function FormularioLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessaoInvalida = searchParams.get("sessao") === "invalida";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(
    sessaoInvalida ? "Sua sessao expirou. Entre novamente." : null
  );
  const [entrando, setEntrando] = useState(false);

  // Chegar aqui com `?sessao=invalida` significa que o cookie tinha
  // assinatura valida mas a credencial nao vale mais (acesso desativado ou
  // senha trocada) — ver middleware.ts e lib/session.ts. O middleware nao
  // consegue limpar esse cookie: ele roda em Edge e nao toca o banco, entao
  // veria a mesma assinatura como valida para sempre. So uma route handler
  // apaga, dai o POST abaixo.
  useEffect(() => {
    if (sessaoInvalida) {
      api.sair().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!email.trim()) {
      setErro("Informe seu e-mail corporativo.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErro("Digite um e-mail válido.");
      return;
    }
    if (!senha) {
      setErro("Informe a senha de acesso.");
      return;
    }

    setEntrando(true);
    try {
      await api.entrar(email, senha);
      router.replace("/dashboard");
      // Sem o refresh, o layout interno renderizaria com a sessao que o
      // servidor tinha em cache (nenhuma) e mandaria de volta para ca.
      router.refresh();
    } catch (e) {
      setErro(
        e instanceof ErroApi ? e.message : "Falha de conexao. Verifique sua internet."
      );
      setEntrando(false);
    }
  }

  return (
    <div id="login-screen" className="login-screen">
      {/* ═══ ESQUERDA: MARCA ═══ */}
      <div className="lp-brand">
        <svg className="lp-bracket lp-bracket-tl" viewBox="0 0 14 14">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>
        <svg className="lp-bracket lp-bracket-bl" viewBox="0 0 14 14">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="lp-brand-line" />

        <div className="lp-brand-center">
          <div className="lp-eyebrow">
            <span className="lp-eyebrow-bar" />
            Modulo corporativo
          </div>

          <div className="lp-logo-wrap">
            <div className="lp-logo-halo-orange" />
            <div className="lp-logo-halo-blue" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="lp-logo-img" src="/imagens/logo.png" alt="Seteg" />
          </div>

          <h1 className="lp-tagline">Net Promoter Score.</h1>
          <p className="lp-description">
            Acompanhe a satisfacao dos clientes por ciclo, projeto e lider —
            <br />
            promotores, neutros e detratores em um so painel.
          </p>

          <div className="lp-module-tag">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            DASHBOARD NPS
          </div>
        </div>

        <div className="lp-brand-bottom">
          <div className="lp-contacts">
            <a href="tel:+558521305263">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              +55 (85) 2130-5263
            </a>
            <span className="lp-contacts-divider" />
            <a href="mailto:contato@setegce.com">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              contato@setegce.com
            </a>
          </div>
        </div>
      </div>

      {/* ═══ DIREITA: FORMULARIO ═══ */}
      <div className="lp-form">
        <svg className="lp-bracket lp-bracket-tr" viewBox="0 0 14 14">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>
        <svg className="lp-bracket lp-bracket-br" viewBox="0 0 14 14">
          <path d="M0 0 L14 0 M0 0 L0 14" stroke="#ff8200" strokeWidth="1.5" fill="none" />
        </svg>

        <div className="lp-form-center">
          <div className="lp-form-inner">
            <h1 className="lp-form-title">Acesse sua conta</h1>
            <p className="lp-form-subtitle">
              Entre com o seu e-mail corporativo.
              <br />
              Cada pessoa tem o seu acesso.
            </p>

            <form className="lp-fields" onSubmit={aoEnviar}>
              <label className="lp-field" htmlFor="email">
                <span className="lp-field-label">E-mail corporativo</span>
                <div className="lp-field-control">
                  <svg
                    className="lp-field-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <input
                    type="email"
                    id="email"
                    placeholder="nome@setegce.com"
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </label>

              <label className="lp-field" htmlFor="senha">
                <span className="lp-field-label">Senha de acesso</span>
                <div className="lp-field-control">
                  <svg
                    className="lp-field-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    type={mostrarSenha ? "text" : "password"}
                    id="senha"
                    placeholder="Digite a senha"
                    required
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                  <button
                    type="button"
                    className="lp-toggle-eye"
                    aria-label="Mostrar/Ocultar senha"
                    tabIndex={-1}
                    onClick={() => setMostrarSenha((v) => !v)}
                  >
                    {mostrarSenha ? (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>

              {erro ? <div className="lp-error">{erro}</div> : null}

              <button type="submit" className="lp-btn-submit" disabled={entrando}>
                <span>{entrando ? "Entrando..." : "Acessar Dashboard"}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </form>

            <div className="lp-trust">
              <span>
                <svg
                  className="i-green"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Conexao criptografada
              </span>
              <span>© 2026 Seteg</span>
            </div>

            <div className="lp-first-access">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 12 7zm1 10a1 1 0 0 1-2 0v-5a1 1 0 0 1 2 0z" />
              </svg>
              <div>
                <div className="lp-first-access-title">Primeiro acesso?</div>
                <div className="lp-first-access-text">
                  Solicite a senha a <a href="mailto:contato@setegce.com">Inovacao</a>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// `useSearchParams` obriga a fronteira de Suspense; sem ela o build reclama
// e a pagina inteira vira renderizacao dinamica no cliente.
export default function PaginaLogin() {
  return (
    <Suspense fallback={<div className="login-screen" />}>
      <FormularioLogin />
    </Suspense>
  );
}
