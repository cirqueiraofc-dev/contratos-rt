import { api, empresaEmUso, usarEmpresa } from './api.js';
import { telaConfiguracoes, telaContrato, telaContratos, telaPainel } from './telas.js';
import {
  fluxoConcluir, fluxoEditarContrato, fluxoEditarRt, fluxoImportarArt, fluxoNovoContrato,
  fluxoRegistrarAditivo,
} from './modais.js';
import { $, $$, aviso, escapar, formatarDataHora, lerCampos } from './util.js';

const conteudo = $('#conteudo');
let disciplinas = [];
let contratoAtual = null;
let empresas = [];

// Onde fica guardada a empresa aberta. E escolha de tela, nao dado de
// contrato: mora no navegador de quem esta usando, e o servidor so a recebe
// como parametro. Trocar de maquina comeca de novo na primeira empresa.
const MEMORIA_EMPRESA = 'contratos-rt:empresa';

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

/**
 * @param editandoId qual empresa carregar no formulario; vazio abre em branco
 * @param vindoDeClique leva ate o formulario e poe o cursor nele
 *
 * O segundo parametro existe porque sem ele os botoes pareciam quebrados: o
 * formulario fica abaixo da lista, e trocar de empresa nao mexe em nada perto
 * de onde a pessoa clicou. Com a lista de uma empresa so, em branco, "Adicionar"
 * trocava um formulario vazio por outro formulario vazio — clique sem resposta
 * nenhuma. Botao que nao responde e botao quebrado, mesmo funcionando.
 */
async function mostrarConfiguracoes(editandoId = empresaEmUso(), vindoDeClique = false) {
  const [lista, profissionais] = await Promise.all([api.empresas(), api.profissionais()]);
  empresas = lista;
  conteudo.innerHTML = telaConfiguracoes(empresas, editandoId, profissionais, disciplinas);

  const formulario = $('#form-empresa');
  formulario.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = ev.target.dataset.empresaId;
    try {
      const salvo = id
        ? await api.salvarEmpresa(id, lerCampos(ev.target))
        : await api.criarEmpresa(lerCampos(ev.target));
      aviso(id ? 'Dados da empresa salvos.' : `Empresa ${salvo.razao_social} cadastrada.`, 'sucesso');
      // empresa recem-criada ja entra aberta: e o que quem cadastrou espera
      if (!id) escolherEmpresa(salvo.id);
      await recarregarEmpresas();
      await mostrarConfiguracoes(salvo.id, true);
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  });

  if (vindoDeClique) levarAoFormulario(formulario);

  for (const botao of $$('[data-editar-empresa]', conteudo)) {
    botao.addEventListener('click', () => mostrarConfiguracoes(botao.dataset.editarEmpresa, true));
  }

  for (const botao of $$('[data-remover-empresa]', conteudo)) {
    botao.addEventListener('click', async () => {
      const alvo = empresas.find((e) => String(e.id) === botao.dataset.removerEmpresa);
      if (!confirm(`Excluir a empresa ${alvo?.razao_social || ''}? Isso não pode ser desfeito.`)) return;
      try {
        await api.removerEmpresa(botao.dataset.removerEmpresa);
        if (String(empresaEmUso()) === botao.dataset.removerEmpresa) escolherEmpresa(null);
        await recarregarEmpresas();
        aviso('Empresa excluída.', 'sucesso');
        await mostrarConfiguracoes();
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    });
  }

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

  $('#restaurar-backup').addEventListener('click', async (ev) => {
    const campo = $('#arquivo-restauracao');
    const arquivo = campo.files?.[0];
    if (!arquivo) {
      aviso('Escolha o arquivo .zip da cópia antes de restaurar.', 'erro');
      return;
    }
    // apagar tudo merece mais do que um clique distraido: pede o nome do
    // arquivo de volta, digitado, para nao ter como acontecer sem querer
    const confirmacao = prompt(
      `Restaurar apaga tudo o que está cadastrado agora e coloca o conteúdo de "${arquivo.name}" no lugar.\n\n`
      + 'Para confirmar, digite: RESTAURAR',
    );
    if (confirmacao?.trim().toUpperCase() !== 'RESTAURAR') {
      aviso('Restauração cancelada. Nada foi alterado.');
      return;
    }

    const botao = ev.currentTarget;
    botao.disabled = true;
    botao.textContent = 'Restaurando…';
    try {
      const r = await api.restaurarBackup(arquivo);
      aviso(`Restaurado: ${r.contratos} contrato(s) e ${r.pdfs} arquivo(s).`, 'sucesso');
      campo.value = '';
      // a copia traz as empresas dela; a escolha guardada aqui pode nao existir mais
      escolherEmpresa(null);
      await recarregarEmpresas();
      await mostrarConfiguracoes();
    } catch (erro) {
      aviso(erro.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Restaurar';
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

/** Rola ate o formulario, acende ele por um instante e poe o cursor no primeiro campo. */
function levarAoFormulario(formulario) {
  const cartao = formulario.closest('.cartao');
  const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 'nearest' rola so o necessario: com o formulario ja visivel a tela fica
  // parada, e com ele abaixo da dobra sobe o tanto que falta e nada mais
  cartao.scrollIntoView({ behavior: semMovimento ? 'auto' : 'smooth', block: 'nearest' });
  // preventScroll para o foco nao brigar com a rolagem suave que acabou de comecar
  $('[name="razao_social"]', formulario)?.focus({ preventScroll: true });
  cartao.classList.add('acendendo');
  setTimeout(() => cartao.classList.remove('acendendo'), 1400);
}

/* ------------------------------------------------------------- auxiliares */

function abrirNovoContrato() {
  fluxoNovoContrato((contrato) => irPara(`#/contrato/${contrato.id}`));
}

/**
 * Grava a empresa aberta e avisa a camada de rede. Passar `null` volta para a
 * primeira, que e o que o servidor faz quando o id nao existe mais.
 */
function escolherEmpresa(id) {
  usarEmpresa(id ?? null);
  try {
    if (id) localStorage.setItem(MEMORIA_EMPRESA, String(id));
    else localStorage.removeItem(MEMORIA_EMPRESA);
  } catch {
    // navegador com armazenamento bloqueado: a escolha vale so nesta aba
  }
}

async function recarregarEmpresas() {
  empresas = await api.empresas();
  const aberta = empresas.find((e) => String(e.id) === String(empresaEmUso())) ?? empresas[0];
  if (aberta && String(aberta.id) !== String(empresaEmUso())) escolherEmpresa(aberta.id);
  desenharSeletorEmpresa(aberta);
}

/**
 * Com uma empresa so, um seletor seria enfeite: mostra o nome e pronto. A
 * partir de duas ele aparece, porque ai a pergunta "de quem e esta tela?"
 * passa a existir de verdade.
 */
function desenharSeletorEmpresa(aberta) {
  const alvo = $('#marca-empresa');
  if (!alvo) return;

  if (empresas.length < 2) {
    alvo.textContent = aberta?.razao_social || 'Configure a empresa';
    return;
  }

  alvo.innerHTML = `
    <select id="troca-empresa" aria-label="Empresa aberta">
      ${empresas.map((e) => `
        <option value="${e.id}"${String(e.id) === String(aberta?.id) ? ' selected' : ''}>
          ${escapar(e.razao_social || 'Empresa sem nome')}
        </option>`).join('')}
    </select>`;

  $('#troca-empresa').addEventListener('change', async (ev) => {
    escolherEmpresa(ev.target.value);
    await recarregarEmpresas();
    await atualizarBadge();
    navegar();
  });
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
    // a escolha guardada entra antes de qualquer chamada, senao a primeira
    // tela viria da empresa errada e piscaria ao trocar
    let guardada = null;
    try {
      guardada = localStorage.getItem(MEMORIA_EMPRESA);
    } catch {
      // sem armazenamento: comeca na primeira empresa
    }
    usarEmpresa(guardada);

    disciplinas = await api.disciplinas();
    await recarregarEmpresas();
  } catch (erro) {
    aviso(`Não foi possível falar com o servidor: ${erro.message}`, 'erro');
  }
  navegar();
})();
