/**
 * Guarda dos PDFs do sistema.
 *
 * DOIS LUGARES, DE PROPOSITO:
 *
 * - A area TEMPORARIA e sempre disco local. Sao uploads que a pessoa ainda nao
 *   confirmou; perder um deles num reinicio custa reenviar o arquivo, e nada
 *   mais. Nao vale pagar ida e volta de rede por isso.
 *
 * - O ACERVO definitivo vai para o Cloudflare R2 quando ele estiver
 *   configurado, e para o disco quando nao estiver. Sao os arquivos que nao se
 *   refazem: contrato assinado, ART registrada, documento gerado. No plano
 *   gratuito do Render o disco e apagado a cada deploy, entao guardar isso
 *   fora da hospedagem e o que impede a perda.
 *
 * Quem chama nao precisa saber onde esta: as funcoes do acervo sao assincronas
 * nos dois casos.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { TMP_DIR, UPLOAD_DIR } from './paths.js';
import * as r2 from './r2.js';

const VALIDADE_TMP_MS = 6 * 60 * 60 * 1000;

/** Onde o acervo esta guardado agora — util para diagnostico e para a tela. */
export function ondeGuarda() {
  return r2.configurado() ? 'r2' : 'disco';
}

function nomeSeguro(nome = 'arquivo.pdf') {
  return path.basename(nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-120) || 'arquivo.pdf';
}

/* ------------------------------------------------------------ temporarios */

/** Guarda o PDF numa area temporaria ate a pessoa confirmar o cadastro. */
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

export function descartarTemporario(token) {
  for (const ext of ['pdf', 'json']) {
    const alvo = path.join(TMP_DIR, `${token}.${ext}`);
    if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
  }
}

/** Limpa rascunhos abandonados (uploads que ninguem confirmou). */
export function limparTemporarios() {
  const limite = Date.now() - VALIDADE_TMP_MS;
  for (const nome of fs.readdirSync(TMP_DIR)) {
    const alvo = path.join(TMP_DIR, nome);
    try {
      if (fs.statSync(alvo).mtimeMs < limite) fs.unlinkSync(alvo);
    } catch { /* arquivo ja removido */ }
  }
}

/* ----------------------------------------------------------------- acervo */

const chaveR2 = (arquivo) => `pdfs/${path.basename(arquivo)}`;

/** Grava no acervo e devolve o nome pelo qual o arquivo sera pedido depois. */
export async function guardarNoAcervo(nome, buffer) {
  if (r2.configurado()) await r2.gravar(chaveR2(nome), buffer);
  else fs.writeFileSync(path.join(UPLOAD_DIR, nome), buffer);
  return nome;
}

/** @returns {Promise<Buffer|null>} null quando o arquivo nao existe mais */
export async function lerArquivo(arquivo) {
  if (!arquivo) return null;
  if (r2.configurado()) return r2.ler(chaveR2(arquivo));
  const alvo = path.join(UPLOAD_DIR, path.basename(arquivo));
  return fs.existsSync(alvo) ? fs.readFileSync(alvo) : null;
}

export async function remover(arquivo) {
  if (!arquivo) return;
  if (r2.configurado()) {
    await r2.apagar(chaveR2(arquivo));
    return;
  }
  const alvo = path.join(UPLOAD_DIR, path.basename(arquivo));
  if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
}

/** Move o arquivo temporario para o acervo e devolve o nome gravado. */
export async function efetivar(token, prefixo) {
  const tmp = lerTemporario(token);
  if (!tmp) return null;
  const destino = `${prefixo}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  await guardarNoAcervo(destino, fs.readFileSync(tmp.caminho));
  descartarTemporario(token);
  return { arquivo: destino, arquivo_nome: tmp.nome };
}

/** Grava bytes gerados pelo proprio sistema (atestado, requerimento). */
export async function gravarGerado(bytes, prefixo) {
  const arquivo = `${prefixo}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  await guardarNoAcervo(arquivo, Buffer.from(bytes));
  return arquivo;
}
