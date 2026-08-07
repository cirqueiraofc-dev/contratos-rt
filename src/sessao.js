/**
 * Sessao por cookie assinado.
 *
 * A protecao por senha continua sendo a mesma senha unica do APP_SENHA — o
 * que muda e a porta de entrada. Antes o navegador pedia a senha na caixinha
 * dele, que nao tem como ser explicada nem tem jeito de sair. Agora quem pede
 * e a tela de entrada do sistema, e o que fica guardado no navegador e este
 * cookie.
 *
 * Nao ha banco de sessoes: o cookie carrega a propria validade e uma
 * assinatura HMAC feita com a senha. Se a senha mudar, toda sessao emitida
 * antes para de valer sozinha — que e exatamente o que se espera de uma troca
 * de senha.
 */
import crypto from 'node:crypto';

export const NOME_COOKIE = 'sessao';

/** 30 dias. Longo de proposito: e uma ferramenta de trabalho de uso diario. */
export const DURACAO = 30 * 24 * 60 * 60 * 1000;

function assinar(senha, ate) {
  return crypto.createHmac('sha256', String(senha)).update(String(ate)).digest('base64url');
}

/** Comparacao de tempo constante, para nao vazar a assinatura pelo relogio. */
function iguais(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Le o cabecalho Cookie. Devolve sempre um objeto — cabecalho ausente ou
 * malformado vira objeto vazio, nunca erro.
 */
export function lerCookies(cabecalho) {
  const saida = {};
  for (const parte of String(cabecalho ?? '').split(';')) {
    const corte = parte.indexOf('=');
    if (corte === -1) continue;
    const nome = parte.slice(0, corte).trim();
    if (!nome) continue;
    try {
      saida[nome] = decodeURIComponent(parte.slice(corte + 1).trim());
    } catch {
      saida[nome] = parte.slice(corte + 1).trim();
    }
  }
  return saida;
}

/** O valor do cookie: validade e assinatura dela, separadas por ponto. */
export function emitir(senha, agora = Date.now()) {
  const ate = agora + DURACAO;
  return `${ate}.${assinar(senha, ate)}`;
}

/** Verdadeiro so se a assinatura confere E a validade ainda nao passou. */
export function valido(valor, senha, agora = Date.now()) {
  const corte = String(valor ?? '').indexOf('.');
  if (corte === -1) return false;
  const ate = String(valor).slice(0, corte);
  const marca = String(valor).slice(corte + 1);
  if (!/^\d+$/.test(ate)) return false;
  if (!iguais(marca, assinar(senha, ate))) return false;
  return Number(ate) > agora;
}

/**
 * Monta o Set-Cookie. `seguro` vem da requisicao: em https o cookie so viaja
 * em https; em http local ele precisa ir sem essa marca, senao o navegador
 * descarta e ninguem consegue entrar durante o desenvolvimento.
 */
export function cookieDeEntrada(senha, { seguro }) {
  const partes = [
    `${NOME_COOKIE}=${emitir(senha)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DURACAO / 1000)}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export function cookieDeSaida({ seguro }) {
  const partes = [`${NOME_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}
