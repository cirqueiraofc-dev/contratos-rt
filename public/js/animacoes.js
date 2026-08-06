/**
 * Movimento de entrada das telas.
 *
 * Nao altera nenhuma regra do sistema: instala um observador em #conteudo e,
 * toda vez que uma tela e redesenhada, anima o que acabou de entrar. Por isso
 * o app.js continua intocado — este arquivo se instala sozinho.
 *
 * Usa a Web Animations API, que ja vem no navegador. Nao ha biblioteca para
 * baixar, nada e buscado de fora e continua funcionando sem internet — o que
 * importa num sistema que guarda contrato de terceiro.
 *
 * A regra que guia o que se move: o movimento conduz o olho para o que mudou,
 * e some do caminho. Nada gira, pisca ou segue o cursor.
 */

const REDUZIR = window.matchMedia?.('(prefers-reduced-motion: reduce)');

/* desaceleracao longa no fim — a mesma curva das transicoes do CSS */
const SUAVE = 'cubic-bezier(.22, 1, .36, 1)';

/* teto de elementos animados por tela: com 300 contratos em lista, animar
   todos deixaria a entrada arrastada. Do 25o em diante entra sem animacao. */
const TETO = 24;

function podeAnimar() {
  return !REDUZIR?.matches && typeof document.body?.animate === 'function';
}

/**
 * Faz os elementos surgirem subindo, em cascata.
 * @param {Iterable<Element>} elementos
 */
function surgir(elementos, { subida = 12, duracao = 400, passo = 45, atraso = 0 } = {}) {
  let i = 0;
  for (const el of elementos) {
    if (i >= TETO) break;
    el.animate(
      [
        { opacity: 0, transform: `translateY(${subida}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: duracao, delay: atraso + i * passo, easing: SUAVE, fill: 'backwards' },
    );
    i += 1;
  }
}

/**
 * Conta de zero ate o valor final. So mexe em numero inteiro simples — se a
 * caixa mostrar outra coisa, fica como esta.
 */
function contar(elemento, duracao = 650) {
  const alvo = Number(elemento.textContent.trim());
  if (!Number.isInteger(alvo) || alvo <= 0 || alvo > 9999) return;

  const inicio = performance.now();
  const final = elemento.textContent;
  elemento.textContent = '0';

  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / duracao);
    // desaceleracao exponencial: corre no comeco e assenta no fim
    const suave = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    elemento.textContent = String(Math.round(alvo * suave));
    if (t < 1) requestAnimationFrame(passo);
    else elemento.textContent = final; // garante o valor exato no fim
  };
  requestAnimationFrame(passo);
}

/** Anima uma tela recem-desenhada. */
function animarTela(raiz) {
  // o "Carregando…" e um estado de passagem: nao vale animar
  if (raiz.children.length === 1 && raiz.firstElementChild?.classList.contains('carregando')) return;

  // 1) os blocos da tela sobem em cascata
  surgir(raiz.children, { subida: 14, duracao: 420, passo: 55 });

  // 2) os indicadores do painel entram um a um, depois dos blocos
  const indicadores = raiz.querySelectorAll('.indicadores .indicador');
  if (indicadores.length) {
    surgir(indicadores, { subida: 10, duracao: 380, passo: 45, atraso: 80 });
    for (const caixa of indicadores) {
      const numero = caixa.querySelector('b');
      if (numero) contar(numero);
    }
  }

  // 3) listas longas cascateiam dentro do proprio cartao
  for (const seletor of ['.lista .item-alerta', '.lista .contrato-linha', '.grade-rts .rt-cartao']) {
    const itens = raiz.querySelectorAll(seletor);
    if (itens.length > 1) surgir(itens, { subida: 8, duracao: 340, passo: 32, atraso: 120 });
  }

  // 4) linhas de tabela apenas aparecem, sem deslocar — deslocar linha de
  //    tabela da sensacao de que o conteudo esta escorregando
  const linhas = raiz.querySelectorAll('.tabela tbody tr');
  if (linhas.length > 1) surgir(linhas, { subida: 0, duracao: 300, passo: 26, atraso: 140 });
}

function instalar() {
  const conteudo = document.getElementById('conteudo');
  if (!conteudo || !podeAnimar()) return;

  // sem `subtree`: so dispara quando a tela inteira e trocada, e nao quando
  // um pedaco interno (o historico, por exemplo) chega depois
  new MutationObserver(() => animarTela(conteudo))
    .observe(conteudo, { childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', instalar, { once: true });
} else {
  instalar();
}
