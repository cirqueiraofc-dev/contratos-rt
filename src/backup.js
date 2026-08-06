/**
 * Backup dos dados em um unico arquivo .zip.
 *
 * POR QUE ISSO EXISTE: no plano gratuito do Render nao ha disco persistente.
 * O banco e os PDFs sao apagados a cada deploy e a cada reinicio do servico.
 * Enquanto a hospedagem nao mudar, baixar este arquivo e guardar fora do
 * Render e a unica coisa que impede perder trabalho.
 *
 * Nao usa biblioteca nenhuma. O ZIP e escrito na mao porque o Node ja traz as
 * duas pecas necessarias em node:zlib: deflate cru e CRC-32.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { db } from './db.js';
import { TMP_DIR, UPLOAD_DIR } from './paths.js';

// O ZIP classico guarda tamanho em 4 bytes. Passar disso exigiria ZIP64, que
// nao compensa aqui — 2 GB de PDF de contrato ja e um problema de outra ordem,
// e melhor avisar do que gerar um arquivo silenciosamente corrompido.
const LIMITE = 2 * 1024 * 1024 * 1024;

/** Data e hora no formato do MS-DOS, que e o que o ZIP guarda. */
function dosDataHora(quando) {
  const hora = (quando.getHours() << 11) | (quando.getMinutes() << 5) | (quando.getSeconds() >> 1);
  const data = ((quando.getFullYear() - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate();
  return { hora, data };
}

/** Monta o cabecalho local e os dados de um arquivo dentro do ZIP. */
function entrada(nome, conteudo, quando) {
  const nomeBytes = Buffer.from(nome, 'utf8');
  const tentativa = zlib.deflateRawSync(conteudo, { level: 6 });
  // PDF ja vem comprimido por dentro: comprimir de novo as vezes aumenta.
  // Quando nao ajuda, guarda como esta (metodo 0) em vez de inchar o arquivo.
  const comprime = tentativa.length < conteudo.length;
  const dados = comprime ? tentativa : conteudo;
  const metodo = comprime ? 8 : 0;
  const crc = zlib.crc32(conteudo);
  const { hora, data } = dosDataHora(quando);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);   // assinatura
  local.writeUInt16LE(20, 4);           // versao minima para abrir
  local.writeUInt16LE(0x0800, 6);       // bit 11: nome do arquivo em UTF-8
  local.writeUInt16LE(metodo, 8);
  local.writeUInt16LE(hora, 10);
  local.writeUInt16LE(data, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(dados.length, 18);
  local.writeUInt32LE(conteudo.length, 22);
  local.writeUInt16LE(nomeBytes.length, 26);
  local.writeUInt16LE(0, 28);           // sem campo extra

  return { nomeBytes, dados, metodo, crc, hora, data, tamanho: conteudo.length, local };
}

/**
 * Junta os arquivos num ZIP valido.
 * @param {{nome: string, conteudo: Buffer}[]} arquivos
 */
export function montarZip(arquivos, quando = new Date()) {
  const corpo = [];
  const diretorio = [];
  let deslocamento = 0;

  for (const { nome, conteudo } of arquivos) {
    const e = entrada(nome, conteudo, quando);
    corpo.push(e.local, e.nomeBytes, e.dados);

    // o diretorio central repete os dados de cada arquivo e diz onde ele
    // comeca; e por ele que o descompactador se orienta
    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(20, 4);           // versao de quem escreveu
    cab.writeUInt16LE(20, 6);           // versao minima para abrir
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(e.metodo, 10);
    cab.writeUInt16LE(e.hora, 12);
    cab.writeUInt16LE(e.data, 14);
    cab.writeUInt32LE(e.crc, 16);
    cab.writeUInt32LE(e.dados.length, 20);
    cab.writeUInt32LE(e.tamanho, 24);
    cab.writeUInt16LE(e.nomeBytes.length, 28);
    cab.writeUInt16LE(0, 30);           // extra
    cab.writeUInt16LE(0, 32);           // comentario
    cab.writeUInt16LE(0, 34);           // numero do disco
    cab.writeUInt16LE(0, 36);           // atributos internos
    cab.writeUInt32LE(0, 38);           // atributos externos
    cab.writeUInt32LE(deslocamento, 42);
    diretorio.push(cab, e.nomeBytes);

    deslocamento += e.local.length + e.nomeBytes.length + e.dados.length;
  }

  const dados = Buffer.concat(corpo);
  const central = Buffer.concat(diretorio);

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);                    // disco atual
  fim.writeUInt16LE(0, 6);                    // disco do diretorio
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(central.length, 12);
  fim.writeUInt32LE(dados.length, 16);        // onde o diretorio comeca
  fim.writeUInt16LE(0, 20);                   // sem comentario

  return Buffer.concat([dados, central, fim]);
}

function leiaMe(quando, quantosPdfs) {
  return [
    'BACKUP DO SISTEMA DE CONTRATOS E RT — ECOART SOLUCOES LTDA',
    '',
    `Gerado em ${quando.toLocaleString('pt-BR')}.`,
    '',
    'O QUE TEM AQUI DENTRO',
    '  contratos.db  banco de dados com contratos, ARTs, aditivos e historico',
    `  uploads/      ${quantosPdfs} arquivo(s) PDF: contratos, ARTs, aditivos e documentos gerados`,
    '',
    'PARA QUE SERVE',
    '  A hospedagem gratuita apaga os dados a cada atualizacao do sistema.',
    '  Este arquivo e a copia de seguranca. Guarde-o fora do Render.',
    '',
    'COMO RESTAURAR',
    '  Entre em Configuracoes e use "Restaurar backup", enviando este arquivo',
    '  .zip inteiro, sem descompactar.',
    '',
    'O banco abre em qualquer leitor de SQLite, caso um dia seja preciso',
    'consultar os dados sem o sistema.',
    '',
  ].join('\r\n');
}

/**
 * Gera o backup completo: banco + PDFs + um LEIA-ME.
 * @returns {{nome: string, zip: Buffer, arquivos: number, bytes: number}}
 */
export function gerarBackup() {
  const quando = new Date();
  const arquivos = [];

  // VACUUM INTO tira uma copia consistente do banco mesmo com escrita em
  // andamento e ja incorpora o WAL. Copiar o .db na mao pode pegar um estado
  // pela metade, com metade da transacao no arquivo e metade no WAL.
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const copia = path.join(TMP_DIR, `backup-${process.pid}-${Date.now()}.db`);
  fs.rmSync(copia, { force: true });
  db.exec(`VACUUM INTO '${copia.replaceAll("'", "''")}'`);
  try {
    arquivos.push({ nome: 'contratos.db', conteudo: fs.readFileSync(copia) });
  } finally {
    fs.rmSync(copia, { force: true });
  }

  let bytes = arquivos[0].conteudo.length;
  let pdfs = 0;
  for (const nome of fs.readdirSync(UPLOAD_DIR).sort()) {
    const caminho = path.join(UPLOAD_DIR, nome);
    // _tmp e pasta de trabalho: nao entra, e o statSync tambem filtra
    if (!fs.statSync(caminho).isFile()) continue;
    const conteudo = fs.readFileSync(caminho);
    bytes += conteudo.length;
    if (bytes > LIMITE) {
      throw new Error('O backup passou de 2 GB. Fale com quem cuida do sistema antes de continuar.');
    }
    arquivos.push({ nome: `uploads/${nome}`, conteudo });
    pdfs += 1;
  }

  // O ﻿ na frente e a marca de UTF-8. Sem ela o Bloco de Notas do
  // Windows chuta a codificacao e os acentos saem trocados.
  arquivos.push({ nome: 'LEIA-ME.txt', conteudo: Buffer.from(`﻿${leiaMe(quando, pdfs)}`, 'utf8') });

  const carimbo = quando.toISOString().slice(0, 16).replace('T', '-').replace(':', 'h');
  return {
    nome: `contratos-rt-backup-${carimbo}.zip`,
    zip: montarZip(arquivos, quando),
    arquivos: arquivos.length,
    bytes,
  };
}
