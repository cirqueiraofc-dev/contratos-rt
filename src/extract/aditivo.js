/**
 * Leitura automatica do PDF de um termo aditivo: numero do termo, contrato
 * de origem, prorrogacao de prazo, acrescimo/supressao de valor e eventuais
 * modalidades de RT novas trazidas pelo aditamento.
 *
 * Como todo o resto da leitura automatica, e heuristico: o resultado vai para
 * a tela de conferencia antes de virar registro.
 */
import { acharDataAssinatura, acharNumeroContrato, detectarDisciplinas } from './contrato.js';
import {
  limparEspacos, normalizar, numeroPorExtenso, paraISO, paraNumero, somarMeses,
} from '../texto.js';

const ORDINAIS = {
  primeiro: 1, segundo: 2, terceiro: 3, quarto: 4, quinto: 5,
  sexto: 6, setimo: 7, oitavo: 8, nono: 9, decimo: 10,
};

function acharNumeroAditivo(texto) {
  const norm = normalizar(texto);

  const ordinalExtenso = norm.match(/\b(primeiro|segundo|terceiro|quarto|quinto|sexto|setimo|oitavo|nono|decimo)\s+termo\s+aditivo/);
  if (ordinalExtenso) return ORDINAIS[ordinalExtenso[1]];

  const ordinalNumerico = norm.match(/\b(\d{1,2})\s*[ºo°.]?\s*termo\s+aditivo/);
  if (ordinalNumerico) return Number(ordinalNumerico[1]);

  const comNumero = norm.match(/termo\s+aditivo\s*n?[ºo°.:\s]*\s*(\d{1,3})/);
  if (comNumero) return Number(comNumero[1]);

  return null;
}

/** Prorrogacao com data final explicita: "fica prorrogado ate 14/03/2027". */
function acharNovaDataExplicita(texto) {
  const padroes = [
    /prorrogad[oa]s?[^.]{0,120}?at[ée]\s+(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})/i,
    /vig[eê]ncia[^.]{0,120}?at[ée]\s+(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})/i,
    /nova\s+(?:data\s+de\s+)?(?:vig[eê]ncia|t[eé]rmino|vencimento)[^.]{0,60}?(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (m) {
      const iso = paraISO(m[1], m[2], m[3]);
      if (iso) return { data: iso, origem: `data final explícita no termo (${m[0].trim().slice(0, 60)}…)` };
    }
  }

  // "de 15/03/2026 a 14/03/2027" — fica com a data final
  const periodo = texto.match(
    /\bde\s+\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s+(?:a|at[ée])\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/i,
  );
  if (periodo) {
    const iso = paraISO(periodo[1], periodo[2], periodo[3]);
    if (iso) return { data: iso, origem: 'período informado no termo' };
  }

  return { data: null, origem: '' };
}

/** Prorrogacao por quantidade: "prorrogado por mais 12 (doze) meses". */
function acharPrazoAcrescido(texto) {
  const norm = normalizar(texto);
  const padroes = [
    /prorrog\w*[^.]{0,100}?(?:por\s+)?(?:mais\s+)?(\d{1,3})\s*(?:\(([a-zç ]+)\))?\s*(meses|mes|dias|anos|ano)/,
    /acresc\w*[^.]{0,60}?(?:de\s+)?(\d{1,3})\s*(?:\(([a-zç ]+)\))?\s*(meses|mes|dias|anos|ano)[^.]{0,40}?(?:prazo|vig[eê]ncia)/,
    /(?:prazo|vig[eê]ncia)[^.]{0,80}?acresc\w*[^.]{0,40}?(\d{1,3})\s*(?:\(([a-zç ]+)\))?\s*(meses|mes|dias|anos|ano)/,
  ];

  for (const re of padroes) {
    const m = norm.match(re);
    if (!m) continue;
    let quantidade = Number(m[1]);
    if (m[2]) {
      const extenso = numeroPorExtenso(m[2].trim());
      if (extenso && extenso !== quantidade) quantidade = extenso;
    }
    const unidade = m[3];
    if (/dia/.test(unidade)) return { meses: Math.round(quantidade / 30), dias: quantidade, rotulo: `${quantidade} dias` };
    if (/ano/.test(unidade)) return { meses: quantidade * 12, dias: null, rotulo: `${quantidade} ano(s)` };
    return { meses: quantidade, dias: null, rotulo: `${quantidade} meses` };
  }

  return { meses: null, dias: null, rotulo: '' };
}

/**
 * Acrescimo ou supressao de valor. Devolve valor com sinal (supressao negativa)
 * e, quando o termo informa, o novo valor total do contrato.
 */
function acharValores(texto) {
  const norm = normalizar(texto);
  let acrescido = null;
  let novoTotal = null;
  let origem = '';

  const supressao = texto.match(/supress[ãa]o[^.]{0,100}?R\$\s*([\d.]{1,15},\d{2})/i);
  const acrescimo = texto.match(/(?:acr[ée]scimo|aditamento|majora\w*|aditad[oa])[^.]{0,100}?R\$\s*([\d.]{1,15},\d{2})/i);

  if (supressao) {
    acrescido = -Math.abs(paraNumero(supressao[1]) ?? 0);
    origem = 'supressão informada no termo';
  } else if (acrescimo) {
    acrescido = paraNumero(acrescimo[1]);
    origem = 'acréscimo informado no termo';
  }

  const total = texto.match(
    /valor\s+(?:total|global|contratual)[^.]{0,80}?(?:passa\w*|fica\w*|perfaz\w*|totaliz\w*)[^.]{0,40}?R\$\s*([\d.]{1,15},\d{2})/i,
  ) ?? texto.match(
    // "passando o valor total do contrato para R$ ..." — verbo antes do rotulo
    /(?:passa\w*|fica\w*|perfaz\w*|totaliz\w*)[^.]{0,60}?valor\s+(?:total|global|contratual)[^.]{0,60}?R\$\s*([\d.]{1,15},\d{2})/i,
  ) ?? texto.match(
    /(?:passa\w*\s+(?:a\s+ser|para)|novo\s+valor\s+(?:total|global))[^.]{0,60}?R\$\s*([\d.]{1,15},\d{2})/i,
  );
  if (total) {
    novoTotal = paraNumero(total[1]);
    if (!origem) origem = 'novo valor total informado no termo';
  }

  // percentual sem valor em reais: registra so como observacao
  const percentual = norm.match(/(?:acr[ée]scimo|supress[ãa]o)[^.]{0,60}?(\d{1,2}(?:,\d{1,2})?)\s*%/);

  return { acrescido, novoTotal, origem, percentual: percentual ? percentual[1] : null };
}

function acharObjeto(texto) {
  const padroes = [
    /cl[aá]usula\s+primeira[^\n]{0,60}?objeto\s*[:\-–]?\s*([\s\S]{20,900}?)(?=cl[aá]usula\s+segunda|par[aá]grafo|\n\s*cl[aá]usula|$)/i,
    /\bobjeto\s*[:\-–]\s*([\s\S]{20,700}?)(?=cl[aá]usula|\n\n|$)/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (m) {
      const limpo = limparEspacos(m[1]).replace(/^(do|da|e)\s+objeto\s*[:\-–]?\s*/i, '');
      if (limpo.length >= 20) return limpo.slice(0, 700).trim();
    }
  }
  return '';
}

/**
 * @param {string} texto texto extraido do PDF do termo aditivo
 * @param {object} [contrato] contrato ao qual o aditivo sera vinculado, para
 *   calcular o novo vencimento e apontar divergencia de numero
 */
export function analisarAditivo(texto, contrato = null) {
  const ordem = acharNumeroAditivo(texto);
  const contratoReferenciado = acharNumeroContrato(texto);
  const { data: dataAssinatura, origem: origemData } = acharDataAssinatura(texto);
  const explicita = acharNovaDataExplicita(texto);
  const prazo = acharPrazoAcrescido(texto);
  const valores = acharValores(texto);
  const objeto = acharObjeto(texto);

  // vencimento resultante: data explicita ganha; senao soma o prazo ao vencimento atual
  let novaDataVencimento = explicita.data;
  let origemVencimento = explicita.origem;
  if (!novaDataVencimento && prazo.meses && contrato?.data_vencimento) {
    // a prorrogacao corre a partir do dia seguinte ao vencimento vigente
    const diaSeguinte = new Date(`${contrato.data_vencimento}T12:00:00Z`);
    diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
    novaDataVencimento = somarMeses(diaSeguinte.toISOString().slice(0, 10), prazo.meses);
    origemVencimento = `prorrogação de ${prazo.rotulo} somada ao vencimento atual`;
  }

  const acrescido = valores.acrescido
    ?? (valores.novoTotal !== null && contrato?.valor != null ? valores.novoTotal - contrato.valor : null);

  let tipo = 'escopo';
  if (novaDataVencimento && acrescido) tipo = 'prazo_valor';
  else if (novaDataVencimento) tipo = 'prazo';
  else if (acrescido) tipo = 'valor';

  // modalidades que o aditivo pode estar acrescentando ao escopo
  const disciplinas = detectarDisciplinas(objeto || texto);

  const avisos = [];
  if (!ordem) avisos.push('Não foi possível identificar o número do termo aditivo — informe manualmente.');
  if (!dataAssinatura) avisos.push('Nenhuma data de assinatura encontrada no PDF.');
  if (!novaDataVencimento && !acrescido) {
    avisos.push('O termo não parece prorrogar prazo nem alterar valor — confira o tipo e preencha os campos.');
  }
  if (contrato && contratoReferenciado && contratoReferenciado !== contrato.numero) {
    avisos.push(
      `O termo cita o contrato ${contratoReferenciado}, mas está sendo anexado ao contrato ${contrato.numero}. Confirme antes de salvar.`,
    );
  }
  if (valores.percentual && valores.acrescido === null) {
    avisos.push(`O termo menciona ${valores.percentual}% de alteração, mas sem valor em reais — informe o valor.`);
  }

  return {
    ordem,
    numero: ordem ? `${ordem}º Termo Aditivo` : '',
    contrato_referenciado: contratoReferenciado,
    tipo,
    data_assinatura: dataAssinatura,
    prazo_meses: prazo.meses,
    nova_data_vencimento: novaDataVencimento,
    valor_acrescido: acrescido,
    novo_valor_total: valores.novoTotal,
    objeto,
    disciplinas,
    avisos,
    procedencia: {
      data_assinatura: origemData,
      vencimento: origemVencimento,
      valor: valores.origem,
    },
  };
}
