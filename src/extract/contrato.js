/**
 * Leitura automatica do PDF do contrato: numero, partes, objeto, valor,
 * data de assinatura, vigencia/vencimento e quais RTs o escopo exige.
 *
 * Tudo aqui e heuristico. O resultado e sempre apresentado ao usuario para
 * conferencia antes de virar registro — nada e gravado direto.
 */
import { DISCIPLINAS } from '../disciplinas.js';
import {
  acharDatas, formatarData, limparEspacos, normalizar, numeroPorExtenso,
  paraISO, paraNumero, somarMeses,
} from '../texto.js';

const RE_CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const RE_VALOR = /R\$\s*([\d.]{1,15},\d{2})/g;

/** Retorna um trecho do texto ao redor de um indice, para servir de evidencia. */
function trechoAoRedor(texto, indice, tamanho = 130) {
  const ini = Math.max(0, indice - Math.floor(tamanho / 3));
  const fim = Math.min(texto.length, indice + tamanho);
  return `${ini > 0 ? '…' : ''}${limparEspacos(texto.slice(ini, fim))}${fim < texto.length ? '…' : ''}`;
}

function acharNumeroContrato(texto) {
  const padroes = [
    /\bcontrato\s+(?:administrativo\s+)?(?:de\s+presta[cç][aã]o\s+de\s+servi[cç]os\s+)?n[ºo°.\s]*\s*([\d]{1,6}\s*[\/.-]\s*\d{2,4})/i,
    /\btermo\s+de\s+contrato\s+n[ºo°.\s]*\s*([\d]{1,6}\s*[\/.-]\s*\d{2,4})/i,
    /\bcontrato\s+n[ºo°.\s]*\s*([\d]{1,6})\b/i,
    /\bn[ºo°]\s*(?:do\s+)?contrato[:\s]+([\d]{1,6}\s*[\/.-]\s*\d{2,4})/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (m) return m[1].replace(/\s+/g, '').replace(/[.-]/, '/');
  }
  return '';
}

function acharContratante(texto) {
  const rotulo = texto.match(
    /contratante\s*[:\-–]\s*([^\n]{5,160})/i,
  );
  if (rotulo) {
    const bruto = limparEspacos(rotulo[1])
      .replace(/,?\s*(inscrit[ao]|cnpj|pessoa jur[ií]dica|com sede|neste ato).*$/i, '')
      .replace(/[,;.]$/, '');
    if (bruto.length >= 5) return bruto;
  }

  const orgaos = /((?:prefeitura municipal|munic[ií]pio|secretaria (?:municipal|de estado|estadual)|governo do estado|estado d[eo]|fundo municipal|autarquia|c[aâ]mara municipal|instituto|funda[cç][aã]o|universidade|hospital|tribunal|minist[eé]rio|superintend[eê]ncia)[^\n,;]{0,90})/i;
  const m = texto.match(orgaos);
  return m ? limparEspacos(m[1]).replace(/[,;.]$/, '') : '';
}

function acharObjeto(texto) {
  const padroes = [
    /cl[aá]usula\s+primeira[^\n]{0,60}?objeto\s*[:\-–]?\s*([\s\S]{20,1200}?)(?=cl[aá]usula\s+segunda|par[aá]grafo|\n\s*cl[aá]usula|$)/i,
    /\bdo\s+objeto\s*[:\-–]?\s*([\s\S]{20,1200}?)(?=cl[aá]usula|par[aá]grafo|$)/i,
    /\bobjeto\s*[:\-–]\s*([\s\S]{20,900}?)(?=cl[aá]usula|\n\n|$)/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (m) {
      const limpo = limparEspacos(m[1]).replace(/^(do|da|e)\s+objeto\s*[:\-–]?\s*/i, '');
      if (limpo.length >= 20) return limpo.slice(0, 900).trim();
    }
  }
  return '';
}

function acharValor(texto) {
  const norm = normalizar(texto);
  const candidatos = [];
  for (const m of texto.matchAll(RE_VALOR)) {
    const valor = paraNumero(m[1]);
    if (valor === null) continue;
    const contexto = norm.slice(Math.max(0, m.index - 160), m.index);
    const relevante = /(valor\s+(global|total|do\s+contrato|estimad|contratual)|importa\s+em|preco\s+global|monta\s+em)/.test(contexto);
    candidatos.push({ valor, relevante });
  }
  if (!candidatos.length) return null;
  const preferidos = candidatos.filter((c) => c.relevante);
  const lista = preferidos.length ? preferidos : candidatos;
  return lista.reduce((maior, c) => (c.valor > maior ? c.valor : maior), 0) || null;
}

function acharDataAssinatura(texto) {
  const datas = acharDatas(texto);
  if (!datas.length) return { data: null, origem: '' };
  const norm = normalizar(texto);

  // 1) rotulo explicito
  for (const d of datas) {
    const contexto = norm.slice(Math.max(0, d.indice - 120), d.indice + 40);
    if (/(data\s+d[ae]\s+assinatura|assinad[oa]\s+(em|aos)|firmad[oa]\s+em|celebrad[oa]\s+em|data\s+d[ao]\s+contrato)/.test(contexto)) {
      return { data: d.iso, origem: 'rótulo de assinatura no texto' };
    }
  }

  // 2) formula de fecho: "Cidade, 15 de marco de 2025" no ultimo terco do documento
  const corte = texto.length * 0.6;
  const fecho = datas.filter((d) => d.indice >= corte);
  for (const d of fecho.reverse()) {
    const contexto = norm.slice(Math.max(0, d.indice - 60), d.indice);
    if (/[a-z]{3,},\s*$|[a-z]{3,}\s*,\s*$|aos\s*$|em\s*$/.test(contexto)) {
      return { data: d.iso, origem: 'fecho do contrato' };
    }
  }

  // 3) ultima data do documento
  const ultima = datas[datas.length - 1];
  return { data: ultima.iso, origem: 'última data encontrada no documento' };
}

function acharVigencia(texto, dataAssinatura) {
  const norm = normalizar(texto);

  // periodo explicito: "de 15/03/2025 a 14/03/2026"
  const periodo = texto.match(
    /\bde\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s+(?:a|at[ée])\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/i,
  );
  if (periodo) {
    const inicio = paraISO(periodo[1], periodo[2], periodo[3]);
    const fim = paraISO(periodo[4], periodo[5], periodo[6]);
    if (inicio && fim) {
      return { meses: null, inicio, vencimento: fim, origem: `período explícito ${formatarData(inicio)} a ${formatarData(fim)}` };
    }
  }

  const padroes = [
    /vig[eê]ncia[^.]{0,120}?(\d{1,3})\s*(?:\(([a-zç ]+)\))?\s*(meses|m[eê]s|dias|anos|ano)/i,
    /prazo[^.]{0,80}?(?:de\s+)?(\d{1,3})\s*(?:\(([a-zç ]+)\))?\s*(meses|m[eê]s|dias|anos|ano)[^.]{0,60}?vig[eê]ncia/i,
    /(?:pelo\s+)?prazo\s+de\s+(\d{1,3})\s*(?:\(([a-zç ]+)\))?\s*(meses|m[eê]s|dias|anos|ano)/i,
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
    let meses = null;
    let dias = null;
    if (/dia/.test(unidade)) dias = quantidade;
    else if (/ano/.test(unidade)) meses = quantidade * 12;
    else meses = quantidade;

    const rotulo = dias ? `${dias} dias` : `${meses} meses`;
    let vencimento = null;
    if (dataAssinatura) {
      vencimento = dias ? addDias(dataAssinatura, dias - 1) : somarMeses(dataAssinatura, meses);
    }
    return {
      meses: meses ?? Math.round(dias / 30),
      inicio: dataAssinatura,
      vencimento,
      origem: `vigência de ${rotulo} contada da assinatura`,
    };
  }

  return { meses: null, inicio: dataAssinatura, vencimento: null, origem: '' };
}

function addDias(iso, dias) {
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

/**
 * Pontua cada modalidade de RT a partir dos termos tecnicos encontrados no escopo.
 * @returns {Array<{ disciplina, nome, pontos, confianca, sugerida, evidencias }>}
 */
export function detectarDisciplinas(texto) {
  const norm = normalizar(texto);
  const resultado = [];

  for (const disc of Object.values(DISCIPLINAS)) {
    let pontos = 0;
    const evidencias = [];

    for (const [termo, peso] of disc.termos) {
      const indice = norm.indexOf(termo);
      if (indice === -1) continue;
      pontos += peso;
      const ocorrencias = norm.split(termo).length - 1;
      evidencias.push({ termo, peso, ocorrencias, trecho: trechoAoRedor(texto, indice) });
    }

    evidencias.sort((a, b) => b.peso - a.peso || b.ocorrencias - a.ocorrencias);

    let confianca = 'nenhuma';
    if (pontos >= 6) confianca = 'alta';
    else if (pontos >= 3) confianca = 'média';
    else if (pontos >= 1) confianca = 'baixa';

    resultado.push({
      disciplina: disc.id,
      nome: disc.nome,
      pontos,
      confianca,
      sugerida: pontos >= 3,
      evidencias: evidencias.slice(0, 6),
    });
  }

  return resultado.sort((a, b) => b.pontos - a.pontos);
}

/**
 * Analisa o texto de um contrato e devolve um rascunho de cadastro.
 * @param {string} texto texto extraido do PDF
 */
export function analisarContrato(texto) {
  const numero = acharNumeroContrato(texto);
  const contratante = acharContratante(texto);
  const cnpjs = [...texto.matchAll(RE_CNPJ)].map((m) => m[0]);
  const objeto = acharObjeto(texto);
  const valor = acharValor(texto);
  const { data: dataAssinatura, origem: origemData } = acharDataAssinatura(texto);
  const vigencia = acharVigencia(texto, dataAssinatura);
  const disciplinas = detectarDisciplinas(texto);

  const avisos = [];
  if (!numero) avisos.push('Não foi possível identificar o número do contrato — preencha manualmente.');
  if (!dataAssinatura) avisos.push('Nenhuma data de assinatura encontrada no PDF.');
  if (!vigencia.vencimento) avisos.push('Não foi possível calcular o vencimento — informe a vigência ou a data final.');
  if (!disciplinas.some((d) => d.sugerida)) {
    avisos.push('Nenhuma modalidade de RT foi identificada com segurança — selecione manualmente as necessárias.');
  }

  return {
    numero,
    contratante,
    contratante_cnpj: cnpjs[0] ?? '',
    cnpjs_encontrados: [...new Set(cnpjs)],
    objeto,
    valor,
    data_assinatura: dataAssinatura,
    data_vencimento: vigencia.vencimento,
    vigencia_meses: vigencia.meses,
    disciplinas,
    avisos,
    procedencia: {
      data_assinatura: origemData,
      vigencia: vigencia.origem,
    },
  };
}
