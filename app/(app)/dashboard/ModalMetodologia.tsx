"use client";

// Modal de metodologia. Conteudo estatico, portado literalmente do
// index.html anterior — e o documento que explica como o indice e apurado.

import { useEffect } from "react";
import { META_COBERTURA, META_NPS } from "@/lib/dashboard";

export function ModalMetodologia({ aoFechar }: { aoFechar: () => void }) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return (
    <div
      className="modal active"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 0 3-3h7z" />
            </svg>
            Metodologia NPS — Seteg
          </h3>
          <button type="button" className="modal-close-btn" aria-label="Fechar" onClick={aoFechar}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body metodologia-body">
          <div className="met-section">
            <h2 className="met-h2">O que é o NPS?</h2>
            <p className="met-p">
              A metodologia <strong>Net Promoter Score (NPS)</strong> é reconhecida
              internacionalmente como uma das principais ferramentas de mensuração da satisfação,
              fidelização e lealdade de clientes. Desenvolvida pela Bain &amp; Company em parceria
              com Fred Reichheld e a Satmetrix Systems, tem como objetivo avaliar, de forma simples
              e padronizada, o nível de recomendação de uma empresa, produto ou serviço.
            </p>
            <div className="met-blockquote">
              &quot;Em uma escala de 0 a 10, o quanto você recomendaria nossa empresa, produto ou
              serviço a um amigo ou colega?&quot;
            </div>
          </div>

          <div className="met-section">
            <h2 className="met-h2">Classificação dos Respondentes</h2>
            <div className="met-categories">
              <div className="met-cat-card promotor">
                <div className="met-cat-title">Promotores</div>
                <div className="met-cat-range">Notas 9 – 10</div>
                <div className="met-cat-desc">
                  Clientes altamente satisfeitos, fiéis e com elevada propensão à recomendação
                </div>
              </div>
              <div className="met-cat-card neutro">
                <div className="met-cat-title">Neutros / Passivos</div>
                <div className="met-cat-range">Notas 7 – 8</div>
                <div className="met-cat-desc">
                  Clientes satisfeitos, porém com menor engajamento e suscetíveis à concorrência
                </div>
              </div>
              <div className="met-cat-card detrator">
                <div className="met-cat-title">Detratores</div>
                <div className="met-cat-range">Notas 0 – 6</div>
                <div className="met-cat-desc">
                  Clientes insatisfeitos ou com potencial de percepção negativa sobre a empresa
                </div>
              </div>
            </div>
          </div>

          <div className="met-section">
            <h2 className="met-h2">Cálculo do Índice NPS</h2>
            <div className="met-formula">NPS = % Promotores − % Detratores</div>
            <table className="met-table">
              <thead>
                <tr>
                  <th>Faixa de NPS</th>
                  <th>Classificação</th>
                  <th>Interpretação</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>−100 a 0</td>
                  <td style={{ color: "var(--danger)", fontWeight: 700 }}>Zona Crítica</td>
                  <td>Alta insatisfação e risco de perda de clientes</td>
                </tr>
                <tr>
                  <td>1 a 49</td>
                  <td style={{ color: "var(--seteg-yellow)", fontWeight: 700 }}>Aperfeiçoamento</td>
                  <td>Satisfação moderada e fidelização instável</td>
                </tr>
                <tr>
                  <td>50 a 74</td>
                  <td style={{ color: "#64b5f6", fontWeight: 700 }}>Qualidade</td>
                  <td>Desempenho consistente e clientes leais</td>
                </tr>
                <tr>
                  <td>75 a 100</td>
                  <td style={{ color: "var(--seteg-green)", fontWeight: 700 }}>Excelência</td>
                  <td>Altíssima lealdade e forte advocacia da marca</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="met-section">
            <h2 className="met-h2">Estrutura da Pesquisa Seteg</h2>
            <table className="met-table">
              <thead>
                <tr>
                  <th>Questão</th>
                  <th>Dimensão</th>
                  <th>Pergunta Aplicada</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Q1</strong>
                  </td>
                  <td>Desempenho</td>
                  <td>De 0 a 10, qual nota você atribui ao trabalho da Seteg?</td>
                </tr>
                <tr>
                  <td>
                    <strong>Q2</strong>
                  </td>
                  <td>Relacionamento</td>
                  <td>
                    De 0 a 10, o quanto você está satisfeito com o seu relacionamento com nossa
                    equipe?
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Q3</strong>
                  </td>
                  <td>Comunicação</td>
                  <td>De 0 a 10, o quão efetiva é a comunicação com os canais de acesso à Seteg?</td>
                </tr>
                <tr>
                  <td>
                    <strong style={{ color: "var(--seteg-orange)" }}>Q4 ★</strong>
                  </td>
                  <td>Indicação (NPS)</td>
                  <td>
                    De 0 a 10, o quanto você nos indicaria a um amigo, familiar ou parceiro de
                    negócios?
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="met-note">
              ★ Apenas Q4 é utilizada para o cálculo do índice NPS. As demais são indicadores
              complementares.
            </p>
          </div>

          <div className="met-section">
            <h2 className="met-h2">Metas Estratégicas Seteg</h2>
            <div className="met-metas">
              <div className="met-meta-card nps-meta">
                <div className="met-meta-valor">≥ {META_NPS}</div>
                <div className="met-meta-desc">NPS Corporativo Mínimo</div>
              </div>
              <div className="met-meta-card proj-meta">
                <div className="met-meta-valor">≥ {META_COBERTURA}%</div>
                <div className="met-meta-desc">Taxa Mínima de Projetos Respondidos por Ciclo</div>
              </div>
            </div>
          </div>

          <div className="met-section">
            <h2 className="met-h2">Formas de Aplicação</h2>
            <ul className="met-ul">
              <li>
                <strong>Pesquisa de Finalização de Projeto:</strong> realizada ao encerramento de
                contratos ou etapas relevantes. Distribuída por e-mail ou WhatsApp pelos líderes dos
                projetos.
              </li>
              <li>
                <strong>Pesquisa de Ciclo Semestral:</strong> realizada semestralmente em maio e
                outubro, contemplando contratos ativos com maturidade operacional suficiente. O
                envio por e-mail é conduzido pelo PMO; os contatos via WhatsApp são realizados pelos
                líderes dos projetos.
              </li>
            </ul>
            <p className="met-p" style={{ fontSize: "0.85rem" }}>
              Não são elegíveis para o ciclo semestral: projetos com menos de três meses de execução
              e projetos em fase de encerramento (avaliados na pesquisa de finalização).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
