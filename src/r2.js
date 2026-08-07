/**
 * Cliente minimo do Cloudflare R2 pela API compativel com S3.
 *
 * POR QUE ESCRITO A MAO: o SDK oficial da AWS traz mais de cem pacotes para
 * fazer o que aqui sao quatro operacoes — gravar, ler, apagar e conferir se
 * existe. Este sistema tem quatro dependencias no total, e cada uma delas e
 * uma superficie a mais para auditar num sistema que guarda contrato de
 * terceiro. A assinatura SigV4 e um algoritmo publico e fechado; o Node ja tem
 * HMAC-SHA256 e SHA-256, que e tudo o que ela pede.
 *
 * Configuracao por variaveis de ambiente. Faltando qualquer uma, o sistema
 * continua gravando em disco — nada aqui e obrigatorio para rodar.
 *   R2_CONTA          id da conta na Cloudflare
 *   R2_BALDE          nome do bucket
 *   R2_CHAVE_ID       Access Key ID do token
 *   R2_CHAVE_SECRETA  Secret Access Key do token
 */
import crypto from 'node:crypto';

const REGIAO = 'auto';        // o R2 nao tem regiao; "auto" e o valor que ele espera
const SERVICO = 's3';

export const VARIAVEIS = ['R2_CONTA', 'R2_BALDE', 'R2_CHAVE_ID', 'R2_CHAVE_SECRETA'];

/**
 * O valor da variavel, sem espaco nas pontas.
 *
 * Colar uma chave num painel de hospedagem costuma trazer um espaco ou uma
 * quebra de linha junto. Um espaco sobrando na assinatura SigV4 nao da erro
 * de configuracao: da erro de credencial invalida, la na frente, quando ja
 * ninguem lembra de onde veio.
 */
function variavel(nome) {
  return (process.env[nome] ?? '').trim();
}

/** Quais das quatro faltam. Nomes, nunca valores — isto vai para o log. */
export function faltando() {
  return VARIAVEIS.filter((nome) => !variavel(nome));
}

export function configurado() {
  return faltando().length === 0;
}

function ajustes() {
  return {
    conta: variavel('R2_CONTA'),
    balde: variavel('R2_BALDE'),
    chaveId: variavel('R2_CHAVE_ID'),
    segredo: variavel('R2_CHAVE_SECRETA'),
  };
}

const sha256 = (dado) => crypto.createHash('sha256').update(dado).digest('hex');
const hmac = (chave, dado) => crypto.createHmac('sha256', chave).update(dado).digest();

/**
 * Cada segmento do caminho e codificado, mas a barra que separa os segmentos
 * nao — e o que a especificacao chama de caminho canonico.
 */
function caminhoCanonico(chave) {
  return `/${chave.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Assina a requisicao pelo processo SigV4 e devolve os cabecalhos prontos.
 * A ordem dos cabecalhos assinados importa: precisa ser alfabetica, e a mesma
 * lista tem que aparecer em signedHeaders.
 */
function assinar({ metodo, chave, corpo, tipo, agora }) {
  const { conta, balde, chaveId, segredo } = ajustes();
  const anfitriao = `${conta}.r2.cloudflarestorage.com`;
  const carimbo = agora.toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20260806T231500Z
  const dia = carimbo.slice(0, 8);
  const hashCorpo = sha256(corpo ?? '');

  const cabecalhos = {
    host: anfitriao,
    'x-amz-content-sha256': hashCorpo,
    'x-amz-date': carimbo,
  };
  if (tipo) cabecalhos['content-type'] = tipo;

  const nomes = Object.keys(cabecalhos).sort();
  const canonicos = nomes.map((n) => `${n}:${String(cabecalhos[n]).trim()}\n`).join('');
  const assinados = nomes.join(';');

  const requisicaoCanonica = [
    metodo,
    caminhoCanonico(`${balde}/${chave}`),
    '',                        // sem query
    canonicos,
    assinados,
    hashCorpo,
  ].join('\n');

  const escopo = `${dia}/${REGIAO}/${SERVICO}/aws4_request`;
  const aAssinar = ['AWS4-HMAC-SHA256', carimbo, escopo, sha256(requisicaoCanonica)].join('\n');

  let chaveDerivada = hmac(`AWS4${segredo}`, dia);
  for (const parte of [REGIAO, SERVICO, 'aws4_request']) chaveDerivada = hmac(chaveDerivada, parte);
  const assinatura = crypto.createHmac('sha256', chaveDerivada).update(aAssinar).digest('hex');

  return {
    url: `https://${anfitriao}${caminhoCanonico(`${balde}/${chave}`)}`,
    cabecalhos: {
      ...cabecalhos,
      Authorization: `AWS4-HMAC-SHA256 Credential=${chaveId}/${escopo}, `
        + `SignedHeaders=${assinados}, Signature=${assinatura}`,
    },
  };
}

async function pedir(metodo, chave, { corpo = null, tipo = null } = {}) {
  const { url, cabecalhos } = assinar({ metodo, chave, corpo, tipo, agora: new Date() });
  const resposta = await fetch(url, { method: metodo, headers: cabecalhos, body: corpo });
  return resposta;
}

/** Devolve a mensagem de erro do R2, que vem em XML. */
async function explicar(resposta) {
  const texto = await resposta.text().catch(() => '');
  const codigo = /<Code>([^<]+)<\/Code>/.exec(texto)?.[1];
  const detalhe = /<Message>([^<]+)<\/Message>/.exec(texto)?.[1];
  return `R2 respondeu ${resposta.status}${codigo ? ` (${codigo})` : ''}`
    + `${detalhe ? `: ${detalhe}` : ''}`;
}

export async function gravar(chave, buffer, tipo = 'application/pdf') {
  const r = await pedir('PUT', chave, { corpo: buffer, tipo });
  if (!r.ok) throw new Error(await explicar(r));
}

/** @returns {Promise<Buffer|null>} null quando a chave nao existe */
export async function ler(chave) {
  const r = await pedir('GET', chave);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await explicar(r));
  return Buffer.from(await r.arrayBuffer());
}

export async function existe(chave) {
  const r = await pedir('HEAD', chave);
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(await explicar(r));
  return true;
}

export async function apagar(chave) {
  const r = await pedir('DELETE', chave);
  // 204 quando apagou, 404 quando ja nao estava la — os dois servem
  if (!r.ok && r.status !== 404) throw new Error(await explicar(r));
}
