"use client";

// Incidencia comparativa: projeto a projeto, quem era elegivel e quem
// respondeu em cada um dos dois ciclos.
//
// Ignora o filtro de CICLO de proposito — comparar dois ciclos exige os dois.
// Todos os demais filtros valem.

import { normalizar, type Projeto, type Resposta } from "@/lib/dashboard";
import type { Filtros } from "./filtros";

// Antes eram constantes ("2025.2" / "2026.1"). Passaram a vir por prop pelo
// mesmo motivo do Comparativo: código de ciclo é dado de cadastro, e cadastro
// mora no banco.

interface Linha {
  cliente: string;
  projeto: string;
  ck: string;
  lider: string;
  eleg252: boolean;
  eleg261: boolean;
  res252: boolean;
  res261: boolean;
  analise: string;
  classe: string;
}

function analisar(
  eleg252: boolean,
  eleg261: boolean,
  res252: boolean,
  res261: boolean,
  anterior: string,
  atual: string
) {
  if (eleg252 && eleg261) {
    if (res252 && res261) return { analise: "Respondeu nos dois ciclos", classe: "ic-ambos" };
    if (res252) return { analise: `Respondeu apenas em ${anterior}`, classe: "ic-somente-ant" };
    if (res261) return { analise: `Respondeu apenas em ${atual}`, classe: "ic-somente-at" };
    return { analise: "Nunca respondeu", classe: "ic-nunca" };
  }
  if (eleg261) return { analise: `Novo projeto em ${atual}`, classe: "ic-novo" };
  return { analise: `Projeto encerrado após ${anterior}`, classe: "ic-encerrado" };
}

function Badge({ sim }: { sim: boolean }) {
  return <span className={`ic-badge ${sim ? "ic-sim" : "ic-nao"}`}>{sim ? "Sim" : "Não"}</span>;
}

export function IncidenciaComparativa({
  respostas,
  projetos,
  filtros,
  anterior: ANTERIOR,
  atual: ATUAL,
}: {
  respostas: Resposta[];
  projetos: Projeto[];
  filtros: Filtros;
  /** Ciclo mais antigo da comparação. */
  anterior: string;
  /** Ciclo mais recente da comparação. */
  atual: string;
}) {
  // Com o ciclo mais antigo selecionado nao existe "ciclo anterior" com o que
  // comparar.
  if (filtros.ciclo === ANTERIOR) {
    return (
      <p className="empty-state" style={{ padding: "1.5rem" }}>
        Sem ciclo anterior disponível para comparação.
      </p>
    );
  }

  const casaProjeto = (p: Projeto) => {
    if (filtros.lider && normalizar(p.lider_atual) !== normalizar(filtros.lider)) return false;
    if (filtros.cliente && normalizar(p.cliente) !== normalizar(filtros.cliente)) return false;
    if (filtros.projeto && normalizar(p.projeto) !== normalizar(filtros.projeto)) return false;
    if (filtros.classe && p.classe_contratual !== filtros.classe) return false;
    if (filtros.tipoServico && p.tipo_servico !== filtros.tipoServico) return false;
    if (filtros.segmento && p.segmento_cliente !== filtros.segmento) return false;
    return true;
  };

  const casaResposta = (d: Resposta) => {
    if (filtros.lider && normalizar(d.lider_atual) !== normalizar(filtros.lider)) return false;
    if (filtros.cliente && normalizar(d.cliente) !== normalizar(filtros.cliente)) return false;
    if (filtros.projeto && normalizar(d.projeto) !== normalizar(filtros.projeto)) return false;
    if (filtros.classe && d.classe_contratual !== filtros.classe) return false;
    if (filtros.tipoServico && d.tipo_servico !== filtros.tipoServico) return false;
    if (filtros.segmento && d.segmento_cliente !== filtros.segmento) return false;
    return true;
  };

  const proj252 = new Map<string, Projeto>();
  const proj261 = new Map<string, Projeto>();
  for (const p of projetos) {
    if (!casaProjeto(p)) continue;
    const ck = normalizar(p.codigo_clockify);
    if (!ck) continue;
    if (p.ciclo === ANTERIOR && !proj252.has(ck)) proj252.set(ck, p);
    else if (p.ciclo === ATUAL && !proj261.has(ck)) proj261.set(ck, p);
  }

  const res252 = new Set<string>();
  const res261 = new Set<string>();
  for (const d of respostas) {
    if (!d.respostaValida || !d.codigo_clockify) continue;
    if (!casaResposta(d)) continue;
    const ck = normalizar(d.codigo_clockify);
    if (d.ciclo === ANTERIOR) res252.add(ck);
    else if (d.ciclo === ATUAL) res261.add(ck);
  }

  const todosCk = new Set([...proj252.keys(), ...proj261.keys()]);
  if (!todosCk.size) {
    return (
      <p className="empty-state" style={{ padding: "1.5rem" }}>
        Sem dados de projetos para comparação entre ciclos.
      </p>
    );
  }

  const linhas: Linha[] = [];
  todosCk.forEach((ck) => {
    const p252 = proj252.get(ck);
    const p261 = proj261.get(ck);
    const ref = (p261 || p252)!;
    const eleg252 = Boolean(p252);
    const eleg261 = Boolean(p261);
    const r252 = res252.has(ck);
    const r261 = res261.has(ck);
    const { analise, classe } = analisar(eleg252, eleg261, r252, r261, ANTERIOR, ATUAL);
    linhas.push({
      cliente: ref.cliente || "-",
      projeto: ref.projeto || "-",
      ck,
      lider: ref.lider_atual || ref.lider || "-",
      eleg252,
      eleg261,
      res252: r252,
      res261: r261,
      analise,
      classe,
    });
  });

  linhas.sort((a, b) => `${a.cliente}${a.projeto}`.localeCompare(`${b.cliente}${b.projeto}`));

  return (
    <div className="table-wrapper">
      <table className="incidencia-comp-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Projeto</th>
            <th>Cód. Clockify</th>
            <th>Líder</th>
            <th>Elegível {ANTERIOR}</th>
            <th>Elegível {ATUAL}</th>
            <th>Respondeu {ANTERIOR}</th>
            <th>Respondeu {ATUAL}</th>
            <th>Análise da Resposta</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((r) => (
            <tr key={r.ck}>
              <td>{r.cliente}</td>
              <td>{r.projeto}</td>
              <td className="ic-clockify">{r.ck}</td>
              <td>{r.lider}</td>
              <td>
                <Badge sim={r.eleg252} />
              </td>
              <td>
                <Badge sim={r.eleg261} />
              </td>
              <td>
                <Badge sim={r.res252} />
              </td>
              <td>
                <Badge sim={r.res261} />
              </td>
              <td>
                <span className={`ic-analise ${r.classe}`}>{r.analise}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
