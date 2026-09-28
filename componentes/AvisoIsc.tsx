"use client";

// Lembrete do ISC para o lider: no penultimo dia do mes, ao entrar no
// sistema, aparece um aviso com os projetos ativos dele ainda sem avaliacao
// na competencia. Some quando tudo ja foi avaliado, e aparece no maximo uma
// vez por dia em cada navegador (fechar nao faz ele voltar a cada tela).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/componentes/Modal";
import { api } from "@/lib/cliente/api";
import type { Sessao } from "@/lib/cliente/tipos";

interface Pendentes {
  pendentes: { projeto: { id: string; nome: string; codigo_clockify: string; cliente_nome: string | null } }[];
}

/** Data local (nao UTC): o "dia" e o do relogio de quem usa. */
function hojeLocal() {
  const d = new Date();
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return {
    penultimo: d.getDate() === ultimoDia - 1,
    competencia: `${d.getFullYear()}-${mes}`,
    dia: `${d.getFullYear()}-${mes}-${String(d.getDate()).padStart(2, "0")}`,
  };
}

const CHAVE = "nps_aviso_isc";

export function AvisoIsc({ sessao }: { sessao: Sessao }) {
  const router = useRouter();
  const [projetos, setProjetos] = useState<Pendentes["pendentes"] | null>(null);

  useEffect(() => {
    if (sessao.perfil !== "lider") return;
    const { penultimo, competencia, dia } = hojeLocal();
    if (!penultimo) return;
    try {
      if (localStorage.getItem(CHAVE) === dia) return;
    } catch {
      // Sem localStorage (janela privada etc.): mostra mesmo assim.
    }
    api
      .get<Pendentes>("isc/pendentes", { competencia })
      .then((r) => {
        if (r.pendentes?.length) setProjetos(r.pendentes);
      })
      .catch(() => {
        // Lembrete e conveniencia: se falhar, nao atrapalha a entrada.
      });
  }, [sessao.perfil]);

  if (!projetos) return null;

  const dispensar = () => {
    try {
      localStorage.setItem(CHAVE, hojeLocal().dia);
    } catch {
      // ignora
    }
    setProjetos(null);
  };

  return (
    <Modal
      titulo="Hora de avaliar o ISC"
      subtitulo="Penúltimo dia do mês: registre a sua percepção dos projetos ativos."
      aoFechar={dispensar}
      acoes={[
        { rotulo: "Depois", classe: "btn-secondary", onClick: dispensar },
        {
          rotulo: "Avaliar agora",
          classe: "btn-primary",
          onClick: () => {
            dispensar();
            router.push("/isc");
          },
        },
      ]}
    >
      <p style={{ fontSize: ".88rem", marginBottom: 10 }}>
        {projetos.length === 1
          ? "1 projeto seu ainda está sem avaliação ISC neste mês:"
          : `${projetos.length} projetos seus ainda estão sem avaliação ISC neste mês:`}
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: ".85rem", lineHeight: 1.6 }}>
        {projetos.map(({ projeto }) => (
          <li key={projeto.id}>
            <strong>{projeto.codigo_clockify}</strong> — {projeto.nome}
            {projeto.cliente_nome ? <span className="td-sub"> · {projeto.cliente_nome}</span> : null}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
