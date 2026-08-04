import { api } from './api.js';
import {
  $, $$, abrirModal, aviso, campo, escapar, fecharModal, formatarData, lerCampos, ocupado,
} from './util.js';

const ROTULO_CONFIANCA = { alta: 'alta', 'média': 'média', baixa: 'baixa', nenhuma: 'nenhuma' };

/** Zona de arrastar-e-soltar + clique para escolher um PDF. */
function zonaUpload(raiz, textoPrincipal, aoEscolher) {
  const zona = $('[data-zona]', raiz);
  const entrada = $('[data-entrada]', raiz);
  if (!zona) return;
  zona.addEventListener('click', () => entrada.click());
  entrada.addEventListener('change', () => {
    if (entrada.files[0]) aoEscolher(entrada.files[0]);
  });
  for (const evento of ['dragenter', 'dragover']) {
    zona.addEventListener(evento, (e) => { e.preventDefault(); zona.classList.add('sobre'); });
  }
  for (const evento of ['dragleave', 'drop']) {
    zona.addEventListener(evento, (e) => { e.preventDefault(); zona.classList.remove('sobre'); });
  }
  zona.addEventListener('drop', (e) => {
    const arquivo = e.dataTransfer?.files?.[0];
    if (arquivo) aoEscolher(arquivo);
  });
  zona.querySelector('strong').textContent = textoPrincipal;
}

const HTML_ZONA = `
  <div class="zona-upload" data-zona>
    <strong></strong>
    <span>Arraste o arquivo aqui ou clique para escolher · somente PDF, até 25 MB</span>
    <input type="file" accept="application/pdf,.pdf" data-entrada hidden />
  </div>`;

function caixaAvisos(avisos, tipo = '') {
  if (!avisos?.length) return '';
  return `<div class="aviso-caixa ${tipo}">
    <strong>Confira antes de salvar:</strong>
    <ul>${avisos.map((a) => `<li>${escapar(a)}</li>`).join('')}</ul>
  </div>`;
}

/* ------------------------------------------------- novo contrato (upload) */

export function fluxoNovoContrato(aoConcluir) {
  const modal = abrirModal({
    titulo: 'Novo contrato',
    corpo: `
      <p style="color:var(--texto-fraco);font-size:13.5px">
        Envie o PDF do contrato assinado. O sistema lê as datas, o objeto e identifica
        quais RTs o escopo exige — você confere tudo antes de salvar.
      </p>
      ${HTML_ZONA}
      <p style="margin-top:14px;font-size:12.5px;color:var(--texto-fraco)">
        Prefere digitar? <button class="botao pequeno" data-manual>Cadastrar sem PDF</button>
      </p>`,
  });

  $('[data-manual]', modal).addEventListener('click', () => {
    formularioContrato({ token: null, extraidos: vazioContrato() }, aoConcluir);
  });

  zonaUpload(modal, 'Selecionar PDF do contrato', async (arquivo) => {
    $('.modal-corpo', modal).innerHTML = '<div class="vazio">Lendo o PDF e identificando as RTs…</div>';
    try {
      const resultado = await api.analisarContrato(arquivo);
      formularioContrato(resultado, aoConcluir);
    } catch (erro) {
      aviso(erro.message, 'erro');
      fluxoNovoContrato(aoConcluir);
    }
  });
}

function vazioContrato() {
  return {
    numero: '', contratante: '', contratante_cnpj: '', objeto: '', valor: null,
    data_assinatura: '', data_vencimento: '', vigencia_meses: null,
    disciplinas: [], avisos: [], procedencia: {},
  };
}

function blocoDeteccao(d) {
  const evidencias = d.evidencias?.length
    ? `<div class="evidencias">
         ${d.evidencias.slice(0, 3).map((e) => `
           <div><code>${escapar(e.termo)}</code> ${e.ocorrencias}× — ${escapar(e.trecho)}</div>`).join('')}
       </div>`
    : '';
  return `
    <div class="deteccao${d.sugerida ? ' marcada' : ''}" data-deteccao="${d.disciplina}">
      <label>
        <input type="checkbox" name="disciplinas" data-lista="1" value="${d.disciplina}"${d.sugerida ? ' checked' : ''} />
        <span>RT de ${escapar(d.nome)}
          <span class="etiqueta ${d.sugerida ? 'acento' : ''}" style="margin-left:6px">
            confiança ${escapar(ROTULO_CONFIANCA[d.confianca] ?? d.confianca)}
          </span>
        </span>
      </label>
      ${evidencias}
    </div>`;
}

export function formularioContrato({ token, extraidos }, aoConcluir) {
  const e = extraidos;
  const procedencia = [
    e.procedencia?.data_assinatura ? `Data de assinatura: ${e.procedencia.data_assinatura}.` : '',
    e.procedencia?.vigencia ? `Vigência: ${e.procedencia.vigencia}.` : '',
  ].filter(Boolean).join(' ');

  const modal = abrirModal({
    titulo: token ? 'Conferir dados lidos do PDF' : 'Cadastrar contrato',
    largura: 820,
    corpo: `
      ${caixaAvisos(e.avisos)}
      ${procedencia ? `<div class="aviso-caixa info">${escapar(procedencia)}</div>` : ''}
      <form id="form-contrato">
        <div class="grade-campos">
          ${campo({ nome: 'numero', rotulo: 'Número do contrato *', valor: e.numero, atributos: 'required' })}
          ${campo({ nome: 'contratante', rotulo: 'Contratante (órgão)', valor: e.contratante })}
          ${campo({ nome: 'contratante_cnpj', rotulo: 'CNPJ do contratante', valor: e.contratante_cnpj })}
          ${campo({ nome: 'valor', rotulo: 'Valor do contrato (R$)', tipo: 'number', valor: e.valor ?? '', atributos: 'step="0.01" min="0"' })}
          ${campo({ nome: 'data_assinatura', rotulo: 'Data de assinatura', tipo: 'date', valor: e.data_assinatura ?? '' })}
          ${campo({ nome: 'vigencia_meses', rotulo: 'Vigência (meses)', tipo: 'number', valor: e.vigencia_meses ?? '', atributos: 'min="0"' })}
          ${campo({ nome: 'data_vencimento', rotulo: 'Vencimento', tipo: 'date', valor: e.data_vencimento ?? '', dica: 'Recalculado ao mudar assinatura ou vigência' })}
          ${campo({ nome: 'objeto', rotulo: 'Objeto', tipo: 'textarea', valor: e.objeto, largo: true })}
        </div>

        <h3 style="font-size:14px;margin:12px 0 8px">RTs necessárias</h3>
        <p style="font-size:12.5px;color:var(--texto-fraco);margin-bottom:10px">
          Marcadas automaticamente pelos termos encontrados no escopo. Ajuste se necessário —
          cada modalidade marcada entra como <strong>pendente de RT</strong>.
        </p>
        ${(e.disciplinas ?? []).map(blocoDeteccao).join('')}
      </form>`,
    rodape: `
      <button class="botao" data-cancelar>Cancelar</button>
      <button class="botao primario" data-salvar>Salvar contrato</button>`,
  });

  const forma = $('#form-contrato', modal);

  // recalcula o vencimento quando assinatura ou vigencia mudam
  const recalcular = async () => {
    const dados = lerCampos(forma);
    if (!dados.data_assinatura || !dados.vigencia_meses) return;
    try {
      const { data_vencimento } = await api.calcularVencimento(dados);
      if (data_vencimento) forma.querySelector('[name=data_vencimento]').value = data_vencimento;
    } catch { /* calculo auxiliar: falha nao bloqueia o cadastro */ }
  };
  forma.querySelector('[name=data_assinatura]').addEventListener('change', recalcular);
  forma.querySelector('[name=vigencia_meses]').addEventListener('change', recalcular);

  for (const caixa of $$('[data-deteccao] input', modal)) {
    caixa.addEventListener('change', () => {
      caixa.closest('[data-deteccao]').classList.toggle('marcada', caixa.checked);
    });
  }

  $('[data-cancelar]', modal).addEventListener('click', () => {
    if (token) api.descartarRascunho(token).catch(() => {});
    fecharModal();
  });

  $('[data-salvar]', modal).addEventListener('click', async (ev) => {
    const dados = lerCampos(forma);
    if (!dados.numero) {
      aviso('Informe o número do contrato.', 'erro');
      return;
    }
    const motivos = {};
    for (const d of e.disciplinas ?? []) {
      motivos[d.disciplina] = d.evidencias?.length
        ? `termos "${d.evidencias.slice(0, 3).map((x) => x.termo).join('", "')}" no escopo`
        : '';
    }
    ocupado(ev.target, true, 'Salvando…');
    try {
      const contrato = await api.criarContrato({ ...dados, token, motivos });
      fecharModal();
      aviso(`Contrato ${contrato.numero} cadastrado com ${contrato.resumo_rts.pendentes} RT(s) pendente(s).`, 'sucesso');
      aoConcluir(contrato);
    } catch (erro) {
      aviso(erro.message, 'erro');
      ocupado(ev.target, false);
    }
  });
}

/* -------------------------------------------------------- editar contrato */

export function fluxoEditarContrato(contrato, aoConcluir) {
  const modal = abrirModal({
    titulo: `Editar contrato ${contrato.numero}`,
    largura: 760,
    corpo: `<form id="form-editar">
      <div class="grade-campos">
        ${campo({ nome: 'numero', rotulo: 'Número do contrato *', valor: contrato.numero })}
        ${campo({ nome: 'contratante', rotulo: 'Contratante (órgão)', valor: contrato.contratante })}
        ${campo({ nome: 'contratante_cnpj', rotulo: 'CNPJ do contratante', valor: contrato.contratante_cnpj })}
        ${campo({ nome: 'valor', rotulo: 'Valor do contrato (R$)', tipo: 'number', valor: contrato.valor ?? '', atributos: 'step="0.01" min="0"' })}
        ${campo({ nome: 'data_assinatura', rotulo: 'Data de assinatura', tipo: 'date', valor: contrato.data_assinatura ?? '' })}
        ${campo({ nome: 'vigencia_meses', rotulo: 'Vigência (meses)', tipo: 'number', valor: contrato.vigencia_meses ?? '' })}
        ${campo({ nome: 'data_vencimento', rotulo: 'Vencimento', tipo: 'date', valor: contrato.data_vencimento ?? '' })}
        ${campo({ nome: 'objeto', rotulo: 'Objeto', tipo: 'textarea', valor: contrato.objeto, largo: true })}
        ${campo({ nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: contrato.observacoes, largo: true })}
      </div>
    </form>`,
    rodape: `<button class="botao" data-cancelar>Cancelar</button>
             <button class="botao primario" data-salvar>Salvar</button>`,
  });

  $('[data-cancelar]', modal).addEventListener('click', fecharModal);
  $('[data-salvar]', modal).addEventListener('click', async (ev) => {
    ocupado(ev.target, true, 'Salvando…');
    try {
      const atualizado = await api.atualizarContrato(contrato.id, lerCampos($('#form-editar', modal)));
      fecharModal();
      aviso('Contrato atualizado.', 'sucesso');
      aoConcluir(atualizado);
    } catch (erro) {
      aviso(erro.message, 'erro');
      ocupado(ev.target, false);
    }
  });
}

/* -------------------------------------------------------- termo aditivo */

export function fluxoRegistrarAditivo(contrato, aoConcluir) {
  const modal = abrirModal({
    titulo: `Registrar termo aditivo — Contrato ${contrato.numero}`,
    corpo: `
      <p style="color:var(--texto-fraco);font-size:13.5px">
        Envie o PDF do termo aditivo. O sistema lê a prorrogação de prazo, o acréscimo ou supressão
        de valor e atualiza a vigência e o valor do contrato.
      </p>
      ${HTML_ZONA}
      <p style="margin-top:14px;font-size:12.5px;color:var(--texto-fraco)">
        Sem o PDF? <button class="botao pequeno" data-manual>Preencher manualmente</button>
      </p>`,
  });

  $('[data-manual]', modal).addEventListener('click', () => {
    formularioAditivo(contrato, { token: null, extraidos: { avisos: [], disciplinas: [] } }, aoConcluir);
  });

  zonaUpload(modal, 'Selecionar PDF do termo aditivo', async (arquivo) => {
    $('.modal-corpo', modal).innerHTML = '<div class="vazio">Lendo o termo aditivo…</div>';
    try {
      const resultado = await api.analisarAditivo(contrato.id, arquivo);
      formularioAditivo(contrato, resultado, aoConcluir);
    } catch (erro) {
      aviso(erro.message, 'erro');
      fluxoRegistrarAditivo(contrato, aoConcluir);
    }
  });
}

function formularioAditivo(contrato, { token, extraidos }, aoConcluir) {
  const e = extraidos ?? {};
  const procedencia = [
    e.procedencia?.data_assinatura ? `Data de assinatura: ${e.procedencia.data_assinatura}.` : '',
    e.procedencia?.vencimento ? `Novo vencimento: ${e.procedencia.vencimento}.` : '',
    e.procedencia?.valor ? `Valor: ${e.procedencia.valor}.` : '',
  ].filter(Boolean).join(' ');

  // so oferece as modalidades que o contrato ainda nao tem
  const novas = (e.disciplinas ?? []).filter(
    (d) => d.sugerida && !contrato.rts.some((rt) => rt.disciplina === d.disciplina),
  );

  const modal = abrirModal({
    titulo: token ? 'Conferir dados do termo aditivo' : 'Registrar termo aditivo',
    largura: 800,
    corpo: `
      ${caixaAvisos(e.avisos)}
      ${procedencia ? `<div class="aviso-caixa info">${escapar(procedencia)}</div>` : ''}
      <div class="aviso-caixa info">
        Vigência atual do contrato: <strong>${formatarData(contrato.data_vencimento)}</strong> ·
        valor atual: <strong>${contrato.valor != null ? Number(contrato.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</strong>
      </div>
      <form id="form-aditivo">
        <div class="grade-campos">
          ${campo({ nome: 'numero', rotulo: 'Identificação do termo *', valor: e.numero ?? '', dica: 'Ex.: 1º Termo Aditivo' })}
          ${campo({
            nome: 'tipo',
            rotulo: 'Tipo',
            tipo: 'select',
            valor: e.tipo ?? 'prazo',
            opcoes: [
              { valor: 'prazo', texto: 'Prorrogação de prazo' },
              { valor: 'valor', texto: 'Alteração de valor' },
              { valor: 'prazo_valor', texto: 'Prazo e valor' },
              { valor: 'escopo', texto: 'Alteração de escopo' },
            ],
          })}
          ${campo({ nome: 'data_assinatura', rotulo: 'Data de assinatura do termo', tipo: 'date', valor: e.data_assinatura ?? '' })}
          ${campo({ nome: 'prazo_meses', rotulo: 'Prazo acrescido (meses)', tipo: 'number', valor: e.prazo_meses ?? '', atributos: 'min="0"' })}
          ${campo({
            nome: 'nova_data_vencimento',
            rotulo: 'Nova data de vencimento',
            tipo: 'date',
            valor: e.nova_data_vencimento ?? '',
            dica: 'Passa a valer como vencimento do contrato',
          })}
          ${campo({
            nome: 'valor_acrescido',
            rotulo: 'Valor acrescido (R$)',
            tipo: 'number',
            valor: e.valor_acrescido ?? '',
            atributos: 'step="0.01"',
            dica: 'Use número negativo para supressão',
          })}
          ${campo({ nome: 'objeto', rotulo: 'Objeto do aditivo', tipo: 'textarea', valor: e.objeto ?? '', largo: true })}
        </div>

        ${novas.length ? `
          <h3 style="font-size:14px;margin:12px 0 8px">Novas modalidades de RT no escopo</h3>
          <p style="font-size:12.5px;color:var(--texto-fraco);margin-bottom:10px">
            O aditivo parece trazer serviço que o contrato ainda não tinha. As marcadas entram como
            <strong>pendente de RT</strong>.
          </p>
          ${novas.map(blocoDeteccao).join('')}` : ''}
      </form>`,
    rodape: `<button class="botao" data-cancelar>Cancelar</button>
             <button class="botao primario" data-salvar>Registrar aditivo</button>`,
  });

  const forma = $('#form-aditivo', modal);

  // prazo em meses preenchido: calcula o novo vencimento a partir do vencimento atual
  forma.querySelector('[name=prazo_meses]').addEventListener('change', async (ev) => {
    const meses = Number(ev.target.value);
    const campoData = forma.querySelector('[name=nova_data_vencimento]');
    if (!meses || !contrato.data_vencimento || campoData.value) return;
    const diaSeguinte = new Date(`${contrato.data_vencimento}T12:00:00Z`);
    diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
    try {
      const { data_vencimento } = await api.calcularVencimento({
        data_assinatura: diaSeguinte.toISOString().slice(0, 10),
        vigencia_meses: meses,
      });
      if (data_vencimento) campoData.value = data_vencimento;
    } catch { /* calculo auxiliar: falha nao bloqueia o registro */ }
  });

  for (const caixa of $$('[data-deteccao] input', modal)) {
    caixa.addEventListener('change', () => {
      caixa.closest('[data-deteccao]').classList.toggle('marcada', caixa.checked);
    });
  }

  $('[data-cancelar]', modal).addEventListener('click', () => {
    if (token) api.descartarRascunho(token).catch(() => {});
    fecharModal();
  });

  $('[data-salvar]', modal).addEventListener('click', async (ev) => {
    const dados = lerCampos(forma);
    if (!dados.numero) {
      aviso('Informe a identificação do termo aditivo.', 'erro');
      return;
    }
    ocupado(ev.target, true, 'Salvando…');
    try {
      const atualizado = await api.salvarAditivo(contrato.id, { ...dados, token });
      fecharModal();
      aviso(`${dados.numero} registrado. Vigência e valor do contrato atualizados.`, 'sucesso');
      aoConcluir(atualizado);
    } catch (erro) {
      aviso(erro.message, 'erro');
      ocupado(ev.target, false);
    }
  });
}

/* ---------------------------------------------------------- importar ART */

export function fluxoImportarArt(rt, aoConcluir) {
  const modal = abrirModal({
    titulo: `Importar ART — ${rt.nome_disciplina}`,
    corpo: `
      <p style="color:var(--texto-fraco);font-size:13.5px">
        Envie o PDF da ART emitida. O sistema tenta ler o número, o profissional e as datas.
      </p>
      ${HTML_ZONA}
      <p style="margin-top:14px;font-size:12.5px;color:var(--texto-fraco)">
        Sem o PDF em mãos? <button class="botao pequeno" data-manual>Preencher manualmente</button>
      </p>`,
  });

  $('[data-manual]', modal).addEventListener('click', () => {
    formularioArt(rt, { token: null, extraidos: { avisos: [] } }, aoConcluir);
  });

  zonaUpload(modal, 'Selecionar PDF da ART', async (arquivo) => {
    $('.modal-corpo', modal).innerHTML = '<div class="vazio">Lendo a ART…</div>';
    try {
      const resultado = await api.analisarArt(rt.id, arquivo);
      formularioArt(rt, resultado, aoConcluir);
    } catch (erro) {
      aviso(erro.message, 'erro');
      fluxoImportarArt(rt, aoConcluir);
    }
  });
}

function formularioArt(rt, { token, extraidos }, aoConcluir) {
  const e = extraidos ?? {};
  const modal = abrirModal({
    titulo: `ART de ${rt.nome_disciplina}`,
    largura: 760,
    corpo: `
      ${caixaAvisos(e.avisos)}
      <form id="form-art">
        <div class="grade-campos">
          ${campo({ nome: 'numero_art', rotulo: 'Número da ART *', valor: e.numero_art ?? rt.numero_art ?? '' })}
          ${campo({ nome: 'profissional', rotulo: 'Profissional responsável', valor: e.profissional ?? rt.profissional ?? '' })}
          ${campo({ nome: 'titulo', rotulo: 'Título profissional', valor: e.titulo ?? rt.titulo ?? rt.titulo_sugerido ?? '' })}
          ${campo({ nome: 'crea', rotulo: 'Registro / CREA', valor: e.crea ?? rt.crea ?? '' })}
          ${campo({ nome: 'rnp', rotulo: 'RNP', valor: e.rnp ?? rt.rnp ?? '' })}
          ${campo({ nome: 'valor', rotulo: 'Valor da ART (R$)', tipo: 'number', valor: e.valor ?? rt.valor ?? '', atributos: 'step="0.01" min="0"' })}
          ${campo({ nome: 'data_registro', rotulo: 'Data de registro', tipo: 'date', valor: e.data_registro ?? rt.data_registro ?? '' })}
          ${campo({ nome: 'data_inicio', rotulo: 'Início das atividades', tipo: 'date', valor: e.data_inicio ?? rt.data_inicio ?? '' })}
          ${campo({
            nome: 'data_validade',
            rotulo: 'Término / validade',
            tipo: 'date',
            valor: e.data_validade ?? rt.data_validade ?? '',
            dica: 'O sistema alerta antes desta data',
          })}
          ${campo({ nome: 'observacoes', rotulo: 'Serviços cobertos por esta ART', tipo: 'textarea', valor: rt.observacoes ?? '', largo: true, dica: 'Usado na descrição do atestado de capacidade técnica' })}
        </div>
      </form>`,
    rodape: `<button class="botao" data-cancelar>Cancelar</button>
             <button class="botao primario" data-salvar>Registrar ART</button>`,
  });

  $('[data-cancelar]', modal).addEventListener('click', () => {
    if (token) api.descartarRascunho(token).catch(() => {});
    fecharModal();
  });

  $('[data-salvar]', modal).addEventListener('click', async (ev) => {
    const dados = lerCampos($('#form-art', modal));
    if (!dados.numero_art) {
      aviso('Informe o número da ART.', 'erro');
      return;
    }
    ocupado(ev.target, true, 'Salvando…');
    try {
      const contrato = await api.salvarArt(rt.id, { ...dados, token });
      fecharModal();
      aviso(`ART registrada para a RT de ${rt.nome_disciplina}.`, 'sucesso');
      aoConcluir(contrato);
    } catch (erro) {
      aviso(erro.message, 'erro');
      ocupado(ev.target, false);
    }
  });
}

/* ------------------------------------------------------------- editar RT */

export function fluxoEditarRt(rt, aoConcluir) {
  const modal = abrirModal({
    titulo: `RT de ${rt.nome_disciplina}`,
    largura: 760,
    corpo: `<form id="form-rt">
      <div class="grade-campos">
        ${campo({
          nome: 'status',
          rotulo: 'Situação',
          tipo: 'select',
          valor: rt.status,
          opcoes: [
            { valor: 'pendente', texto: 'Pendente de RT' },
            { valor: 'emitida', texto: 'ART emitida' },
            { valor: 'baixada', texto: 'ART baixada' },
            { valor: 'dispensada', texto: 'Dispensada neste contrato' },
          ],
        })}
        ${campo({ nome: 'numero_art', rotulo: 'Número da ART', valor: rt.numero_art ?? '' })}
        ${campo({ nome: 'profissional', rotulo: 'Profissional responsável', valor: rt.profissional ?? '' })}
        ${campo({ nome: 'titulo', rotulo: 'Título profissional', valor: rt.titulo ?? rt.titulo_sugerido ?? '' })}
        ${campo({ nome: 'crea', rotulo: 'Registro / CREA', valor: rt.crea ?? '' })}
        ${campo({ nome: 'rnp', rotulo: 'RNP', valor: rt.rnp ?? '' })}
        ${campo({ nome: 'valor', rotulo: 'Valor da ART (R$)', tipo: 'number', valor: rt.valor ?? '', atributos: 'step="0.01" min="0"' })}
        ${campo({ nome: 'data_registro', rotulo: 'Data de registro', tipo: 'date', valor: rt.data_registro ?? '' })}
        ${campo({ nome: 'data_inicio', rotulo: 'Início das atividades', tipo: 'date', valor: rt.data_inicio ?? '' })}
        ${campo({ nome: 'data_validade', rotulo: 'Término / validade', tipo: 'date', valor: rt.data_validade ?? '' })}
        ${campo({ nome: 'observacoes', rotulo: 'Serviços cobertos por esta ART', tipo: 'textarea', valor: rt.observacoes ?? '', largo: true })}
      </div>
    </form>`,
    rodape: `<button class="botao" data-cancelar>Cancelar</button>
             <button class="botao primario" data-salvar>Salvar</button>`,
  });

  $('[data-cancelar]', modal).addEventListener('click', fecharModal);
  $('[data-salvar]', modal).addEventListener('click', async (ev) => {
    ocupado(ev.target, true, 'Salvando…');
    try {
      const contrato = await api.atualizarRt(rt.id, lerCampos($('#form-rt', modal)));
      fecharModal();
      aviso('RT atualizada.', 'sucesso');
      aoConcluir(contrato);
    } catch (erro) {
      aviso(erro.message, 'erro');
      ocupado(ev.target, false);
    }
  });
}

/* ------------------------------------------------------ concluir contrato */

export function fluxoConcluir(contrato, aoConcluir) {
  const pendentes = contrato.rts.filter((rt) => rt.status === 'pendente');
  const semArt = contrato.rts.filter((rt) => rt.status !== 'dispensada' && !rt.numero_art);

  const modal = abrirModal({
    titulo: `Concluir contrato ${contrato.numero}`,
    corpo: `
      ${pendentes.length ? caixaAvisos([
        `${pendentes.length} RT(s) ainda pendente(s): ${pendentes.map((r) => r.nome_disciplina).join(', ')}.`,
      ]) : ''}
      ${semArt.length ? caixaAvisos([
        'Sem o número da ART não é possível gerar o requerimento de CAT dessas modalidades: '
        + `${semArt.map((r) => r.nome_disciplina).join(', ')}.`,
      ]) : ''}
      <p style="font-size:13.5px;color:var(--texto-fraco)">
        Ao concluir, as ARTs emitidas passam a <strong>baixadas</strong> e o contrato entra na fila de
        geração de CAT.
      </p>
      <form id="form-concluir">
        ${campo({
          nome: 'data_conclusao',
          rotulo: 'Data de conclusão dos serviços',
          tipo: 'date',
          valor: contrato.data_conclusao ?? contrato.data_vencimento ?? new Date().toISOString().slice(0, 10),
        })}
      </form>
      <p style="font-size:12.5px;color:var(--texto-fraco)">
        Vigência do contrato: ${formatarData(contrato.data_assinatura)} → ${formatarData(contrato.data_vencimento)}
      </p>`,
    rodape: `<button class="botao" data-cancelar>Cancelar</button>
             <button class="botao primario" data-salvar>Concluir contrato</button>`,
  });

  $('[data-cancelar]', modal).addEventListener('click', fecharModal);
  $('[data-salvar]', modal).addEventListener('click', async (ev) => {
    ocupado(ev.target, true, 'Concluindo…');
    try {
      const atualizado = await api.mudarStatus(contrato.id, {
        status: 'concluido',
        ...lerCampos($('#form-concluir', modal)),
      });
      fecharModal();
      aviso('Contrato concluído. Agora é só gerar a CAT.', 'sucesso');
      aoConcluir(atualizado);
    } catch (erro) {
      aviso(erro.message, 'erro');
      ocupado(ev.target, false);
    }
  });
}
