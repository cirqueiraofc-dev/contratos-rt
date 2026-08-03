/**
 * Leitura automatica do PDF de uma ART/RRT emitida (CREA/CAU).
 * Como o layout varia entre conselhos e estados, tudo e best-effort e
 * apresentado ao usuario para conferencia.
 */
import { detectarDisciplinas } from './contrato.js';
import { acharDatas, limparEspacos, normalizar, paraNumero } from '../texto.js';

const RE_VALOR = /R\$\s*([\d.]{1,15},\d{2})/;

function primeiroGrupo(texto, padroes) {
  for (const re of padroes) {
    const m = texto.match(re);
    if (m && m[1]) {
      const limpo = limparEspacos(m[1]).replace(/[,;.]$/, '');
      if (limpo) return limpo;
    }
  }
  return '';
}

function acharNumeroArt(texto) {
  const padroes = [
    /\b(?:n[ºo°.]?\s*(?:da\s+)?)?art\s*n?[ºo°.:\s]*\s*([A-Z]{2}\s?\d{8,16})/i,
    /\bart\s*n?[ºo°.:\s]*\s*(\d{10,16})/i,
    /\bn[ºo°.:]\s*(?:da\s+)?art[:\s]*([A-Z0-9]{8,20})/i,
    /\bn[uú]mero\s+da\s+art[:\s]*([A-Z0-9]{8,20})/i,
    /\b(?:rrt)\s*n?[ºo°.:\s]*\s*(\d{6,16})/i,
  ];
  const bruto = primeiroGrupo(texto, padroes);
  return bruto.replace(/\s+/g, '');
}

function acharProfissional(texto) {
  return primeiroGrupo(texto, [
    /(?:respons[aá]vel\s+t[eé]cnico|profissional)\s*[:\-–]?\s*\n?\s*nome\s*[:\-–]\s*([^\n]{5,90})/i,
    /\bnome\s+do\s+profissional\s*[:\-–]\s*([^\n]{5,90})/i,
    /\bnome\s*[:\-–]\s*([A-ZÀ-Ú][^\n]{5,90})/,
  ]);
}

function acharTitulo(texto) {
  return primeiroGrupo(texto, [
    /\bt[ií]tulo\s+profissional\s*[:\-–]\s*([^\n]{4,90})/i,
    /\bt[ií]tulo\s*[:\-–]\s*([^\n]{4,90})/i,
  ]);
}

function acharCrea(texto) {
  const direto = texto.match(/\bCREA[-\s]?([A-Z]{2})\s*[:nºo°.\s]*\s*([\d.\-\/]{5,20})/i);
  if (direto) return `CREA-${direto[1].toUpperCase()} ${direto[2].trim()}`;
  const registro = primeiroGrupo(texto, [
    /\bregistro\s*(?:no\s+conselho)?\s*[:\-–]\s*([\d.\-\/]{5,20}(?:\s*\/?\s*[A-Z]{2})?)/i,
    /\bcarteira\s*[:\-–]\s*([\d.\-\/]{5,20})/i,
  ]);
  return registro;
}

function acharRnp(texto) {
  return primeiroGrupo(texto, [
    /\bRNP\s*[:\-–]?\s*([\d.\-]{6,20})/i,
    /\bregistro\s+nacional\s*[:\-–]?\s*([\d.\-]{6,20})/i,
  ]).replace(/\s+/g, '');
}

/** Procura a data que aparece logo depois de um rotulo. */
function dataAposRotulo(texto, rotuloRe) {
  const m = texto.match(rotuloRe);
  if (!m) return null;
  const trecho = texto.slice(m.index, m.index + 160);
  const datas = acharDatas(trecho);
  return datas.length ? datas[0].iso : null;
}

/**
 * @param {string} texto texto extraido do PDF da ART
 * @returns {object} rascunho dos dados da RT
 */
export function analisarArt(texto) {
  const numero_art = acharNumeroArt(texto);
  const profissional = acharProfissional(texto);
  const titulo = acharTitulo(texto);
  const crea = acharCrea(texto);
  const rnp = acharRnp(texto);

  const data_registro = dataAposRotulo(texto, /data\s+d[eo]\s+(?:registro|cadastro)/i);
  const data_inicio = dataAposRotulo(texto, /(?:data\s+d[eo]\s+)?in[ií]cio(?:\s+d[ao]s?\s+(?:servi[cç]os?|atividade|obra))?/i);
  const data_validade =
    dataAposRotulo(texto, /(?:previs[aã]o\s+d[eo]\s+)?t[eé]rmino/i)
    ?? dataAposRotulo(texto, /conclus[aã]o/i)
    ?? dataAposRotulo(texto, /validade/i);

  const valorMatch = texto.match(RE_VALOR);
  const valor = valorMatch ? paraNumero(valorMatch[1]) : null;

  // A modalidade e inferida da descricao da atividade tecnica da propria ART.
  const norm = normalizar(texto);
  const inicioAtividade = norm.search(/atividade\s+t[eé]cnica|descri[cç][aã]o|observa[cç][oõ]es/);
  const escopo = inicioAtividade >= 0 ? texto.slice(inicioAtividade) : texto;
  const disciplinas = detectarDisciplinas(escopo);
  const provavel = disciplinas[0]?.pontos >= 3 ? disciplinas[0].disciplina : null;

  const avisos = [];
  if (!numero_art) avisos.push('Número da ART não identificado — confira e preencha.');
  if (!profissional) avisos.push('Nome do profissional não identificado.');
  if (!data_validade) avisos.push('Data de término/validade não identificada — informe para o sistema alertar do vencimento.');

  return {
    numero_art,
    profissional,
    titulo,
    crea,
    rnp,
    data_registro,
    data_inicio,
    data_validade,
    valor,
    disciplina_provavel: provavel,
    disciplinas,
    avisos,
  };
}
