/**
 * Cofre: o banco de dados guardado fora do Render.
 *
 * O plano gratuito do Render nao tem disco: o sistema de arquivos volta ao
 * estado da build a cada publicacao e a cada reinicio. Os PDFs ja escapam
 * disso, porque com o R2 configurado eles nunca chegam a tocar o disco de la
 * (ver arquivos.js). O que sobrava exposto era o banco — empresas, contratos,
 * RTs, datas —, que e justamente o que nao se remonta de memoria.
 *
 * A ideia aqui e simples: depois de cada mudanca, uma copia do banco sobe para
 * o R2; ao subir de novo com o disco em branco, essa copia desce antes de o
 * banco abrir. Do lado de fora parece que o disco nunca sumiu.
 *
 * O que este arquivo NAO faz, de proposito:
 *
 * - Nao sobe a cada escrita. Espera a poeira baixar (GUARDA_ESPERA) e sobe uma
 *   vez, senao cadastrar um contrato com cinco RTs viraria seis envios.
 * - Nao restaura por cima de dado que ja existe. So desce a copia quando o
 *   banco local esta vazio de verdade. Restaurar sobre um banco com conteudo
 *   seria trocar o certo pelo antigo sem ninguem pedir.
 * - Nao deixa passar falha de leitura. Se o R2 esta ligado e a leitura da copia
 *   quebra, o arranque para. E melhor o sistema ficar fora do ar por minutos do
 *   que subir vazio e a primeira escrita apagar o cofre por cima.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import * as r2 from './r2.js';

export const CHAVE = 'cofre/banco.db';
export const CAMINHO = path.join(DATA_DIR, 'contratos.db');

/** Quanto tempo de silencio antes de subir. Curto: e so um arquivo pequeno. */
export const GUARDA_ESPERA = 2500;

let pendente = null;
let subindo = null;
let ultimoDiaGuardado = null;
let bancoPendente = null;
let opcoesPendentes = {};

/** A copia do dia, que fica guardada. O cofre vivo e sobrescrito; estas nao. */
function chaveDoDia(quando = new Date()) {
  return `cofre/historico/${quando.toISOString().slice(0, 10)}.db`;
}

/**
 * O banco esta vazio? Vazio significa recem-criado: nenhum contrato e nenhuma
 * empresa preenchida. Um banco assim nao tem nada a perder para a copia.
 */
export function bancoVazio(db) {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM contratos').get();
  if (total > 0) return false;
  const empresa = db.prepare("SELECT COUNT(*) AS total FROM empresa WHERE razao_social <> ''").get();
  return empresa.total === 0;
}

/**
 * Traz a copia do R2 se o disco veio em branco. Roda ANTES de o banco abrir —
 * por isso escreve o arquivo direto, em vez de mexer em tabela.
 *
 * @returns {Promise<'restaurado'|'disco-tem-dado'|'cofre-vazio'|'desligado'>}
 */
export async function restaurarSePreciso({ log = console.log } = {}) {
  if (!r2.configurado()) return 'desligado';

  // Banco no disco com tamanho de gente e sinal de que o Render nao apagou
  // nada desta vez (reinicio quente, ou disco pago). Nao se mexe.
  if (fs.existsSync(CAMINHO) && fs.statSync(CAMINHO).size > 0) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(CAMINHO, { readOnly: true });
    let vazio;
    try {
      vazio = bancoVazio(db);
    } catch {
      vazio = true;  // banco pela metade conta como vazio
    } finally {
      db.close();
    }
    if (!vazio) return 'disco-tem-dado';
  }

  const copia = await r2.ler(CHAVE);   // erro de rede sobe e derruba o arranque, de proposito
  if (!copia) {
    log('  Cofre no R2 ainda vazio — a primeira gravação cria a cópia.');
    return 'cofre-vazio';
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  // WAL e -shm da instalacao anterior nao valem para este arquivo novo
  for (const sufixo of ['-wal', '-shm']) fs.rmSync(CAMINHO + sufixo, { force: true });
  fs.writeFileSync(CAMINHO, copia);
  log(`  Cofre restaurado do R2: ${(copia.length / 1024).toFixed(0)} KB de banco.`);
  return 'restaurado';
}

/**
 * Sobe a copia agora. `VACUUM INTO` porque copiar o arquivo com escrita em
 * andamento pode render um banco pela metade; o VACUUM sai sempre inteiro.
 */
export async function guardarAgora(db, { log = console.error } = {}) {
  if (!r2.configurado()) return false;

  const temporario = path.join(DATA_DIR, `.cofre-${process.pid}.db`);
  fs.rmSync(temporario, { force: true });
  try {
    db.exec(`VACUUM INTO '${temporario.replaceAll("'", "''")}'`);
    const bytes = fs.readFileSync(temporario);
    await r2.gravar(CHAVE, bytes, 'application/vnd.sqlite3');

    // uma copia por dia fica para tras; sao alguns KB e um dia ruim se desfaz
    const doDia = chaveDoDia();
    if (ultimoDiaGuardado !== doDia) {
      await r2.gravar(doDia, bytes, 'application/vnd.sqlite3');
      ultimoDiaGuardado = doDia;
    }
    return true;
  } catch (erro) {
    // falhar aqui nao pode derrubar quem esta usando: a proxima mudanca tenta
    // de novo, e o log deixa o rastro de que o cofre ficou para tras
    log(`  [cofre] não consegui guardar a cópia no R2: ${erro.message}`);
    return false;
  } finally {
    fs.rmSync(temporario, { force: true });
  }
}

/** Marca que houve mudanca. Junta as mudancas proximas num envio so. */
export function agendarGuarda(db, opcoes = {}) {
  if (!r2.configurado()) return;
  bancoPendente = db;
  opcoesPendentes = opcoes;
  clearTimeout(pendente);
  pendente = setTimeout(despachar, GUARDA_ESPERA);
  // unref para um envio agendado nao segurar o processo de pe sozinho
  pendente.unref?.();
}

function despachar() {
  clearTimeout(pendente);
  pendente = null;
  const db = bancoPendente;
  bancoPendente = null;
  if (!db) return;
  subindo = guardarAgora(db, opcoesPendentes).finally(() => { subindo = null; });
}

/**
 * Manda agora o que estava agendado e espera terminar.
 *
 * Chamado no encerramento e nos testes. Nao basta cancelar o relogio: o que
 * estava para subir tem que subir, senao a ultima coisa que a pessoa fez antes
 * de fechar seria exatamente a que o cofre nao teria.
 */
export async function aguardarGuarda() {
  if (pendente) despachar();
  await subindo;
}
