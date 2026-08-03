import express from 'express';
import multer from 'multer';
import fs from 'node:fs';

import { agora, all, get, registrarEvento, run } from '../db.js';
import { DISCIPLINAS, IDS_DISCIPLINAS } from '../disciplinas.js';
import { analisarContrato } from '../extract/contrato.js';
import { analisarArt } from '../extract/art.js';
import { extrairTexto } from '../extract/pdfTexto.js';
import { gerarAtestado } from '../docs/atestado.js';
import { gerarRequerimentoCat } from '../docs/requerimentoCat.js';
import {
  caminhoDe, descartarTemporario, efetivar, gravarGerado, guardarTemporario, lerTemporario, remover,
} from '../arquivos.js';
import {
  STATUS_CONTRATO, STATUS_RT, lerEmpresa, listarContratos, montarContrato, montarPainel,
} from '../servico.js';
import { hojeISO, somarMeses } from '../texto.js';

export const api = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ehPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    cb(ehPdf ? null : new HttpError(400, 'Envie um arquivo PDF.'), ehPdf);
  },
});

class HttpError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const rota = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function exigir(condicao, mensagem, status = 400) {
  if (!condicao) throw new HttpError(status, mensagem);
}

function textoOuVazio(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function dataOuNulo(valor) {
  const texto = textoOuVazio(valor);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

function enviarPdf(res, arquivo, nomeExibido, inline = true) {
  const caminho = caminhoDe(arquivo);
  exigir(caminho, 'Arquivo não encontrado.', 404);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${(nomeExibido || 'documento.pdf').replace(/"/g, '')}"`,
  );
  fs.createReadStream(caminho).pipe(res);
}

/* ---------------------------------------------------------------- painel */

api.get('/painel', rota((_req, res) => {
  res.json(montarPainel());
}));

api.get('/disciplinas', rota((_req, res) => {
  res.json(Object.values(DISCIPLINAS).map(({ id, nome, titulo, cor }) => ({ id, nome, titulo, cor })));
}));

/* ------------------------------------------------------------- cadastros */

api.get('/empresa', rota((_req, res) => {
  res.json(lerEmpresa());
}));

api.put('/empresa', rota((req, res) => {
  const c = req.body ?? {};
  run(
    `UPDATE empresa SET razao_social = ?, cnpj = ?, crea_empresa = ?, endereco = ?, cidade = ?,
            uf = ?, telefone = ?, email = ?, dias_alerta_rt = ?, dias_alerta_contrato = ?
      WHERE id = 1`,
    textoOuVazio(c.razao_social), textoOuVazio(c.cnpj), textoOuVazio(c.crea_empresa),
    textoOuVazio(c.endereco), textoOuVazio(c.cidade), textoOuVazio(c.uf).toUpperCase().slice(0, 2),
    textoOuVazio(c.telefone), textoOuVazio(c.email),
    Math.max(1, numeroOuNulo(c.dias_alerta_rt) ?? 60),
    Math.max(1, numeroOuNulo(c.dias_alerta_contrato) ?? 90),
  );
  res.json(lerEmpresa());
}));

api.get('/profissionais', rota((_req, res) => {
  res.json(all('SELECT * FROM profissionais ORDER BY nome').map((p) => ({
    ...p,
    disciplinas: p.disciplinas ? p.disciplinas.split(',') : [],
  })));
}));

api.post('/profissionais', rota((req, res) => {
  const p = req.body ?? {};
  exigir(textoOuVazio(p.nome), 'Informe o nome do profissional.');
  const disciplinas = (Array.isArray(p.disciplinas) ? p.disciplinas : [])
    .filter((d) => IDS_DISCIPLINAS.includes(d));
  const { id } = run(
    `INSERT INTO profissionais (nome, titulo, crea, rnp, disciplinas, ativo) VALUES (?, ?, ?, ?, ?, 1)`,
    textoOuVazio(p.nome), textoOuVazio(p.titulo), textoOuVazio(p.crea), textoOuVazio(p.rnp),
    disciplinas.join(','),
  );
  res.status(201).json(get('SELECT * FROM profissionais WHERE id = ?', id));
}));

api.delete('/profissionais/:id', rota((req, res) => {
  run('DELETE FROM profissionais WHERE id = ?', Number(req.params.id));
  res.status(204).end();
}));

/* ------------------------------------------------- contratos: leitura PDF */

api.post('/contratos/analisar', upload.single('arquivo'), rota(async (req, res) => {
  exigir(req.file, 'Selecione o PDF do contrato.');
  const { texto, paginas, temTexto } = await extrairTexto(req.file.buffer);
  exigir(
    temTexto,
    'Não foi possível ler texto deste PDF. Provavelmente é um documento digitalizado (imagem). '
    + 'Passe um OCR no arquivo ou cadastre o contrato manualmente.',
  );

  const extraidos = analisarContrato(texto);
  const token = guardarTemporario(req.file.buffer, req.file.originalname, { texto });

  res.json({ token, paginas, extraidos });
}));

api.post('/contratos', rota((req, res) => {
  const c = req.body ?? {};
  exigir(textoOuVazio(c.numero), 'Informe o número do contrato.');

  const disciplinas = (Array.isArray(c.disciplinas) ? c.disciplinas : [])
    .filter((d) => IDS_DISCIPLINAS.includes(d));

  let arquivo = null;
  let arquivoNome = null;
  let texto = null;
  if (c.token) {
    const tmp = lerTemporario(c.token);
    exigir(tmp, 'O arquivo enviado expirou. Faça o upload novamente.');
    texto = tmp.texto ?? null;
    const efetivado = efetivar(c.token, 'contrato');
    arquivo = efetivado?.arquivo ?? null;
    arquivoNome = efetivado?.arquivo_nome ?? null;
  }

  const agoraIso = agora();
  const { id } = run(
    `INSERT INTO contratos (numero, contratante, contratante_cnpj, objeto, valor, data_assinatura,
                            data_vencimento, vigencia_meses, status, observacoes, arquivo, arquivo_nome,
                            texto, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?, ?, ?, ?, ?, ?)`,
    textoOuVazio(c.numero), textoOuVazio(c.contratante), textoOuVazio(c.contratante_cnpj),
    textoOuVazio(c.objeto), numeroOuNulo(c.valor), dataOuNulo(c.data_assinatura),
    dataOuNulo(c.data_vencimento), numeroOuNulo(c.vigencia_meses), textoOuVazio(c.observacoes),
    arquivo, arquivoNome, texto, agoraIso, agoraIso,
  );

  for (const disciplina of disciplinas) {
    run(
      `INSERT INTO rts (contrato_id, disciplina, status, motivo, origem, criado_em, atualizado_em)
       VALUES (?, ?, 'pendente', ?, ?, ?, ?)`,
      id, disciplina, textoOuVazio(c.motivos?.[disciplina]),
      c.token ? 'automatica' : 'manual', agoraIso, agoraIso,
    );
  }

  registrarEvento(id, 'contrato_cadastrado',
    `Contrato ${textoOuVazio(c.numero)} cadastrado com ${disciplinas.length} RT(s) pendente(s).`);

  res.status(201).json(montarContrato(id));
}));

api.post('/contratos/descartar', rota((req, res) => {
  if (req.body?.token) descartarTemporario(req.body.token);
  res.status(204).end();
}));

/* ----------------------------------------------------- contratos: gestao */

api.get('/contratos', rota((req, res) => {
  res.json(listarContratos({
    status: textoOuVazio(req.query.status),
    busca: textoOuVazio(req.query.q),
  }));
}));

api.get('/contratos/:id', rota((req, res) => {
  const contrato = montarContrato(Number(req.params.id));
  exigir(contrato, 'Contrato não encontrado.', 404);
  res.json(contrato);
}));

api.put('/contratos/:id', rota((req, res) => {
  const id = Number(req.params.id);
  const atual = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(atual, 'Contrato não encontrado.', 404);
  const c = req.body ?? {};
  exigir(textoOuVazio(c.numero ?? atual.numero), 'Informe o número do contrato.');

  run(
    `UPDATE contratos SET numero = ?, contratante = ?, contratante_cnpj = ?, objeto = ?, valor = ?,
            data_assinatura = ?, data_vencimento = ?, vigencia_meses = ?, observacoes = ?, atualizado_em = ?
      WHERE id = ?`,
    textoOuVazio(c.numero ?? atual.numero), textoOuVazio(c.contratante), textoOuVazio(c.contratante_cnpj),
    textoOuVazio(c.objeto), numeroOuNulo(c.valor), dataOuNulo(c.data_assinatura),
    dataOuNulo(c.data_vencimento), numeroOuNulo(c.vigencia_meses), textoOuVazio(c.observacoes),
    agora(), id,
  );
  res.json(montarContrato(id));
}));

api.delete('/contratos/:id', rota((req, res) => {
  const id = Number(req.params.id);
  const contrato = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(contrato, 'Contrato não encontrado.', 404);
  for (const arquivo of [
    contrato.arquivo,
    ...all('SELECT arquivo FROM rts WHERE contrato_id = ?', id).map((r) => r.arquivo),
    ...all('SELECT arquivo FROM documentos WHERE contrato_id = ?', id).map((d) => d.arquivo),
  ]) {
    if (arquivo) remover(arquivo);
  }
  run('DELETE FROM contratos WHERE id = ?', id);
  res.status(204).end();
}));

api.post('/contratos/:id/status', rota((req, res) => {
  const id = Number(req.params.id);
  const contrato = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(contrato, 'Contrato não encontrado.', 404);
  const status = textoOuVazio(req.body?.status);
  exigir(STATUS_CONTRATO.includes(status), 'Situação inválida.');

  const dataConclusao = status === 'concluido'
    ? (dataOuNulo(req.body?.data_conclusao) ?? hojeISO())
    : null;

  run(
    'UPDATE contratos SET status = ?, data_conclusao = ?, atualizado_em = ? WHERE id = ?',
    status, dataConclusao, agora(), id,
  );

  if (status === 'concluido') {
    // ARTs emitidas passam a "baixada": o contrato acabou, cabe dar baixa no conselho
    run(
      `UPDATE rts SET status = 'baixada', atualizado_em = ? WHERE contrato_id = ? AND status = 'emitida'`,
      agora(), id,
    );
    registrarEvento(id, 'contrato_concluido', `Contrato concluído em ${dataConclusao}.`);
  } else {
    registrarEvento(id, 'contrato_status', `Situação alterada para ${status}.`);
  }

  res.json(montarContrato(id));
}));

api.get('/contratos/:id/arquivo', rota((req, res) => {
  const contrato = get('SELECT arquivo, arquivo_nome, numero FROM contratos WHERE id = ?', Number(req.params.id));
  exigir(contrato?.arquivo, 'Este contrato não tem PDF anexado.', 404);
  enviarPdf(res, contrato.arquivo, contrato.arquivo_nome || `contrato-${contrato.numero}.pdf`);
}));

api.get('/contratos/:id/eventos', rota((req, res) => {
  res.json(all('SELECT * FROM eventos WHERE contrato_id = ? ORDER BY criado_em DESC LIMIT 100', Number(req.params.id)));
}));

/* -------------------------------------------------------------------- RTs */

api.post('/contratos/:id/rts', rota((req, res) => {
  const contratoId = Number(req.params.id);
  exigir(get('SELECT id FROM contratos WHERE id = ?', contratoId), 'Contrato não encontrado.', 404);
  const disciplina = textoOuVazio(req.body?.disciplina);
  exigir(IDS_DISCIPLINAS.includes(disciplina), 'Modalidade de RT inválida.');
  exigir(
    !get('SELECT id FROM rts WHERE contrato_id = ? AND disciplina = ?', contratoId, disciplina),
    'Este contrato já tem uma RT desta modalidade.',
  );
  const agoraIso = agora();
  run(
    `INSERT INTO rts (contrato_id, disciplina, status, origem, criado_em, atualizado_em)
     VALUES (?, ?, 'pendente', 'manual', ?, ?)`,
    contratoId, disciplina, agoraIso, agoraIso,
  );
  registrarEvento(contratoId, 'rt_adicionada', `RT de ${DISCIPLINAS[disciplina].nome} adicionada manualmente.`);
  res.status(201).json(montarContrato(contratoId));
}));

api.put('/rts/:id', rota((req, res) => {
  const id = Number(req.params.id);
  const rt = get('SELECT * FROM rts WHERE id = ?', id);
  exigir(rt, 'RT não encontrada.', 404);
  const c = req.body ?? {};
  const status = textoOuVazio(c.status) || rt.status;
  exigir(STATUS_RT.includes(status), 'Situação de RT inválida.');

  run(
    `UPDATE rts SET status = ?, numero_art = ?, profissional = ?, titulo = ?, crea = ?, rnp = ?,
            data_registro = ?, data_inicio = ?, data_validade = ?, valor = ?, observacoes = ?, atualizado_em = ?
      WHERE id = ?`,
    status, textoOuVazio(c.numero_art) || null, textoOuVazio(c.profissional) || null,
    textoOuVazio(c.titulo) || null, textoOuVazio(c.crea) || null, textoOuVazio(c.rnp) || null,
    dataOuNulo(c.data_registro), dataOuNulo(c.data_inicio), dataOuNulo(c.data_validade),
    numeroOuNulo(c.valor), textoOuVazio(c.observacoes), agora(), id,
  );
  res.json(montarContrato(rt.contrato_id));
}));

api.delete('/rts/:id', rota((req, res) => {
  const rt = get('SELECT * FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt, 'RT não encontrada.', 404);
  if (rt.arquivo) remover(rt.arquivo);
  run('DELETE FROM rts WHERE id = ?', rt.id);
  res.json(montarContrato(rt.contrato_id));
}));

api.post('/rts/:id/analisar-art', upload.single('arquivo'), rota(async (req, res) => {
  const rt = get('SELECT * FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt, 'RT não encontrada.', 404);
  exigir(req.file, 'Selecione o PDF da ART.');

  const { texto, temTexto } = await extrairTexto(req.file.buffer);
  const extraidos = temTexto
    ? analisarArt(texto)
    : { avisos: ['Não foi possível ler texto do PDF (documento digitalizado). Preencha os campos manualmente.'] };

  if (temTexto && extraidos.disciplina_provavel && extraidos.disciplina_provavel !== rt.disciplina) {
    extraidos.avisos.push(
      `O conteúdo da ART parece ser de ${DISCIPLINAS[extraidos.disciplina_provavel].nome}, `
      + `mas ela está sendo anexada à RT de ${DISCIPLINAS[rt.disciplina].nome}. Confirme antes de salvar.`,
    );
  }

  const token = guardarTemporario(req.file.buffer, req.file.originalname);
  res.json({ token, extraidos });
}));

api.post('/rts/:id/art', rota((req, res) => {
  const rt = get('SELECT * FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt, 'RT não encontrada.', 404);
  const c = req.body ?? {};
  exigir(textoOuVazio(c.numero_art), 'Informe o número da ART.');

  let arquivo = rt.arquivo;
  let arquivoNome = rt.arquivo_nome;
  if (c.token) {
    const efetivado = efetivar(c.token, `art-${rt.disciplina}`);
    exigir(efetivado, 'O arquivo enviado expirou. Faça o upload novamente.');
    if (rt.arquivo) remover(rt.arquivo);
    arquivo = efetivado.arquivo;
    arquivoNome = efetivado.arquivo_nome;
  }

  run(
    `UPDATE rts SET status = 'emitida', numero_art = ?, profissional = ?, titulo = ?, crea = ?, rnp = ?,
            data_registro = ?, data_inicio = ?, data_validade = ?, valor = ?, observacoes = ?,
            arquivo = ?, arquivo_nome = ?, atualizado_em = ?
      WHERE id = ?`,
    textoOuVazio(c.numero_art), textoOuVazio(c.profissional) || null, textoOuVazio(c.titulo) || null,
    textoOuVazio(c.crea) || null, textoOuVazio(c.rnp) || null, dataOuNulo(c.data_registro),
    dataOuNulo(c.data_inicio), dataOuNulo(c.data_validade), numeroOuNulo(c.valor),
    textoOuVazio(c.observacoes), arquivo, arquivoNome, agora(), rt.id,
  );

  registrarEvento(rt.contrato_id, 'art_registrada',
    `ART ${textoOuVazio(c.numero_art)} registrada para a RT de ${DISCIPLINAS[rt.disciplina].nome}.`);

  res.json(montarContrato(rt.contrato_id));
}));

api.get('/rts/:id/arquivo', rota((req, res) => {
  const rt = get('SELECT arquivo, arquivo_nome, numero_art FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt?.arquivo, 'Esta RT não tem PDF de ART anexado.', 404);
  enviarPdf(res, rt.arquivo, rt.arquivo_nome || `art-${rt.numero_art}.pdf`);
}));

/* -------------------------------------------------------------- CAT / docs */

api.post('/contratos/:id/cat', rota(async (req, res) => {
  const id = Number(req.params.id);
  const contrato = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(contrato, 'Contrato não encontrado.', 404);
  exigir(contrato.status === 'concluido', 'Conclua o contrato antes de gerar a CAT.');

  const empresa = lerEmpresa();
  const rts = all('SELECT * FROM rts WHERE contrato_id = ? ORDER BY disciplina', id);
  const comArt = rts.filter((rt) => rt.numero_art && rt.status !== 'dispensada');
  exigir(comArt.length, 'Nenhuma ART registrada neste contrato — registre as ARTs antes de gerar a CAT.');

  // regerar substitui os documentos anteriores para nao acumular versoes soltas
  for (const antigo of all(`SELECT * FROM documentos WHERE contrato_id = ? AND tipo IN ('atestado', 'requerimento_cat')`, id)) {
    remover(antigo.arquivo);
    run('DELETE FROM documentos WHERE id = ?', antigo.id);
  }

  const criadoEm = agora();
  const gerados = [];

  const atestado = await gerarAtestado({ contrato, rts: comArt.map((rt) => ({ ...rt, status: 'emitida' })), empresa });
  const arquivoAtestado = gravarGerado(atestado, `atestado-${contrato.numero.replace(/\W+/g, '-')}`);
  const nomeAtestado = `Atestado de Capacidade Tecnica - Contrato ${contrato.numero.replace(/\W+/g, '-')}.pdf`;
  const { id: idAtestado } = run(
    `INSERT INTO documentos (contrato_id, tipo, titulo, arquivo, arquivo_nome, dados, criado_em)
     VALUES (?, 'atestado', ?, ?, ?, ?, ?)`,
    id, `Atestado de Capacidade Técnica — Contrato ${contrato.numero}`,
    arquivoAtestado, nomeAtestado, JSON.stringify({ rts: comArt.map((rt) => rt.id) }), criadoEm,
  );
  gerados.push(idAtestado);

  for (const rt of comArt) {
    const bytes = await gerarRequerimentoCat({ contrato, rt, empresa });
    const arquivo = gravarGerado(bytes, `requerimento-cat-${rt.disciplina}`);
    const nome = `Requerimento CAT - ${DISCIPLINAS[rt.disciplina].nome} - Contrato ${contrato.numero.replace(/\W+/g, '-')}.pdf`;
    const { id: idDoc } = run(
      `INSERT INTO documentos (contrato_id, tipo, titulo, arquivo, arquivo_nome, dados, criado_em)
       VALUES (?, 'requerimento_cat', ?, ?, ?, ?, ?)`,
      id, `Requerimento de CAT — ${DISCIPLINAS[rt.disciplina].nome} — ART ${rt.numero_art}`,
      arquivo, nome, JSON.stringify({ rt: rt.id, disciplina: rt.disciplina }), criadoEm,
    );
    gerados.push(idDoc);
  }

  registrarEvento(id, 'cat_gerada',
    `Atestado e ${comArt.length} requerimento(s) de CAT gerados.`);

  res.status(201).json(montarContrato(id));
}));

api.get('/documentos/:id/arquivo', rota((req, res) => {
  const doc = get('SELECT * FROM documentos WHERE id = ?', Number(req.params.id));
  exigir(doc, 'Documento não encontrado.', 404);
  enviarPdf(res, doc.arquivo, doc.arquivo_nome, req.query.download !== '1');
}));

api.delete('/documentos/:id', rota((req, res) => {
  const doc = get('SELECT * FROM documentos WHERE id = ?', Number(req.params.id));
  exigir(doc, 'Documento não encontrado.', 404);
  remover(doc.arquivo);
  run('DELETE FROM documentos WHERE id = ?', doc.id);
  res.status(204).end();
}));

/* ------------------------------------------------------------ utilidades */

api.post('/utilidades/vencimento', rota((req, res) => {
  const inicio = dataOuNulo(req.body?.data_assinatura);
  const meses = numeroOuNulo(req.body?.vigencia_meses);
  res.json({ data_vencimento: inicio && meses ? somarMeses(inicio, meses) : null });
}));

api.use((erro, _req, res, _next) => {
  if (erro instanceof multer.MulterError) {
    const mensagem = erro.code === 'LIMIT_FILE_SIZE'
      ? 'O arquivo passa de 25 MB.'
      : 'Falha no envio do arquivo.';
    return res.status(400).json({ erro: mensagem });
  }
  const status = erro.status ?? 500;
  if (status >= 500) console.error(erro);
  return res.status(status).json({ erro: erro.message || 'Erro inesperado no servidor.' });
});
