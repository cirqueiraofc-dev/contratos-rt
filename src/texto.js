/** Utilitarios de normalizacao de texto, datas e valores em portugues. */

export const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Remove acentos e coloca em minusculas — base para todas as buscas por termo. */
export function normalizar(texto = '') {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Colapsa espacos, quebras e hifenacao de fim de linha vinda do PDF. */
export function limparEspacos(texto = '') {
  return texto
    .replace(/\u00ad/g, '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Numeros escritos por extenso usados em "12 (doze) meses". */
const EXTENSOS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, sessenta: 60,
  noventa: 90, cento: 100, cem: 100,
};

export function numeroPorExtenso(palavra) {
  return EXTENSOS[normalizar(palavra)] ?? null;
}

/** Converte "15/03/2025", "15-03-2025" ou "2025-03-15" para ISO yyyy-mm-dd. */
export function paraISO(dia, mes, ano) {
  let a = Number(ano);
  const d = Number(dia);
  const m = Number(mes);
  if (!d || !m || !a) return null;
  if (a < 100) a += a < 50 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 1900 || a > 2200) return null;
  const iso = `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // rejeita datas impossiveis como 31/02
  const teste = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(teste.getTime()) || teste.getUTCDate() !== d) return null;
  return iso;
}

/**
 * Encontra todas as datas de um trecho, em formato numerico ou por extenso.
 * Retorna [{ iso, indice, trecho }] na ordem em que aparecem.
 */
export function acharDatas(texto = '') {
  const achados = [];
  const bruto = texto;
  const norm = normalizar(texto);

  const numerica = /(\b\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})\b/g;
  for (const m of bruto.matchAll(numerica)) {
    const iso = paraISO(m[1], m[2], m[3]);
    if (iso) achados.push({ iso, indice: m.index, trecho: m[0] });
  }

  const isoDireta = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const m of bruto.matchAll(isoDireta)) {
    const iso = paraISO(m[3], m[2], m[1]);
    if (iso) achados.push({ iso, indice: m.index, trecho: m[0] });
  }

  const porExtenso = new RegExp(
    `\\b(\\d{1,2})\\s*(?:de\\s+)?(${MESES.join('|')})\\s*(?:de\\s+)?(\\d{4})\\b`,
    'g',
  );
  for (const m of norm.matchAll(porExtenso)) {
    const mes = MESES.indexOf(m[2]) + 1;
    const iso = paraISO(m[1], mes, m[3]);
    if (iso) achados.push({ iso, indice: m.index, trecho: bruto.slice(m.index, m.index + m[0].length) });
  }

  return achados.sort((a, b) => a.indice - b.indice);
}

/** Converte "1.234.567,89" para 1234567.89. */
export function paraNumero(valorBr = '') {
  const limpo = String(valorBr).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Soma meses a uma data ISO e subtrai um dia (vigencia de 12 meses a partir de 15/03 -> 14/03). */
export function somarMeses(iso, meses, subtrairUmDia = true) {
  if (!iso || !meses) return null;
  const [a, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  const alvo = new Date(Date.UTC(a, m - 1 + Number(meses), d));
  // se o dia "estourou" o mes (31/01 + 1 mes), volta para o ultimo dia do mes correto
  if (alvo.getUTCDate() !== base.getUTCDate()) alvo.setUTCDate(0);
  if (subtrairUmDia) alvo.setUTCDate(alvo.getUTCDate() - 1);
  return alvo.toISOString().slice(0, 10);
}

export function somarDias(iso, dias) {
  if (!iso) return null;
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + Number(dias));
  return dt.toISOString().slice(0, 10);
}

export function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Dias entre hoje e uma data ISO (negativo = ja passou). */
export function diasAte(iso, referencia = hojeISO()) {
  if (!iso) return null;
  const a = new Date(`${referencia}T12:00:00Z`).getTime();
  const b = new Date(`${iso}T12:00:00Z`).getTime();
  if (Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function dataPorExtenso(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${d} de ${nomes[m - 1]} de ${a}`;
}

export function formatarMoeda(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];

/** Extenso simples para 0..999 — usado em "12 (doze) meses" nos documentos gerados. */
export function porExtenso(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return UNIDADES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d];
  }
  if (n === 100) return 'cem';
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
    'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  return resto ? `${centenas[c]} e ${porExtenso(resto)}` : centenas[c];
}
