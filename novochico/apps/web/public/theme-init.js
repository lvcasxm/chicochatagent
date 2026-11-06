/*
 * Define o tema antes da primeira pintura. Sem escolha salva, segue o sistema.
 * A mesma regra está em src/app/theme/theme.ts; mantenha as duas iguais.
 */
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem('chico-theme');
  } catch (_) {
    /* armazenamento bloqueado: segue o sistema */
  }
  var theme =
    saved === 'light' || saved === 'dark'
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
