// Estados de tela: carregando, vazio e erro.
//
// Existem como componente, e nao como string de HTML repetida em cada view,
// para que "nenhum registro" tenha sempre a mesma cara — e para que o erro
// sempre mostre o que aconteceu em vez de uma area em branco.

import { Icone } from "@/componentes/Icone";

export function EstadoCarregando({ mensagem = "Carregando..." }: { mensagem?: string }) {
  return (
    <div className="estado-carregando">
      <div className="spinner" />
      {mensagem}
    </div>
  );
}

export function EstadoVazio({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <div className="estado-vazio">
      <Icone nome="busca" tamanho={34} />
      <strong>{titulo}</strong>
      {descricao ? <span>{descricao}</span> : null}
    </div>
  );
}

export function EstadoErro({ mensagem }: { mensagem: string }) {
  return (
    <div className="estado-erro">
      <Icone nome="info" tamanho={34} />
      <strong>Nao foi possivel carregar</strong>
      <span>{mensagem}</span>
    </div>
  );
}

/** Caixa de aviso dentro de formularios e modais. */
export function Aviso({
  tipo = "info",
  children,
}: {
  tipo?: "info" | "atencao" | "perigo";
  children: React.ReactNode;
}) {
  return (
    <div className={`aviso-box ${tipo}`}>
      <Icone nome={tipo === "info" ? "info" : "alerta"} tamanho={16} />
      <div>{children}</div>
    </div>
  );
}
