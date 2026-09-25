"use client";

import { useRef, useState, type FormEvent } from "react";

// Texto identico ao do formulario em uso, para que a serie historica de
// respostas continue comparavel. Nao reescrever sem alinhar com o PMO: mudar
// o enunciado muda o que a nota significa.
const PERGUNTAS = [
  { campo: "nota_q1", titulo: "De 0 a 10 qual nota você atribui ao trabalho da Seteg?" },
  {
    campo: "nota_q2",
    titulo: "De 0 a 10 o quanto você está satisfeito com o seu relacionamento com nossa equipe?",
  },
  {
    campo: "nota_q3",
    titulo: "De 0 a 10 o quão efetiva é a comunicação com os canais de acesso a Seteg?",
  },
  {
    campo: "nota_q4",
    titulo:
      "De 0 a 10 o quanto você nos indicaria a um amigo, familiar ou parceiro de negócios?",
  },
] as const;

const PERGUNTA_ABERTA = "Quais suas sugestões de melhorias, elogios e feedbacks gerais?";

type Campo = (typeof PERGUNTAS)[number]["campo"];

export interface Contexto {
  respondente: string;
}

/** "RAFAELLA ARAÚJO" ou "rafaella araújo" → "Rafaella Araújo", como no modelo. */
function nomeExibicao(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function MensagemFinal({
  tipo,
  titulo,
  texto,
}: {
  tipo: "ok" | "erro";
  titulo: string;
  texto: string;
}) {
  return (
    <div className="pq-final" role={tipo === "erro" ? "alert" : "status"}>
      <div className={`pq-icone${tipo === "erro" ? " erro" : ""}`}>
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {tipo === "ok" ? <polyline points="20 6 9 17 4 12" /> : <path d="M12 7v6M12 17h.01" />}
        </svg>
      </div>
      <h2>{titulo}</h2>
      <p>{texto}</p>
    </div>
  );
}

export function FormularioPesquisa({
  token,
  contexto,
}: {
  token: string;
  contexto: Contexto;
}) {
  const [notas, setNotas] = useState<Partial<Record<Campo, number>>>({});
  const [feedback, setFeedback] = useState("");
  const [faltando, setFaltando] = useState<Campo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const refs = useRef<Partial<Record<Campo, HTMLFieldSetElement | null>>>({});

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    // As quatro notas sao obrigatorias (decisao do PMO). A primeira que
    // faltar recebe o aviso e a tela rola ate ela.
    const pendente = PERGUNTAS.find((p) => notas[p.campo] === undefined);
    if (pendente) {
      setFaltando(pendente.campo);
      refs.current[pendente.campo]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setEnviando(true);
    try {
      const resposta = await fetch("/api/responder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...notas, feedback }),
      });
      const corpo = await resposta.json().catch(() => null);

      if (!resposta.ok) {
        setErro(corpo?.mensagem || "Não foi possível registrar sua resposta.");
        setEnviando(false);
        return;
      }
      setEnviada(true);
    } catch {
      setErro("Falha de conexão. Tente novamente.");
      setEnviando(false);
    }
  }

  const nome = nomeExibicao(contexto.respondente);

  return (
    <>
      <div className="pq-cabecalho">
        <p className="pq-saudacao">{nome ? `Olá, ${nome}` : "Olá"}</p>
        <p className="pq-intro">
          Sua opinião é essencial para aprimorarmos continuamente nosso atendimento e serviços.
        </p>
      </div>

      <form className="pq-form" onSubmit={enviar} noValidate>
        {PERGUNTAS.map((p, i) => (
          <fieldset
            key={p.campo}
            className="pq-pergunta"
            disabled={enviando || enviada}
            ref={(el) => {
              refs.current[p.campo] = el;
            }}
          >
            <legend>
              {i + 1}. {p.titulo}
              {/* Espaco inquebravel: o asterisco nunca fica sozinho na linha. */}
              {" "}
              <span className="pq-asterisco" aria-hidden="true">*</span>
              <span className="pq-so-leitor"> (obrigatória)</span>
            </legend>
            <div className="pq-notas">
              {Array.from({ length: 11 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  className="pq-nota"
                  aria-pressed={notas[p.campo] === n}
                  aria-label={`Nota ${n}`}
                  onClick={() => {
                    setNotas((atuais) => ({ ...atuais, [p.campo]: n }));
                    if (faltando === p.campo) setFaltando(null);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="pq-erro">
              {faltando === p.campo ? "Por favor, selecione uma nota." : ""}
            </span>
          </fieldset>
        ))}

        <div className="pq-pergunta pq-feedback">
          <label htmlFor="pq-feedback">5. {PERGUNTA_ABERTA}</label>
          <textarea
            id="pq-feedback"
            name="feedback"
            className="pq-textarea"
            maxLength={4000}
            placeholder="Digite sua resposta aqui..."
            value={feedback}
            disabled={enviando || enviada}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <span className="pq-erro" role="alert">
            {erro || ""}
          </span>
        </div>

        <button type="submit" className="pq-enviar" disabled={enviando || enviada}>
          {enviando ? "Processando..." : "Enviar Respostas"}
        </button>
        {enviando ? <div className="pq-processando">Processando sua resposta...</div> : null}
      </form>

      {/* Sem botão de fechar: o link vale para uma única resposta, então não
          há formulário para "zerar" e enviar de novo, como havia no modelo. */}
      {enviada ? (
        <div className="pq-sobreposicao">
          <MensagemFinal
            tipo="ok"
            titulo="Muito obrigado!"
            texto="Agradecemos imensamente a sua confiança e o tempo dedicado para compartilhar sua opinião. Sua resposta é fundamental para continuarmos evoluindo."
          />
        </div>
      ) : null}
    </>
  );
}
