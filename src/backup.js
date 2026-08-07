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
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';

import { db } from './db.js';
import { guardarNoAcervo, lerArquivo, ondeGuarda } from './arquivos.js';
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
/**
 * Nomes dos PDFs que o sistema realmente usa, tirados do banco.
 *
 * Antes isso era um `readdir` da pasta de uploads. Com o acervo no R2 nao ha
 * pasta para varrer — e, olhando bem, o banco e a fonte melhor de qualquer
 * forma: ele lista o que pertence a algum contrato, sem arrastar arquivo
 * orfao nem arrumacao de repositorio junto.
 */
function nomesDosArquivos() {
  const nomes = new Set();
  for (const tabela of ['contratos', 'aditivos', 'rts', 'documentos']) {
    for (const linha of db.prepare(`SELECT arquivo FROM ${tabela} WHERE arquivo IS NOT NULL AND arquivo <> ''`).all()) {
      nomes.add(path.basename(linha.arquivo));
    }
  }
  return [...nomes].sort();
}

export async function gerarBackup() {
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
  for (const nome of nomesDosArquivos()) {
    const conteudo = await lerArquivo(nome);
    // arquivo citado no banco mas ausente do acervo: o backup segue sem ele em
    // vez de falhar inteiro — uma copia parcial vale mais que nenhuma
    if (!conteudo) continue;
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

/* ----------------------------------------------------------- restauracao */

/**
 * Le um .zip pelo diretorio central, que e por onde todo descompactador
 * comeca. Ler pelo diretorio, e nao varrendo o arquivo do inicio, e o que
 * garante pegar a versao final de cada entrada.
 *
 * @returns {Map<string, Buffer>} caminho dentro do zip -> conteudo
 */
export function lerZip(buffer) {
  const marca = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const fim = buffer.lastIndexOf(marca);
  if (fim === -1) throw new Error('O arquivo enviado não é um .zip válido.');

  const quantos = buffer.readUInt16LE(fim + 10);
  let ponteiro = buffer.readUInt32LE(fim + 16);
  const arquivos = new Map();

  for (let i = 0; i < quantos; i += 1) {
    if (buffer.readUInt32LE(ponteiro) !== 0x02014b50) {
      throw new Error('O .zip está corrompido: o índice interno não bate.');
    }
    const metodo = buffer.readUInt16LE(ponteiro + 10);
    const crc = buffer.readUInt32LE(ponteiro + 16);
    const comprimido = buffer.readUInt32LE(ponteiro + 20);
    const tamNome = buffer.readUInt16LE(ponteiro + 28);
    const tamExtra = buffer.readUInt16LE(ponteiro + 30);
    const tamComentario = buffer.readUInt16LE(ponteiro + 32);
    const inicio = buffer.readUInt32LE(ponteiro + 42);
    const nome = buffer.toString('utf8', ponteiro + 46, ponteiro + 46 + tamNome);
    ponteiro += 46 + tamNome + tamExtra + tamComentario;

    if (nome.endsWith('/')) continue;                       // pasta
    if (metodo !== 0 && metodo !== 8) {
      throw new Error(`O arquivo "${nome}" usa uma compressão que não sabemos ler.`);
    }
    const dados = inicio + 30 + buffer.readUInt16LE(inicio + 26) + buffer.readUInt16LE(inicio + 28);
    const bruto = buffer.subarray(dados, dados + comprimido);
    const conteudo = metodo === 8 ? zlib.inflateRawSync(bruto) : bruto;

    // o CRC e a unica defesa contra um arquivo truncado no meio do caminho
    if (zlib.crc32(conteudo) !== crc) {
      throw new Error(`O arquivo "${nome}" veio corrompido dentro do .zip.`);
    }
    arquivos.set(nome, conteudo);
  }
  return arquivos;
}

// Ordem importa: pai antes de filho, para as chaves estrangeiras fecharem.
const TABELAS = ['empresa', 'profissionais', 'contratos', 'aditivos', 'rts', 'documentos', 'eventos'];

/** Nomes das colunas de uma tabela, no banco indicado. */
function colunas(tabela, prefixo = '') {
  return db.prepare(`PRAGMA ${prefixo}table_info(${tabela})`).all().map((c) => c.name);
}

/**
 * So aceita um nome de arquivo simples dentro de uploads/.
 * Sem isso, um .zip preparado de ma fe com "../../server.js" dentro
 * sobrescreveria o proprio sistema ao ser restaurado.
 */
function nomeSeguro(caminho) {
  const nome = caminho.slice('uploads/'.length);
  if (!nome || nome !== path.basename(nome)) return null;
  if (nome.startsWith('.') || /[\\/:*?"<>|]/.test(nome)) return null;
  return nome;
}

/**
 * Devolve os dados de um backup para dentro do sistema em funcionamento.
 *
 * Nao troca o arquivo do banco — isso exigiria derrubar o servico e daria
 * problema com o arquivo aberto. Em vez disso, anexa o banco do backup e
 * copia tabela por tabela dentro de uma unica transacao: ou tudo entra, ou
 * nada muda. Se algo falhar no meio, o sistema continua como estava.
 *
 * @param {Buffer} zip conteudo do arquivo enviado
 * @returns {{contratos: number, pdfs: number, descartados: number}}
 */
export async function restaurarBackup(zip) {
  const arquivos = lerZip(zip);
  const banco = arquivos.get('contratos.db');
  if (!banco) {
    throw new Error('Este .zip não tem o arquivo contratos.db. Envie a cópia de segurança gerada pelo próprio sistema.');
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const recebido = path.join(TMP_DIR, `restaurar-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(recebido, banco);

  try {
    // confere que e mesmo um banco deste sistema antes de encostar no atual
    const vindo = new DatabaseSync(recebido, { readOnly: true });
    try {
      const tem = new Set(
        vindo.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name),
      );
      const faltando = TABELAS.filter((t) => !tem.has(t));
      if (faltando.length) {
        throw new Error(`O banco enviado não parece ser deste sistema: falta ${faltando.join(', ')}.`);
      }
    } finally {
      vindo.close();
    }

    return await trocarDados(recebido, arquivos);
  } finally {
    fs.rmSync(recebido, { force: true });
  }
}

/** Troca o conteudo do banco atual pelo do backup, tudo ou nada. */
async function trocarDados(recebido, arquivos) {
  db.exec(`ATTACH DATABASE '${recebido.replaceAll("'", "''")}' AS copia`);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      // adia a checagem das chaves estrangeiras para o fim da transacao: no
      // meio da troca as tabelas ficam temporariamente inconsistentes entre si
      db.exec('PRAGMA defer_foreign_keys = ON');

      for (const tabela of [...TABELAS].reverse()) db.exec(`DELETE FROM ${tabela}`);

      for (const tabela of TABELAS) {
        // so as colunas que existem nos dois lados: assim um backup antigo,
        // feito antes de alguma coluna nova, ainda entra
        const comuns = colunas(tabela).filter((c) => colunas(tabela, 'copia.').includes(c));
        if (!comuns.length) continue;
        const lista = comuns.map((c) => `"${c}"`).join(', ');
        db.exec(`INSERT INTO ${tabela} (${lista}) SELECT ${lista} FROM copia.${tabela}`);
      }
      db.exec('COMMIT');
    } catch (erro) {
      db.exec('ROLLBACK');
      throw erro;
    }
  } finally {
    db.exec('DETACH DATABASE copia');
  }

  const problemas = db.prepare('PRAGMA foreign_key_check').all();
  if (problemas.length) {
    throw new Error('Os dados restaurados ficaram inconsistentes. O sistema foi mantido como estava.');
  }

  return { ...(await trocarArquivos(arquivos)), contratos: contarContratos() };
}

function contarContratos() {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM contratos').get().n);
}

/**
 * Repoe os PDFs. O que estava na pasta e nao esta no backup e removido: o
 * banco foi substituido, entao esses arquivos nao pertencem mais a contrato
 * nenhum e so ocupariam espaco sem que ninguem soubesse de onde vieram.
 */
async function trocarArquivos(arquivos) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const doBackup = new Set();
  let pdfs = 0;
  let descartados = 0;

  for (const [caminho, conteudo] of arquivos) {
    if (!caminho.startsWith('uploads/')) continue;
    const nome = nomeSeguro(caminho);
    if (!nome) {
      descartados += 1;
      continue;
    }
    await guardarNoAcervo(nome, conteudo);
    doBackup.add(nome);
    pdfs += 1;
  }

  // Sobra do acervo anterior: o banco foi substituido, entao esses arquivos
  // nao pertencem mais a contrato nenhum. So da para varrer quando o acervo e
  // o disco; no R2 listar exigiria outra operacao, e arquivo orfao la nao
  // atrapalha nem aparece — fica para a faxina, se um dia fizer falta.
  if (ondeGuarda() === 'disco') {
    for (const nome of fs.readdirSync(UPLOAD_DIR)) {
      if (doBackup.has(nome)) continue;
      const caminho = path.join(UPLOAD_DIR, nome);
      if (!fs.statSync(caminho).isFile()) continue;   // preserva _tmp
      fs.rmSync(caminho, { force: true });
    }
  }

  return { pdfs, descartados };
}
