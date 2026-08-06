import { api } from './api.js';
import { telaConfiguracoes, telaContrato, telaContratos, telaPainel } from './telas.js';
import {
  fluxoConcluir, fluxoEditarContrato, fluxoEditarRt, fluxoImportarArt, fluxoNovoContrato,
  fluxoRegistrarAditivo,
} from './modais.js';
import { $, $$, aviso, escapar, formatarDataHora, lerCampos } from './util.js';

const conteudo = $('#conteudo');
let disciplinas = [];
let contratoAtual = null;

/* ---------------------------------------------------------------- rotas */

function rotaAtual() {
  const bruto = location.hash.replace(/^#\/?/, '') || 'painel';
  const [caminho, consulta] = bruto.split('?');
  const partes = caminho.split('/').filter(Boolean);
  return { partes, params: new URLSearchParams(consulta ?? '') };
}

export function irPara(destino) {
  if (location.hash === destino) navegar();
  else location.hash = destino;
}

function marcarMenu(nome) {
  for (const item of $$('[data-nav]')) item.classList.toggle('ativo', item.dataset.nav === nome);
}

async function navegar() {
  const { partes, params } = rotaAtual();
  conteudo.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    if (partes[0] === 'contrato' && partes[1]) {
      marcarMenu('contratos');
      await mostrarContrato(Number(partes[1]));
    } else if (partes[0] === 'contratos') {
      marcarMenu('contratos');
      await mostrarContratos({ status: params.get('status') ?? '', q: params.get('q') ?? '' });
    } else if (partes[0] === 'configuracoes') {
      marcarMenu('configuracoes');
      await mostrarConfiguracoes();
    } else {
      marcarMenu('painel');
      await mostrarPainel();
    }
  } catch (erro) {
    conteudo.innerHTML = `<div class="cartao"><h2>Não foi possível carregar</h2><p>${escapar(erro.message)}</p></div>`;
  }
  atualizarBadge().catch(() => {});
  window.scrollTo({ top: 0 });
}

/* --------------------------------------------------------------- telas */

async function mostrarPainel() {
  const dados = await api.painel();
  conteudo.innerHTML = telaPainel(dados);

  for (const el of $$('[data-ir]', conteudo)) {
    el.addEventListener('click', () => irPara(el.dataset.ir));
  }
  for (const el of $$('[data-contrato]', conteudo)) {
    el.addEventListener('click', () => irPara(`#/contrato/${el.dataset.contrato}`));
  }
  $('[data-acao="novo-contrato"]', conteudo)?.addEventListener('click', abrirNovoContrato);
}

let temporizadorBusca;

async function mostrarContratos(filtros) {
  const lista = await api.contratos(filtros);
  conteudo.innerHTML = telaContratos(lista, filtros);

  for (const el of $$('[data-contrato]', conteudo)) {
    el.addEventListener('click', () => irPara(`#/contrato/${el.dataset.contrato}`));
  }
  $('[data-acao="novo-contrato"]', conteudo)?.addEventListener('click', abrirNovoContrato);

  const aplicar = () => {
    const q = $('#filtro-busca').value.trim();
    const status = $('#filtro-status').value;
    const consulta = new URLSearchParams(Object.entries({ status, q }).filter(([, v]) => v)).toString();
    irPara(`#/contratos${consulta ? `?${consulta}` : ''}`);
  };
  $('#filtro-status').addEventListener('change', aplicar);
  $('#filtro-busca').addEventListener('input', () => {
    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(aplicar, 400);
  });
}

async function mostrarContrato(id) {
  contratoAtual = await api.contrato(id);
  desenharContrato();
  carregarHistorico(id);
}

function desenharContrato() {
  const contrato = contratoAtual;
  conteudo.innerHTML = telaContrato(contrato, disciplinas);

  const recarregar = (atualizado) => {
    contratoAtual = atualizado;
    desenharContrato();
    carregarHistorico(contrato.id);
    atualizarBadge().catch(() => {});
  };

  const acoes = {
    'editar-contrato': () => fluxoEditarContrato(contrato, recarregar),
    concluir: () => fluxoConcluir(contrato, recarregar),
    reabrir: async () => {
      const atualizado = await api.mudarStatus(contrato.id, { status: 'ativo' });
      recarregar(atualizado);
      aviso('Contrato reaberto.', 'sucesso');
    },
    'gerar-cat': async (botao) => {
      botao.disabled = true;
      botao.textContent = 'Gerando…';
      try {
        recarregar(await api.gerarCat(contrato.id));
        aviso('Atestado e requerimento(s) de CAT gerados.', 'sucesso');
      } finally {
        botao.disabled = false;
      }
    },
    'remover-contrato': async () => {
      if (!confirm(`Excluir o contrato ${contrato.numero} e todos os arquivos ligados a ele?`)) return;
      await api.removerContrato(contrato.id);
      aviso('Contrato excluído.', 'sucesso');
      irPara('#/contratos');
    },
    'novo-aditivo': () => fluxoRegistrarAditivo(contrato, recarregar),
    'remover-aditivo': async (botao) => {
      const aditivo = contrato.aditivos.find((a) => a.id === Number(botao.dataset.aditivo));
      if (!confirm(`Remover o ${aditivo.numero}? A vigência e o valor do contrato voltam ao que eram antes dele.`)) return;
      recarregar(await api.removerAditivo(aditivo.id));
      aviso('Termo aditivo removido e contrato recalculado.', 'sucesso');
    },
    'subir-art': (botao) => {
      const rt = contrato.rts.find((r) => r.id === Number(botao.dataset.rt));
      fluxoImportarArt(rt, recarregar);
    },
    'editar-rt': (botao) => {
      const rt = contrato.rts.find((r) => r.id === Number(botao.dataset.rt));
      fluxoEditarRt(rt, recarregar);
    },
    'remover-rt': async (botao) => {
      const rt = contrato.rts.find((r) => r.id === Number(botao.dataset.rt));
      if (!confirm(`Remover a RT de ${rt.nome_disciplina} deste contrato?`)) return;
      recarregar(await api.removerRt(rt.id));
      aviso('RT removida.', 'sucesso');
    },
  };

  for (const botao of $$('[data-acao]', conteudo)) {
    botao.addEventListener('click', async () => {
      try {
        await acoes[botao.dataset.acao]?.(botao);
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    });
  }

  $('#add-rt', conteudo)?.addEventListener('change', async (ev) => {
    if (!ev.target.value) return;
    try {
      recarregar(await api.adicionarRt(contrato.id, ev.target.value));
      aviso('Modalidade adicionada como pendente de RT.', 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
      ev.target.value = '';
    }
  });
}

async function carregarHistorico(id) {
  const alvo = $('#historico');
  if (!alvo) return;
  try {
    const eventos = await api.eventos(id);
    alvo.innerHTML = eventos.length
      ? eventos.map((e) => `
          <div class="item-alerta">
            <span class="ponto neutro"></span>
            <span>${escapar(e.descricao)}</span>
            <span class="contrato">${formatarDataHora(e.criado_em)}</span>
          </div>`).join('')
      : '<div class="vazio">Sem movimentações registradas.</div>';
  } catch {
    alvo.innerHTML = '<div class="vazio">Não foi possível carregar o histórico.</div>';
  }
}

async function mostrarConfiguracoes() {
  const [empresa, profissionais] = await Promise.all([api.empresa(), api.profissionais()]);
  conteudo.innerHTML = telaConfiguracoes(empresa, profissionais, disciplinas);

  $('#form-empresa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const salvo = await api.salvarEmpresa(lerCampos(ev.target));
      atualizarMarca(salvo);
      aviso('Dados da empresa salvos.', 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  });

  $('#baixar-backup').addEventListener('click', async (ev) => {
    const botao = ev.currentTarget;
    const rotulo = botao.textContent;
    // juntar os PDFs e comprimir leva alguns segundos com muitos contratos;
    // sem travar o botao da para pedir tres copias sem querer
    botao.disabled = true;
    botao.textContent = 'Preparando a cópia…';
    try {
      const nome = await api.baixarBackup();
      aviso(`Cópia gerada: ${nome}. Guarde fora do Render.`, 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = rotulo;
    }
  });

  $('#form-profissional').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api.criarProfissional(lerCampos(ev.target));
      aviso('Responsável técnico adicionado.', 'sucesso');
      await mostrarConfiguracoes();
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  });

  for (const botao of $$('[data-remover-profissional]', conteudo)) {
    botao.addEventListener('click', async () => {
      await api.removerProfissional(botao.dataset.removerProfissional);
      await mostrarConfiguracoes();
    });
  }
}

/* ------------------------------------------------------------- auxiliares */

function abrirNovoContrato() {
  fluxoNovoContrato((contrato) => irPara(`#/contrato/${contrato.id}`));
}

function atualizarMarca(empresa) {
  $('#marca-empresa').textContent = empresa?.razao_social || 'Configure a empresa';
}

async function atualizarBadge() {
  const dados = await api.painel();
  const criticos = dados.alertas.filter((a) => a.tom === 'critico' || a.tom === 'acao').length;
  $('#badge-alertas').textContent = criticos || '';
}

/* ------------------------------------------------------------- inicializacao */

$('#btn-novo-contrato').addEventListener('click', abrirNovoContrato);
window.addEventListener('hashchange', navegar);

(async () => {
  try {
    const [lista, empresa] = await Promise.all([api.disciplinas(), api.empresa()]);
    disciplinas = lista;
    atualizarMarca(empresa);
  } catch (erro) {
    aviso(`Não foi possível falar com o servidor: ${erro.message}`, 'erro');
  }
  navegar();
})();
