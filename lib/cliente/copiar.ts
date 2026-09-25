"use client";

/**
 * Copia texto para a area de transferencia.
 *
 * O caminho moderno (`navigator.clipboard`) exige contexto seguro: em
 * http://localhost funciona, mas num preview servido por http simples, nao.
 * O fallback com textarea + execCommand e depreciado, porem e o que ainda
 * funciona nesses casos — e "copiar link" e justamente a acao que nao pode
 * falhar em silencio, porque a pessoa acha que copiou e cola outra coisa.
 */
export async function copiarTexto(texto: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return;
    } catch {
      // Permissao negada ou contexto inseguro: cai no fallback abaixo.
    }
  }

  const campo = document.createElement("textarea");
  campo.value = texto;
  campo.style.position = "fixed";
  campo.style.opacity = "0";
  document.body.appendChild(campo);
  campo.select();
  try {
    document.execCommand("copy");
  } finally {
    campo.remove();
  }
}
