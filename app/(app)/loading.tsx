// Tela de carregamento das abas internas.
//
// Sem este arquivo, clicar numa aba nao mudava nada ate o servidor responder
// por inteiro (sessao + pagina) — com o banco a ~300ms daqui, parecia que o
// clique nao tinha pegado. Com ele, o Next troca para este esqueleto NA HORA
// (e, em producao, ja o pre-carrega a partir dos links do menu), e a tela de
// verdade entra no lugar quando fica pronta. O menu lateral nao pisca: ele
// esta no layout, fora deste limite.

export default function Carregando() {
  return (
    <div className="esqueleto" aria-busy="true" aria-label="Carregando">
      <div className="esqueleto-titulo" />
      <div className="esqueleto-subtitulo" />
      <div className="esqueleto-filtros">
        <span />
        <span />
        <span />
      </div>
      <div className="esqueleto-tabela">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="esqueleto-linha" />
        ))}
      </div>
    </div>
  );
}
