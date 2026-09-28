"use client";

// Botao "Excluir" das tabelas (so a direcao/PMO ve) e a confirmacao dele.
//
// Uma tela usa assim:
//   const exclusao = useExclusao(() => lista.recarregar());
//   ...na coluna Acoes: {ehPmo ? exclusao.botao("resposta", l.id, "a resposta de Fulano") : null}
//   ...no fim do JSX:    {exclusao.modal}
//
// A regra do que pode sair (e do que sai junto) e do banco — nps_excluir,
// migration 22. Quando ele recusa (registro com respostas, por exemplo), a
// mensagem dele aparece no toast como veio.

import { useState } from "react";
import { Confirmacao } from "@/componentes/Modal";
import { BotaoAcao } from "@/componentes/Tabela";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi } from "@/lib/cliente/api";

export type EntidadeExcluivel =
  | "resposta"
  | "pesquisa"
  | "plano"
  | "isc"
  | "respondente"
  | "projeto"
  | "ciclo"
  | "lider"
  | "cliente"
  | "conta";

/** O que a confirmacao avisa que sai junto. */
const LEVA_JUNTO: Record<EntidadeExcluivel, string> = {
  resposta: "A pesquisa respondida por ela volta a ficar aberta, e o link passa a valer de novo.",
  pesquisa: "O link deixa de funcionar. Se ela já tiver resposta, a resposta continua registrada.",
  plano: "Todas as ações do plano saem junto.",
  isc: "A nota sai do histórico mensal do projeto.",
  respondente:
    "Saem junto os vínculos com projetos e as pesquisas ainda não respondidas. Não é possível excluir quem já respondeu.",
  projeto:
    "Saem junto as participações em ciclos, os respondentes vinculados e as pesquisas não respondidas. Não é possível excluir projeto com respostas, plano de ação ou ISC. Se o projeto ainda existir no Clockrview, a sincronização o traz de volta.",
  ciclo:
    "Saem junto os projetos participantes e as pesquisas não respondidas do ciclo. Não é possível excluir ciclo com respostas ou plano de ação.",
  lider:
    "Saem junto o histórico de liderança e a conta de acesso de líder. Não é possível excluir quem lidera projeto, tem ISC ou é responsável por plano de ação.",
  cliente: "Não é possível excluir cliente com projetos ou respondentes.",
  conta: "A pessoa perde o acesso ao sistema na hora. O cadastro de líder, se houver, continua.",
};

interface Pedido {
  entidade: EntidadeExcluivel;
  id: string;
  descricao: string;
}

/** `aoExcluir` recebe o id que saiu (quem recarrega a lista pode ignorar). */
export function useExclusao(aoExcluir: (id: string) => void) {
  const toast = useToast();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    if (!pedido) return;
    setOcupado(true);
    try {
      await api.post("excluir", { entidade: pedido.entidade, id: pedido.id });
      toast("Excluído com sucesso.", "sucesso");
      setPedido(null);
      aoExcluir(pedido.id);
    } catch (e) {
      // Recusa do banco (409) fecha a confirmacao: nao ha o que tentar de novo.
      if (e instanceof ErroApi && e.status === 409) setPedido(null);
      toast(e instanceof ErroApi ? e.message : "Não foi possível excluir.", "erro", 8000);
    } finally {
      setOcupado(false);
    }
  }

  const botao = (entidade: EntidadeExcluivel, id: string, descricao: string, desabilitado = false) => (
    <BotaoAcao
      icone="excluir"
      titulo={desabilitado ? "Não é possível excluir este registro" : `Excluir ${descricao}`}
      perigo
      desabilitado={desabilitado}
      onClick={() => setPedido({ entidade, id, descricao })}
    />
  );

  const modal = pedido ? (
    <Confirmacao
      titulo="Excluir registro"
      mensagem={`Excluir ${pedido.descricao}? Esta ação não pode ser desfeita.`}
      detalhe={`${LEVA_JUNTO[pedido.entidade]} A exclusão fica registrada na auditoria.`}
      rotuloConfirmar="Excluir"
      ocupado={ocupado}
      aoConfirmar={confirmar}
      aoCancelar={() => (ocupado ? undefined : setPedido(null))}
    />
  ) : null;

  return { botao, modal };
}
