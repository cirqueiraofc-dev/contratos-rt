/**
 * Regras de negocio: situacao de cada RT e de cada contrato, pendencias,
 * alertas de vencimento e montagem dos dados que a interface consome.
 */
import { agora, all, get, run } from './db.js';
import { DISCIPLINAS } from './disciplinas.js';
import { diasAte, formatarData, hojeISO } from './texto.js';

export const STATUS_CONTRATO = ['ativo', 'concluido', 'cancelado'];
export const STATUS_RT = ['pendente', 'emitida', 'baixada', 'dispensada'];

export function lerEmpresa() {
  return get('SELECT * FROM empresa WHERE id = 1');
}

export function aditivosDoContrato(contratoId) {
  return all(
    `SELECT id, contrato_id, numero, tipo, data_assinatura, prazo_meses, nova_data_vencimento,
            valor_acrescido, objeto, observacoes, arquivo, arquivo_nome, criado_em
       FROM aditivos WHERE contrato_id = ?
      ORDER BY COALESCE(data_assinatura, '9999'), id`,
    contratoId,
  );
}

/**
 * Reescreve vencimento, valor e vigencia do contrato a partir dos valores
 * originais mais os termos aditivos registrados. Chamado sempre que um aditivo
 * entra, sai ou muda — assim os numeros nunca ficam dessincronizados.
 */
export function recalcularContrato(contratoId) {
  const contrato = get('SELECT * FROM contratos WHERE id = ?', contratoId);
  if (!contrato) return null;
  const aditivos = aditivosDoContrato(contratoId);

  const ultimaProrrogacao = [...aditivos].reverse().find((a) => a.nova_data_vencimento);
  const vencimento = ultimaProrrogacao?.nova_data_vencimento ?? contrato.data_vencimento_original ?? null;

  const mesesAcrescidos = aditivos.reduce((soma, a) => soma + (a.prazo_meses ?? 0), 0);
  const vigencia = contrato.vigencia_meses_original === null && !mesesAcrescidos
    ? null
    : (contrato.vigencia_meses_original ?? 0) + mesesAcrescidos;

  const valorAcrescido = aditivos.reduce((soma, a) => soma + (a.valor_acrescido ?? 0), 0);
  const valor = contrato.valor_original === null && !valorAcrescido
    ? null
    : (contrato.valor_original ?? 0) + valorAcrescido;

  run(
    'UPDATE contratos SET data_vencimento = ?, valor = ?, vigencia_meses = ?, atualizado_em = ? WHERE id = ?',
    vencimento, valor, vigencia, agora(), contratoId,
  );
  return get('SELECT * FROM contratos WHERE id = ?', contratoId);
}

/**
 * Classifica uma RT considerando o prazo de alerta configurado.
 * @param {object} rt
 * @param {number} diasAlerta antecedencia do alerta de vencimento
 * @param {string|null} vencimentoContrato para detectar ART que nao cobre toda a vigencia
 * @returns {object} a propria RT acrescida de campos derivados
 */
export function enriquecerRt(rt, diasAlerta, vencimentoContrato = null) {
  const dias = rt.data_validade ? diasAte(rt.data_validade) : null;
  let situacao = rt.status;
  let tom = 'neutro';
  let mensagem = '';

  if (rt.status === 'pendente') {
    situacao = 'pendente';
    tom = 'alerta';
    mensagem = 'ART ainda não emitida';
  } else if (rt.status === 'dispensada') {
    tom = 'neutro';
    mensagem = 'Modalidade dispensada para este contrato';
  } else if (rt.status === 'baixada') {
    tom = 'ok';
    mensagem = 'ART baixada';
  } else if (rt.status === 'emitida') {
    if (dias === null) {
      tom = 'neutro';
      mensagem = 'Sem data de validade informada';
    } else if (dias < 0) {
      situacao = 'vencida';
      tom = 'critico';
      mensagem = `Vencida há ${Math.abs(dias)} dia(s)`;
    } else if (dias <= diasAlerta) {
      situacao = 'a_vencer';
      tom = 'alerta';
      mensagem = `Vence em ${dias} dia(s)`;
    } else {
      tom = 'ok';
      mensagem = `Válida por mais ${dias} dia(s)`;
    }
  }

  // ART emitida que termina antes do contrato deixa um periodo descoberto —
  // tipico depois de uma prorrogacao, quando cabe ART complementar.
  const coberturaIncompleta = Boolean(
    rt.status !== 'dispensada'
    && rt.numero_art
    && rt.data_validade
    && vencimentoContrato
    && rt.data_validade < vencimentoContrato,
  );

  return {
    ...rt,
    nome_disciplina: DISCIPLINAS[rt.disciplina]?.nome ?? rt.disciplina,
    titulo_sugerido: DISCIPLINAS[rt.disciplina]?.titulo ?? '',
    dias_para_vencer: dias,
    situacao,
    tom: coberturaIncompleta && tom === 'ok' ? 'acao' : tom,
    mensagem,
    cobertura_incompleta: coberturaIncompleta,
    tem_arquivo: Boolean(rt.arquivo),
  };
}

export function rtsDoContrato(contratoId, diasAlerta, vencimentoContrato = null) {
  const linhas = all('SELECT * FROM rts WHERE contrato_id = ? ORDER BY disciplina', contratoId);
  return linhas.map((rt) => enriquecerRt(rt, diasAlerta, vencimentoContrato));
}

export function documentosDoContrato(contratoId) {
  return all('SELECT id, contrato_id, tipo, titulo, arquivo_nome, criado_em FROM documentos WHERE contrato_id = ? ORDER BY criado_em DESC', contratoId);
}

/**
 * Situacao consolidada do contrato e lista de pendencias acionaveis.
 */
export function situacaoContrato(contrato, rts, documentos, empresa) {
  const pendencias = [];
  const diasContrato = contrato.data_vencimento ? diasAte(contrato.data_vencimento) : null;

  const pendentes = rts.filter((rt) => rt.situacao === 'pendente');
  const vencidas = rts.filter((rt) => rt.situacao === 'vencida');
  const aVencer = rts.filter((rt) => rt.situacao === 'a_vencer');
  const descobertas = rts.filter((rt) => rt.cobertura_incompleta);
  const temAtestado = documentos.some((d) => d.tipo === 'atestado');

  // pendencias de RT so fazem sentido enquanto o contrato esta em execucao
  if (contrato.status === 'ativo') {
    for (const rt of pendentes) {
      pendencias.push({ tipo: 'rt_pendente', tom: 'alerta', texto: `RT de ${rt.nome_disciplina} pendente de emissão` });
    }
    for (const rt of vencidas) {
      pendencias.push({ tipo: 'rt_vencida', tom: 'critico', texto: `ART de ${rt.nome_disciplina} vencida em ${formatarData(rt.data_validade)}` });
    }
    for (const rt of aVencer) {
      pendencias.push({ tipo: 'rt_a_vencer', tom: 'alerta', texto: `ART de ${rt.nome_disciplina} vence em ${rt.dias_para_vencer} dia(s)` });
    }
    for (const rt of descobertas) {
      pendencias.push({
        tipo: 'rt_cobertura',
        tom: 'acao',
        texto: `ART de ${rt.nome_disciplina} cobre até ${formatarData(rt.data_validade)}, `
          + `mas o contrato vai até ${formatarData(contrato.data_vencimento)} — emitir ART complementar`,
      });
    }
  }

  let rotulo = 'Ativo';
  let tom = 'ok';

  if (contrato.status === 'cancelado') {
    rotulo = 'Cancelado';
    tom = 'neutro';
  } else if (contrato.status === 'concluido') {
    if (temAtestado) {
      rotulo = 'Concluído — CAT gerada';
      tom = 'ok';
    } else {
      rotulo = 'Concluído — gerar CAT';
      tom = 'acao';
      pendencias.push({ tipo: 'gerar_cat', tom: 'acao', texto: 'Contrato concluído: gerar atestado e requerimento de CAT' });
    }
  } else {
    if (diasContrato !== null && diasContrato < 0) {
      rotulo = 'Vigência encerrada';
      tom = 'critico';
      pendencias.push({ tipo: 'contrato_vencido', tom: 'critico', texto: 'Vigência encerrada — concluir o contrato ou registrar aditivo' });
    } else if (diasContrato !== null && diasContrato <= empresa.dias_alerta_contrato) {
      rotulo = `Vence em ${diasContrato} dia(s)`;
      tom = 'alerta';
      pendencias.push({ tipo: 'contrato_a_vencer', tom: 'alerta', texto: `Vigência termina em ${diasContrato} dia(s)` });
    }
    if (vencidas.length) tom = 'critico';
    else if (pendentes.length || aVencer.length) tom = tom === 'critico' ? 'critico' : 'alerta';
    else if (descobertas.length && tom === 'ok') tom = 'acao';
    if (pendentes.length && rotulo === 'Ativo') rotulo = `Pendente de RT (${pendentes.length})`;
    else if (descobertas.length && rotulo === 'Ativo') rotulo = `ART complementar (${descobertas.length})`;
  }

  return {
    rotulo,
    tom,
    pendencias,
    dias_para_vencer: diasContrato,
    resumo_rts: {
      total: rts.length,
      pendentes: pendentes.length,
      emitidas: rts.filter((rt) => rt.status === 'emitida' || rt.status === 'baixada').length,
      vencidas: vencidas.length,
      a_vencer: aVencer.length,
      descobertas: descobertas.length,
      dispensadas: rts.filter((rt) => rt.status === 'dispensada').length,
    },
    tem_atestado: temAtestado,
  };
}

/** Contrato completo, com RTs, documentos e situacao — usado na tela de detalhe. */
export function montarContrato(id) {
  const contrato = get('SELECT * FROM contratos WHERE id = ?', id);
  if (!contrato) return null;
  const empresa = lerEmpresa();
  const rts = rtsDoContrato(contrato.id, empresa.dias_alerta_rt, contrato.data_vencimento);
  const documentos = documentosDoContrato(contrato.id);
  const aditivos = aditivosDoContrato(contrato.id);
  const situacao = situacaoContrato(contrato, rts, documentos, empresa);
  const { texto, ...semTexto } = contrato;
  return { ...semTexto, tem_texto: Boolean(texto), rts, documentos, aditivos, ...situacao };
}

/** Lista resumida para a tela de contratos. */
export function listarContratos({ status = '', busca = '' } = {}) {
  const empresa = lerEmpresa();
  const filtros = [];
  const params = [];
  if (status && STATUS_CONTRATO.includes(status)) {
    filtros.push('status = ?');
    params.push(status);
  }
  if (busca) {
    filtros.push('(numero LIKE ? OR contratante LIKE ? OR objeto LIKE ?)');
    const alvo = `%${busca}%`;
    params.push(alvo, alvo, alvo);
  }
  const onde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const linhas = all(
    `SELECT c.id, c.numero, c.contratante, c.objeto, c.valor, c.data_assinatura, c.data_vencimento,
            c.vigencia_meses, c.status, c.data_conclusao, c.arquivo, c.criado_em,
            (SELECT COUNT(*) FROM aditivos a WHERE a.contrato_id = c.id) AS total_aditivos
       FROM contratos c ${onde ? onde.replace(/\b(numero|contratante|objeto|status)\b/g, 'c.$1') : ''}
      ORDER BY (c.status = 'ativo') DESC, COALESCE(c.data_vencimento, '9999') ASC, c.id DESC`,
    ...params,
  );

  return linhas.map((contrato) => {
    const rts = rtsDoContrato(contrato.id, empresa.dias_alerta_rt, contrato.data_vencimento);
    const documentos = documentosDoContrato(contrato.id);
    const situacao = situacaoContrato(contrato, rts, documentos, empresa);
    return { ...contrato, rts, ...situacao };
  });
}

/** Numeros e listas do painel inicial. */
export function montarPainel() {
  const empresa = lerEmpresa();
  const contratos = listarContratos();
  const ativos = contratos.filter((c) => c.status === 'ativo');

  const alertas = [];
  for (const contrato of contratos) {
    if (contrato.status === 'cancelado') continue;
    for (const pendencia of contrato.pendencias) {
      alertas.push({
        ...pendencia,
        contrato_id: contrato.id,
        contrato_numero: contrato.numero,
        contratante: contrato.contratante,
      });
    }
  }

  const ordemTom = { critico: 0, acao: 1, alerta: 2, neutro: 3, ok: 4 };
  alertas.sort((a, b) => (ordemTom[a.tom] ?? 9) - (ordemTom[b.tom] ?? 9));

  const somaRts = (chave) => ativos.reduce((s, c) => s + c.resumo_rts[chave], 0);

  return {
    hoje: hojeISO(),
    empresa_configurada: Boolean(empresa.razao_social && empresa.cnpj),
    indicadores: {
      contratos_ativos: ativos.length,
      contratos_concluidos: contratos.filter((c) => c.status === 'concluido').length,
      rts_pendentes: somaRts('pendentes'),
      rts_a_vencer: somaRts('a_vencer'),
      rts_vencidas: somaRts('vencidas'),
      rts_descobertas: somaRts('descobertas'),
      contratos_a_vencer: ativos.filter(
        (c) => c.dias_para_vencer !== null && c.dias_para_vencer >= 0 && c.dias_para_vencer <= empresa.dias_alerta_contrato,
      ).length,
      cats_a_gerar: contratos.filter((c) => c.status === 'concluido' && !c.tem_atestado).length,
    },
    alertas: alertas.slice(0, 40),
    proximos_vencimentos: contratos
      .filter((c) => c.status === 'ativo' && c.dias_para_vencer !== null)
      .sort((a, b) => a.dias_para_vencer - b.dias_para_vencer)
      .slice(0, 8)
      .map((c) => ({
        id: c.id, numero: c.numero, contratante: c.contratante,
        data_vencimento: c.data_vencimento, dias: c.dias_para_vencer,
      })),
    parametros: {
      dias_alerta_rt: empresa.dias_alerta_rt,
      dias_alerta_contrato: empresa.dias_alerta_contrato,
    },
  };
}
