"use client";

// Os tres paineis da faixa de analise: metas, origem das respostas e
// desempenho por pergunta.

import { META_COBERTURA, META_NPS, PERGUNTAS, type Metricas } from "@/lib/dashboard";

function corDoNps(valor: number): string {
  if (valor >= 50) return "var(--seteg-green)";
  if (valor >= 0) return "var(--seteg-yellow)";
  return "var(--danger)";
}

function corDoTermometro(score: number): string {
  if (score >= 8) return "linear-gradient(90deg, #22c55e, #3f6fd9)";
  if (score >= 5) return "linear-gradient(90deg, #f59e0b, #22c55e)";
  return "linear-gradient(90deg, #ef4444, #f59e0b)";
}

export function Metas({ m }: { m: Metricas }) {
  const metaNpsBatida = m.nps >= META_NPS;
  // O NPS vai de -100 a 100; a altura do tubo mapeia essa faixa inteira.
  const npsFill = Math.max(0, Math.min(((m.nps + 100) / 200) * 100, 100));
  const npsMarcador = ((META_NPS + 100) / 200) * 100;
  const cor = corDoNps(m.nps);

  const npsBg = metaNpsBatida
    ? "linear-gradient(0deg,var(--seteg-green),#15803d)"
    : cor === "var(--danger)"
      ? "linear-gradient(0deg,var(--danger),#c44)"
      : "linear-gradient(0deg,var(--seteg-yellow),#b45309)";

  const coberturaBatida = m.percentualProjetos >= META_COBERTURA;
  const coberturaBg = coberturaBatida
    ? "linear-gradient(0deg,var(--seteg-green),#15803d)"
    : "linear-gradient(0deg,var(--danger),#c44)";

  return (
    <>
      <div className="vtermo-grid">
        <div className="vtermo-wrap">
          <div className="vtermo-label">NPS</div>
          <div className="vtermo-tube-area">
            <div className="vtermo-tube">
              <div className="vtermo-fill" style={{ height: `${npsFill}%`, background: npsBg }} />
              <div className="vtermo-goal-marker" style={{ bottom: `${npsMarcador}%` }} />
            </div>
          </div>
          <div className="vtermo-val" style={{ color: cor }}>
            {m.nps}
          </div>
          <div className="vtermo-sub">Meta: {META_NPS}</div>
          <div className={`vtermo-badge ${metaNpsBatida ? "meta-ok" : "meta-fail"}`}>
            {metaNpsBatida ? "✓ OK" : "✗ Baixo"}
          </div>
        </div>

        <div className="vtermo-wrap">
          <div className="vtermo-label">Projetos</div>
          <div className="vtermo-tube-area">
            <div className="vtermo-tube">
              <div
                className="vtermo-fill"
                style={{
                  height: `${Math.min(m.percentualProjetos, 100)}%`,
                  background: coberturaBg,
                }}
              />
              <div className="vtermo-goal-marker" style={{ bottom: `${META_COBERTURA}%` }} />
            </div>
          </div>
          <div
            className="vtermo-val"
            style={{ color: coberturaBatida ? "var(--seteg-green)" : "var(--danger)" }}
          >
            {m.percentualProjetos}%
          </div>
          <div className="vtermo-sub">Meta: {META_COBERTURA}%</div>
          <div className={`vtermo-badge ${coberturaBatida ? "meta-ok" : "meta-fail"}`}>
            {coberturaBatida ? "✓ OK" : "✗ Baixo"}
          </div>
        </div>
      </div>
      <div className="vtermo-detalhe">
        {m.projetosRespondidos} / {m.totalProjetos} projetos
      </div>
    </>
  );
}

export function Origem({ m }: { m: Metricas }) {
  // O total conta tambem o que nao e e-mail nem WhatsApp. Somando so os dois
  // tubos, uma resposta cujo canal_resposta e "LINK" — valor que o banco ja
  // grava — sumia da conta e o rodape anunciava menos respostas do que havia.
  const total = m.totalEmail + m.totalWhatsApp + m.totalOutroCanal;
  const pctEmail = total > 0 ? (m.totalEmail / total) * 100 : 0;
  const pctWhats = total > 0 ? (m.totalWhatsApp / total) * 100 : 0;

  return (
    <>
      <div className="vtermo-grid">
        <div className="vtermo-wrap">
          <div className="vtermo-label">Email</div>
          <div className="vtermo-tube-area">
            <div className="vtermo-tube">
              <div
                className="vtermo-fill"
                style={{
                  height: `${pctEmail.toFixed(1)}%`,
                  background: "linear-gradient(0deg,var(--seteg-medium-blue),#5b9bd5)",
                }}
              />
            </div>
          </div>
          <div className="vtermo-val" style={{ color: "var(--blue-text)" }}>
            {m.totalEmail}
          </div>
          <div className="vtermo-sub">{pctEmail.toFixed(0)}%</div>
          <div
            className="vtermo-badge"
            style={{
              background: "rgba(63,111,217,0.10)",
              color: "var(--blue-text)",
              border: "1px solid rgba(63,111,217,0.28)",
            }}
          >
            EMAIL
          </div>
        </div>

        <div className="vtermo-wrap">
          <div className="vtermo-label">WhatsApp</div>
          <div className="vtermo-tube-area">
            <div className="vtermo-tube">
              <div
                className="vtermo-fill"
                style={{
                  height: `${pctWhats.toFixed(1)}%`,
                  background: "linear-gradient(0deg,#128C7E,#25D366)",
                }}
              />
            </div>
          </div>
          <div className="vtermo-val" style={{ color: "#128C7E" }}>
            {m.totalWhatsApp}
          </div>
          <div className="vtermo-sub">{pctWhats.toFixed(0)}%</div>
          <div
            className="vtermo-badge"
            style={{
              background: "rgba(18,140,126,0.10)",
              color: "#0b6b60",
              border: "1px solid rgba(18,140,126,0.28)",
            }}
          >
            WHATSAPP
          </div>
        </div>
      </div>
      <div className="vtermo-detalhe">
        Total: {total} respostas
        {m.totalOutroCanal > 0
          ? " · " + m.totalOutroCanal + " por outro canal"
          : ""}
      </div>
    </>
  );
}

export function Termometros({ m }: { m: Metricas }) {
  return (
    <>
      {PERGUNTAS.map((titulo, i) => {
        const chave = `Q${i + 1}` as keyof Metricas["porPergunta"];
        const score = m.porPergunta[chave] || 0;
        return (
          <div className="thermo-compact-item" key={chave}>
            <div className="thermo-compact-header">
              <span className="thermo-compact-title">{titulo}</span>
              <span className="thermo-compact-score">{score.toFixed(1)}/10</span>
            </div>
            <div className="thermo-compact-track">
              <div
                className="thermo-compact-fill"
                style={{ width: `${(score / 10) * 100}%`, background: corDoTermometro(score) }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
