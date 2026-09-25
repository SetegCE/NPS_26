"use client";

import { META_COBERTURA, META_NPS, type Metricas } from "@/lib/dashboard";

function corDoNps(valor: number): string {
  if (valor >= 50) return "var(--seteg-green)";
  if (valor >= 0) return "var(--seteg-yellow)";
  return "var(--danger)";
}

function classificacaoNps(nps: number): string {
  if (nps >= 75) return "Excelência";
  if (nps >= 50) return "Qualidade";
  if (nps >= 1) return "Aperfeiçoamento";
  if (nps >= -100) return "Crítica";
  return "N/A";
}

function Meta({ atingida, rotulo }: { atingida: boolean; rotulo: string }) {
  return (
    <div className={`kpi-meta ${atingida ? "meta-ok" : "meta-fail"}`}>
      {atingida ? "✓ Meta Atingida" : `✗ Abaixo da Meta (${rotulo})`}
    </div>
  );
}

export function Kpis({ m, isc }: { m: Metricas; isc: { valor: number | null; carregado: boolean } }) {
  return (
    <section className="kpi-grid">
      <div className="kpi-card nps">
        <div className="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        </div>
        <div className="kpi-content">
          <h3>NPS · Net Promoter Score</h3>
          <div className="kpi-value" style={{ color: corDoNps(m.nps) }}>
            {m.nps}
          </div>
          <div className="kpi-sub">{classificacaoNps(m.nps)}</div>
          <Meta atingida={m.nps >= META_NPS} rotulo={String(META_NPS)} />
        </div>
      </div>

      <div className="kpi-card info">
        <div className="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <div className="kpi-content">
          <h3>Projetos Respondidos</h3>
          <div className="kpi-value">{m.percentualProjetos}%</div>
          <div className="kpi-sub">
            {m.projetosRespondidos} / {m.totalProjetos} projetos
          </div>
          <Meta
            atingida={m.percentualProjetos >= META_COBERTURA}
            rotulo={`${META_COBERTURA}%`}
          />
        </div>
      </div>

      <div className="kpi-card success">
        <div className="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
        </div>
        <div className="kpi-content">
          <h3>Promotores</h3>
          <div className="kpi-value">{m.promotores}</div>
          <div className="kpi-sub">Notas 9 – 10</div>
        </div>
      </div>

      <div className="kpi-card warning">
        <div className="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </div>
        <div className="kpi-content">
          <h3>Neutros</h3>
          <div className="kpi-value">{m.neutros}</div>
          <div className="kpi-sub">Notas 7 – 8</div>
        </div>
      </div>

      <div className="kpi-card danger">
        <div className="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
            <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
          </svg>
        </div>
        <div className="kpi-content">
          <h3>Detratores</h3>
          <div className="kpi-value">{m.detratores}</div>
          <div className="kpi-sub">Notas 0 – 6</div>
        </div>
      </div>

      {/* Respondentes e respostas sao grandezas distintas de "projetos
          respondidos": uma pessoa pode avaliar varios projetos e um projeto
          pode receber varias avaliacoes. */}
      <div className="kpi-card info">
        <div className="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <div className="kpi-content">
          <h3>Respondentes</h3>
          <div className="kpi-value">{m.respondentesDistintos}</div>
          <div className="kpi-sub">
            {m.respostasValidas} resposta{m.respostasValidas === 1 ? "" : "s"} recebida
            {m.respostasValidas === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* ISC: percepcao INTERNA do lider. Indicador separado do NPS,
          destacado em laranja justamente para nao ser confundido com ele. */}
      <div className="kpi-card kpi-card-isc">
        <div className="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.4 7.4H22l-6 4.5 2.3 7.1-6.3-4.6L5.7 21 8 13.9 2 9.4h7.6z" />
          </svg>
        </div>
        <div className="kpi-content">
          <h3>ISC · Percepção Interna</h3>
          <div className="kpi-value">
            {isc.valor === null ? "--" : String(isc.valor).replace(".", ",")}
          </div>
          <div className="kpi-sub">
            {!isc.carregado
              ? "Carregando..."
              : isc.valor === null
                ? "Sem registro na competência"
                : "Média da competência · não compõe o NPS"}
          </div>
        </div>
      </div>
    </section>
  );
}
