export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

export function escapar(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function formatarData(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
}

export function formatarDataHora(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatarMoeda(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
}

export function aviso(mensagem, tipo = 'info') {
  const caixa = $('#avisos');
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.textContent = mensagem;
  caixa.append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, tipo === 'erro' ? 7000 : 4000);
}

/* ---------------------------------------------------------------- modal */

export function abrirModal({ titulo, corpo, rodape = '', aoMontar, largura }) {
  const fundo = $('#modal-fundo');
  const modal = $('#modal');
  if (largura) modal.style.width = `min(${largura}px, 100%)`;
  modal.innerHTML = `
    <div class="modal-cabecalho">
      <h2>${escapar(titulo)}</h2>
      <button class="fechar" type="button" data-fechar aria-label="Fechar">&times;</button>
    </div>
    <div class="modal-corpo">${corpo}</div>
    ${rodape ? `<div class="modal-rodape">${rodape}</div>` : ''}
  `;
  fundo.hidden = false;
  document.body.style.overflow = 'hidden';
  modal.querySelector('[data-fechar]').addEventListener('click', fecharModal);
  aoMontar?.(modal);
  const primeiro = modal.querySelector('input:not([type=hidden]), textarea, select, button');
  primeiro?.focus();
  return modal;
}

export function fecharModal() {
  const fundo = $('#modal-fundo');
  fundo.hidden = true;
  $('#modal').innerHTML = '';
  $('#modal').style.width = '';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-fundo').hidden) fecharModal();
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-fundo') fecharModal();
});

/* -------------------------------------------------------------- formulario */

/** Monta um <div class="campo"> a partir de uma especificacao simples. */
export function campo({ nome, rotulo, tipo = 'text', valor = '', dica = '', opcoes, largo = false, atributos = '' }) {
  const v = valor ?? '';
  let controle;
  if (tipo === 'textarea') {
    controle = `<textarea name="${nome}" ${atributos}>${escapar(v)}</textarea>`;
  } else if (tipo === 'select') {
    const itens = opcoes.map((o) => {
      const val = typeof o === 'string' ? o : o.valor;
      const txt = typeof o === 'string' ? o : o.texto;
      return `<option value="${escapar(val)}"${String(val) === String(v) ? ' selected' : ''}>${escapar(txt)}</option>`;
    }).join('');
    controle = `<select name="${nome}" ${atributos}>${itens}</select>`;
  } else {
    controle = `<input type="${tipo}" name="${nome}" value="${escapar(v)}" ${atributos} />`;
  }
  return `
    <div class="campo${largo ? ' largura-total' : ''}">
      <label for="${nome}">${escapar(rotulo)}</label>
      ${controle}
      ${dica ? `<span class="dica">${escapar(dica)}</span>` : ''}
    </div>`;
}

/** Le todos os campos nomeados de um container e devolve um objeto simples. */
export function lerCampos(raiz) {
  const dados = {};
  for (const el of $$('input[name], select[name], textarea[name]', raiz)) {
    if (el.type === 'checkbox') {
      if (el.dataset.lista) {
        dados[el.name] ??= [];
        if (el.checked) dados[el.name].push(el.value);
      } else {
        dados[el.name] = el.checked;
      }
    } else {
      dados[el.name] = el.value.trim();
    }
  }
  return dados;
}

export function ocupado(botao, ocupadoAgora, textoOcupado = 'Aguarde…') {
  if (ocupadoAgora) {
    botao.dataset.texto = botao.textContent;
    botao.textContent = textoOcupado;
    botao.disabled = true;
  } else {
    botao.textContent = botao.dataset.texto ?? botao.textContent;
    botao.disabled = false;
  }
}
