/**
 * Marca ECOART em particulas, para a tela de entrada.
 *
 * O efeito segue o modelo do "Pixel Drift" (Originkit): o texto vira um campo
 * denso de particulas e o ponteiro abre um VAZIO circular nele — quem esta
 * dentro do raio e empurrado para a borda do circulo, quem esta fora fica no
 * lugar. Ponteiro parado, vazio parado. A chegada e feita com as particulas
 * vindo de um anel fora da tela, ganhando opacidade no caminho.
 *
 * Uma diferenca proposital em relacao ao original: la as cores sao sorteadas
 * de uma paleta; aqui cada particula guarda a cor do pixel de onde nasceu, de
 * modo que "eco" continua laranja, "art" indigo e "SOLUÇÕES" cinza. As cores
 * saem do proprio CSS (.eco, .art, .solucoes) — trocar a marca continua sendo
 * mexer nas tres variaveis do app.css.
 *
 * Enfeite, nunca conteudo: o texto real da marca continua na pagina para
 * leitor de tela. Se o canvas nao puder ser usado — navegador antigo, script
 * que nao carregou, ou quem pediu menos movimento no sistema — a marca em
 * texto simplesmente aparece no lugar. Nunca fica uma lacuna.
 */

const FORMACAO_MS = 1000;   // tempo de chegada das particulas
const FORCA = 30;           // mouseForce do Pixel Drift
const TETO_PARTICULAS = 30000;

/* Tamanho do quadradinho e densidade acompanham a letra: numa marca grande,
   manter o passo pequeno geraria dezenas de milhares de particulas. */
const passoPara = (tamanho) => Math.max(2, Math.round(tamanho / 26));
const raioPara = (tamanho) => Math.max(48, Math.round(tamanho * 0.95));
const ladoPara = (tamanho) => Math.max(1.6, tamanho / 30);

function reduzirMovimento() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function lerCor(raiz, seletor, padrao) {
  const el = raiz.querySelector(seletor);
  return el ? getComputedStyle(el).color : padrao;
}

/** Desenha a marca num canvas fora da tela e devolve o campo de particulas. */
function amostrar(marca, largura, altura, dpr) {
  const fonte = getComputedStyle(marca);
  const familia = fonte.fontFamily;
  const tamanho = parseFloat(fonte.fontSize);

  const molde = document.createElement('canvas');
  molde.width = Math.max(1, Math.floor(largura * dpr));
  molde.height = Math.max(1, Math.floor(altura * dpr));
  const ctx = molde.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // ---- linha de cima: "eco" + "art", encostados, como na logo
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${tamanho}px ${familia}`;
  const larguraEco = ctx.measureText('eco').width;
  const larguraArt = ctx.measureText('art').width;
  const x0 = (largura - (larguraEco + larguraArt)) / 2;
  const yTopo = altura * 0.52;

  ctx.fillStyle = lerCor(marca, '.eco', '#e5762d');
  ctx.fillText('eco', x0, yTopo);
  ctx.fillStyle = lerCor(marca, '.art', '#40316a');
  ctx.fillText('art', x0 + larguraEco, yTopo);

  // ---- linha de baixo: "SOLUÇÕES", espacado como no CSS
  const tamanhoSol = Math.max(8, tamanho * 0.26);
  const espaco = tamanhoSol * 0.44;
  ctx.font = `600 ${tamanhoSol}px ${familia}`;
  ctx.fillStyle = lerCor(marca, '.solucoes', '#a6a6a6');
  const palavra = 'SOLUÇÕES';
  let larguraSol = -espaco;
  for (const ch of palavra) larguraSol += ctx.measureText(ch).width + espaco;
  let x = (largura - larguraSol) / 2;
  const ySol = yTopo + tamanhoSol * 1.75;
  for (const ch of palavra) {
    ctx.fillText(ch, x, ySol);
    x += ctx.measureText(ch).width + espaco;
  }

  // ---- transforma os pixels acesos em particulas
  const passo = passoPara(tamanho);
  const img = ctx.getImageData(0, 0, molde.width, molde.height);
  const dados = img.data;

  const posicoes = [];
  for (let py = 0; py < altura; py += passo) {
    for (let px = 0; px < largura; px += passo) {
      const ix = Math.floor(px * dpr);
      const iy = Math.floor(py * dpr);
      const i = (iy * img.width + ix) * 4;
      if (dados[i + 3] > 128) posicoes.push([px, py, i]);
    }
  }
  if (!posicoes.length) return null;

  // teto de particulas, como no original: passa a pegar de N em N
  const reducao = posicoes.length > TETO_PARTICULAS
    ? Math.ceil(posicoes.length / TETO_PARTICULAS) : 1;
  const total = Math.ceil(posicoes.length / reducao);

  const ox = new Float32Array(total);
  const oy = new Float32Array(total);
  const sx = new Float32Array(total);
  const sy = new Float32Array(total);
  const repX = new Float32Array(total);
  const repY = new Float32Array(total);
  const cor = new Array(total);

  const diagonal = Math.max(largura, altura);
  for (let k = 0, n = 0; k < posicoes.length; k += reducao, n += 1) {
    const [px, py, i] = posicoes[k];
    ox[n] = px;
    oy[n] = py;
    // nasce num anel FORA da area, para entrar vindo de fora
    const ang = Math.random() * Math.PI * 2;
    const raio = diagonal * (0.6 + Math.random() * 0.5);
    sx[n] = largura / 2 + Math.cos(ang) * raio;
    sy[n] = altura / 2 + Math.sin(ang) * raio;
    cor[n] = `rgb(${dados[i]},${dados[i + 1]},${dados[i + 2]})`;
  }

  // agrupa por cor para trocar fillStyle poucas vezes por quadro
  const grupos = new Map();
  for (let i = 0; i < total; i += 1) {
    let g = grupos.get(cor[i]);
    if (!g) { g = []; grupos.set(cor[i], g); }
    g.push(i);
  }

  return {
    total, ox, oy, sx, sy, repX, repY,
    grupos: [...grupos.entries()],
    lado: ladoPara(tamanho),
    raioMouse: raioPara(tamanho),
  };
}

function animar(canvas, marca) {
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const largura = Math.floor(canvas.clientWidth);
  const altura = Math.floor(canvas.clientHeight);
  if (largura <= 0 || altura <= 0) return null;

  canvas.width = Math.floor(largura * dpr);
  canvas.height = Math.floor(altura * dpr);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const campo = amostrar(marca, largura, altura, dpr);
  if (!campo) return null;

  const { total, ox, oy, sx, sy, repX, repY, grupos, lado, raioMouse } = campo;
  const meio = lado / 2;
  const px = new Float32Array(total);
  const py = new Float32Array(total);

  const parado = reduzirMovimento();

  const desenhar = (alfa) => {
    ctx.clearRect(0, 0, largura, altura);
    ctx.globalAlpha = alfa;
    for (const [tinta, indices] of grupos) {
      ctx.fillStyle = tinta;
      for (let k = 0; k < indices.length; k += 1) {
        const i = indices[k];
        ctx.fillRect(px[i] - meio, py[i] - meio, lado, lado);
      }
    }
    ctx.globalAlpha = 1;
  };

  if (parado) {
    px.set(ox); py.set(oy);
    desenhar(1);
    return { parar() {} };
  }

  /* ---- ponteiro: posicao suavizada e velocidade, como no Pixel Drift ---- */
  const ponteiro = { x: -99999, y: -99999, ativo: false };
  let antesX = -99999;
  let antesY = -99999;
  let velocidade = 0;
  let suaveX = -99999;
  let suaveY = -99999;

  const aoMover = (ev) => {
    const r = canvas.getBoundingClientRect();
    const ex = r.width > 0 ? largura / r.width : 1;
    const ey = r.height > 0 ? altura / r.height : 1;
    const mx = (ev.clientX - r.left) * ex;
    const my = (ev.clientY - r.top) * ey;
    if (antesX > -9000) {
      const dx = mx - antesX;
      const dy = my - antesY;
      velocidade = Math.sqrt(dx * dx + dy * dy);
    }
    antesX = mx; antesY = my;
    ponteiro.x = mx; ponteiro.y = my; ponteiro.ativo = true;
  };
  const aoSair = () => {
    ponteiro.x = ponteiro.y = -99999;
    ponteiro.ativo = false;
    antesX = antesY = -99999;
  };
  canvas.addEventListener('pointermove', aoMover);
  canvas.addEventListener('pointerleave', aoSair);
  canvas.addEventListener('pointercancel', aoSair);

  let vivo = true;
  let formacao = 0;          // 0 = espalhada, 1 = marca formada
  let ultimo = null;

  const quadro = (agora) => {
    if (!vivo) return;

    // Em aba de segundo plano o navegador desacelera muito os quadros. Se a
    // formacao avancasse assim, quem voltasse para a aba encontraria a marca
    // pela metade. Enquanto a pagina nao esta a vista, a chegada fica parada —
    // ela comeca quando alguem realmente olha.
    if (document.hidden && formacao < 1) {
      ultimo = agora;
      requestAnimationFrame(quadro);
      return;
    }

    // avanca a formacao por taxa (nao por linha do tempo), e limita o salto
    // para um quadro atrasado nao pular a animacao inteira
    const anterior = ultimo ?? agora;
    const dt = Math.min(64, Math.max(0, agora - anterior));
    ultimo = agora;
    formacao = Math.min(1, formacao + dt / FORMACAO_MS);
    const formando = formacao < 1;
    const avanco = 1 - Math.pow(1 - formacao, 3); // desaceleracao no fim

    const golpe = velocidade;
    velocidade *= 0.88;

    const ativo = !formando && ponteiro.ativo;
    if (ativo) {
      const passoSuave = Math.max(0.08, 0.3 - golpe * 0.006);
      if (suaveX < -9000) { suaveX = ponteiro.x; suaveY = ponteiro.y; }
      else {
        suaveX += (ponteiro.x - suaveX) * passoSuave;
        suaveY += (ponteiro.y - suaveY) * passoSuave;
      }
    } else {
      suaveX = suaveY = -99999;
    }

    const raio2 = raioMouse * raioMouse;

    for (let i = 0; i < total; i += 1) {
      if (formando) {
        // chegada: interpola do anel externo ate o lugar de destino
        px[i] = sx[i] + (ox[i] - sx[i]) * avanco;
        py[i] = sy[i] + (oy[i] - sy[i]) * avanco;
        continue;
      }

      // assentada: o ponteiro abre um vazio empurrando quem esta dentro do
      // raio ate a borda do circulo; quem esta fora volta devagar ao lugar
      let dentro = false;
      if (ativo) {
        const dx = ox[i] - suaveX;
        const dy = oy[i] - suaveY;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < raio2) {
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const queda = 1 - d / raioMouse;
          const impulso = queda * golpe * FORCA * 0.05;
          repX[i] += nx * impulso;
          repY[i] += ny * impulso;
          repX[i] += (nx * (raioMouse - d) - repX[i]) * 0.06;
          repY[i] += (ny * (raioMouse - d) - repY[i]) * 0.06;
          dentro = true;
        }
      }
      if (!dentro) { repX[i] *= 0.97; repY[i] *= 0.97; }

      px[i] = ox[i] + repX[i];
      py[i] = oy[i] + repY[i];
    }

    desenhar(formando ? avanco : 1);
    requestAnimationFrame(quadro);
  };
  requestAnimationFrame(quadro);

  return {
    parar() {
      vivo = false;
      canvas.removeEventListener('pointermove', aoMover);
      canvas.removeEventListener('pointerleave', aoSair);
      canvas.removeEventListener('pointercancel', aoSair);
    },
  };
}

function instalar() {
  const alvo = document.querySelector('[data-marca-particulas]');
  if (!alvo) return;
  const marca = alvo.querySelector('.marca-logo');
  if (!marca || !document.createElement('canvas').getContext) return;

  let canvas = alvo.querySelector('canvas.marca-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'marca-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    alvo.appendChild(canvas);
  }

  let atual = null;
  let medida = 0;

  const montar = () => {
    atual?.parar();
    atual = animar(canvas, marca);
    if (atual) {
      alvo.classList.add('com-particulas');
      medida = canvas.clientWidth;
    } else {
      alvo.classList.remove('com-particulas');
    }
  };

  // as fontes precisam ter carregado, senao o molde sai com a fonte errada
  if (document.fonts?.ready) document.fonts.ready.then(montar, montar);
  else montar();

  // remonta quando a largura muda de verdade (girar o celular, redimensionar)
  let espera;
  window.addEventListener('resize', () => {
    if (canvas.clientWidth === medida) return;
    clearTimeout(espera);
    espera = setTimeout(montar, 180);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', instalar, { once: true });
} else {
  instalar();
}
