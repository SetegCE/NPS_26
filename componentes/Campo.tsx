"use client";

// Campos de formulario.
//
// Controlados pelo React, e nao lidos do DOM no submit como fazia
// `lerFormulario(raiz)` em app/ui.js. A diferenca pratica: dava para submeter
// um formulario com valor que a tela nunca validou, porque a leitura
// acontecia direto do input.

export interface OpcaoSelect {
  valor: string;
  rotulo: string;
}

interface Base {
  nome: string;
  rotulo: string;
  obrigatorio?: boolean;
  ajuda?: string;
  larguraTotal?: boolean;
  desabilitado?: boolean;
}

function Envolucro({
  nome,
  rotulo,
  obrigatorio,
  ajuda,
  larguraTotal,
  children,
}: Base & { children: React.ReactNode }) {
  return (
    <div className={`form-campo ${larguraTotal ? "largura-total" : ""}`}>
      <label htmlFor={`campo-${nome}`}>
        {rotulo}
        {obrigatorio ? <span className="obrigatorio">*</span> : null}
      </label>
      {children}
      {ajuda ? <span className="ajuda">{ajuda}</span> : null}
    </div>
  );
}

export function CampoTexto({
  tipo = "text",
  valor,
  aoMudar,
  placeholder,
  maxLength,
  ...base
}: Base & {
  tipo?: string;
  valor: string;
  aoMudar: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <Envolucro {...base}>
      <input
        id={`campo-${base.nome}`}
        name={base.nome}
        type={tipo}
        value={valor}
        placeholder={placeholder}
        maxLength={maxLength}
        required={base.obrigatorio}
        disabled={base.desabilitado}
        onChange={(e) => aoMudar(e.target.value)}
      />
    </Envolucro>
  );
}

export function CampoArea({
  valor,
  aoMudar,
  linhas = 3,
  maxLength,
  ...base
}: Base & { valor: string; aoMudar: (v: string) => void; linhas?: number; maxLength?: number }) {
  return (
    <Envolucro {...base}>
      <textarea
        id={`campo-${base.nome}`}
        name={base.nome}
        value={valor}
        rows={linhas}
        maxLength={maxLength}
        required={base.obrigatorio}
        disabled={base.desabilitado}
        onChange={(e) => aoMudar(e.target.value)}
      />
    </Envolucro>
  );
}

export function CampoSelect({
  valor,
  aoMudar,
  opcoes,
  vazio = "Selecione...",
  ...base
}: Base & {
  valor: string;
  aoMudar: (v: string) => void;
  opcoes: OpcaoSelect[];
  /** `null` remove a opcao em branco — use quando o campo nao pode ficar vazio. */
  vazio?: string | null;
}) {
  return (
    <Envolucro {...base}>
      <select
        id={`campo-${base.nome}`}
        name={base.nome}
        value={valor}
        required={base.obrigatorio}
        disabled={base.desabilitado}
        onChange={(e) => aoMudar(e.target.value)}
      >
        {vazio !== null ? <option value="">{vazio}</option> : null}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </Envolucro>
  );
}

/** Monta opcoes a partir de uma lista {id, nome}. */
export function opcoesDe(lista: { id: string; nome: string }[]): OpcaoSelect[] {
  return lista.map((i) => ({ valor: i.id, rotulo: i.nome }));
}
