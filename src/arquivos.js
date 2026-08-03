import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TMP_DIR, UPLOAD_DIR } from './paths.js';

const VALIDADE_TMP_MS = 6 * 60 * 60 * 1000;

function nomeSeguro(nome = 'arquivo.pdf') {
  return path.basename(nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-120) || 'arquivo.pdf';
}

/** Guarda o PDF numa area temporaria ate o usuario confirmar o cadastro. */
export function guardarTemporario(buffer, nomeOriginal, extras = {}) {
  const token = crypto.randomUUID();
  fs.writeFileSync(path.join(TMP_DIR, `${token}.pdf`), buffer);
  fs.writeFileSync(
    path.join(TMP_DIR, `${token}.json`),
    JSON.stringify({ nome: nomeSeguro(nomeOriginal), ...extras }),
  );
  return token;
}

export function lerTemporario(token) {
  if (!token || !/^[\w-]{36}$/.test(token)) return null;
  const pdf = path.join(TMP_DIR, `${token}.pdf`);
  const meta = path.join(TMP_DIR, `${token}.json`);
  if (!fs.existsSync(pdf)) return null;
  let dados = { nome: 'arquivo.pdf' };
  if (fs.existsSync(meta)) {
    try {
      dados = { ...dados, ...JSON.parse(fs.readFileSync(meta, 'utf8')) };
    } catch { /* metadados corrompidos: segue com o padrao */ }
  }
  return { caminho: pdf, ...dados };
}

/** Move o arquivo temporario para o acervo definitivo e devolve o nome gravado. */
export function efetivar(token, prefixo) {
  const tmp = lerTemporario(token);
  if (!tmp) return null;
  const destino = `${prefixo}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  fs.copyFileSync(tmp.caminho, path.join(UPLOAD_DIR, destino));
  descartarTemporario(token);
  return { arquivo: destino, arquivo_nome: tmp.nome };
}

export function descartarTemporario(token) {
  for (const ext of ['pdf', 'json']) {
    const alvo = path.join(TMP_DIR, `${token}.${ext}`);
    if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
  }
}

/** Grava bytes gerados pelo proprio sistema (atestado, requerimento). */
export function gravarGerado(bytes, prefixo) {
  const arquivo = `${prefixo}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, arquivo), Buffer.from(bytes));
  return arquivo;
}

export function caminhoDe(arquivo) {
  if (!arquivo) return null;
  const alvo = path.join(UPLOAD_DIR, path.basename(arquivo));
  return fs.existsSync(alvo) ? alvo : null;
}

export function remover(arquivo) {
  const alvo = caminhoDe(arquivo);
  if (alvo) fs.unlinkSync(alvo);
}

/** Limpa rascunhos abandonados (uploads que o usuario nunca confirmou). */
export function limparTemporarios() {
  const limite = Date.now() - VALIDADE_TMP_MS;
  for (const nome of fs.readdirSync(TMP_DIR)) {
    const alvo = path.join(TMP_DIR, nome);
    try {
      if (fs.statSync(alvo).mtimeMs < limite) fs.unlinkSync(alvo);
    } catch { /* arquivo ja removido */ }
  }
}
