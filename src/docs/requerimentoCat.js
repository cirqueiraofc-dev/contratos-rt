/**
 * Gera o REQUERIMENTO DE CERTIDAO DE ACERVO TECNICO (CAT) com registro de
 * atestado — a ficha que o profissional protocola no CREA, consolidando os
 * dados da ART, do contrato e do atestado, com a relacao de anexos.
 *
 * A CAT em si e expedida pelo CREA; este documento e o pedido, ja preenchido
 * com tudo que o sistema conhece.
 */
import { novoDocumento } from './layout.js';
import { DISCIPLINAS } from '../disciplinas.js';
import { dataPorExtenso, formatarData, formatarMoeda, hojeISO } from '../texto.js';

/**
 * @param {{ contrato: object, rt: object, empresa: object, aditivos?: object[] }} dados
 * @returns {Promise<Uint8Array>}
 */
export async function gerarRequerimentoCat({ contrato, rt, empresa, aditivos = [] }) {
  const modalidade = DISCIPLINAS[rt.disciplina]?.nome ?? rt.disciplina;
  const doc = await novoDocumento({
    rodape: `Requerimento de CAT — Contrato nº ${contrato.numero} — ART ${rt.numero_art || 's/nº'} — ${modalidade}`,
  });

  const cidadeUf = [empresa.cidade, empresa.uf].filter(Boolean).join('/');
  const conselho = (empresa.crea_empresa || '').match(/CREA[-\s]?[A-Z]{2}/i)?.[0]
    ?? (rt.crea || '').match(/CREA[-\s]?[A-Z]{2}/i)?.[0]
    ?? 'CREA';

  doc.titulo('REQUERIMENTO DE CERTIDÃO DE ACERVO TÉCNICO');
  doc.subtitulo('CAT com registro de atestado');
  doc.espaco(6);

  doc.paragrafo(`Ao ${conselho} — Conselho Regional de Engenharia e Agronomia`);
  doc.paragrafo(
    'O profissional abaixo identificado requer a expedição de Certidão de Acervo Técnico com registro do atestado '
    + 'referente à Anotação de Responsabilidade Técnica e ao contrato descritos neste requerimento, '
    + 'nos termos da Resolução nº 1.025/2009 do CONFEA.',
  );

  doc.secao('1. Profissional requerente');
  doc.campos([
    ['Nome', rt.profissional || '[NOME DO PROFISSIONAL]'],
    ['Título profissional', rt.titulo || DISCIPLINAS[rt.disciplina]?.titulo || '—'],
    ['Registro / CREA', rt.crea || '—'],
    ['RNP', rt.rnp || '—'],
    ['Modalidade da RT', modalidade],
  ]);

  doc.secao('2. Anotação de Responsabilidade Técnica (ART)');
  doc.campos([
    ['Número da ART', rt.numero_art || '[Nº DA ART]'],
    ['Data de registro', formatarData(rt.data_registro) || '—'],
    ['Início das atividades', formatarData(rt.data_inicio) || '—'],
    ['Término / validade', formatarData(rt.data_validade) || '—'],
    ['Valor da ART', formatarMoeda(rt.valor) || '—'],
    ['Situação', 'Baixada / concluída'],
  ]);

  doc.secao('3. Contrato e contratante');
  doc.campos([
    ['Contrato nº', contrato.numero],
    ['Contratante', contrato.contratante || '[ÓRGÃO CONTRATANTE]'],
    ['CNPJ do contratante', contrato.contratante_cnpj || '—'],
    ['Contratada', empresa.razao_social || '[RAZÃO SOCIAL DA CONTRATADA]'],
    ['CNPJ da contratada', empresa.cnpj || '—'],
    ['Registro da contratada', empresa.crea_empresa || '—'],
    ['Data de assinatura', formatarData(contrato.data_assinatura) || '—'],
    ['Conclusão dos serviços', formatarData(contrato.data_conclusao || contrato.data_vencimento) || '—'],
    ['Valor do contrato', formatarMoeda(contrato.valor) || '—'],
  ]);

  if (aditivos.length) {
    doc.campo(
      'Termos aditivos',
      aditivos.map((a) => [
        a.numero || 'Termo aditivo',
        a.data_assinatura ? `de ${formatarData(a.data_assinatura)}` : '',
        a.nova_data_vencimento ? `(vigência até ${formatarData(a.nova_data_vencimento)})` : '',
      ].filter(Boolean).join(' ')).join('; '),
    );
  }

  doc.secao('4. Objeto');
  doc.paragrafo(contrato.objeto || '[Descrever o objeto do contrato]');

  doc.secao('5. Documentos anexos');
  doc.checklist([
    'Atestado de capacidade técnica emitido e assinado pelo representante legal do contratante',
    'Cópia da ART registrada e baixada, com comprovante de recolhimento da taxa',
    'Cópia do contrato e de eventuais termos aditivos',
    'Comprovante de recolhimento da taxa de expedição da CAT',
    'Documento de identificação do profissional requerente',
    'Memorial descritivo / relação de quantitativos executados, quando exigido',
  ]);

  doc.secao('6. Declaração');
  doc.paragrafo(
    'Declaro, sob as penas da lei, que as informações prestadas neste requerimento são verdadeiras e que '
    + 'as atividades técnicas descritas foram por mim executadas na qualidade de responsável técnico, '
    + 'estando os documentos comprobatórios anexados a este pedido.',
  );

  doc.espaco(6);
  doc.escrever(`${cidadeUf || '____________________'}, ${dataPorExtenso(hojeISO())}.`, { alinhamento: 'direita' });

  doc.assinatura({
    nome: rt.profissional || '[NOME DO PROFISSIONAL]',
    linhas: [rt.titulo || DISCIPLINAS[rt.disciplina]?.titulo || '', rt.crea || ''].filter(Boolean),
  });

  doc.nota(
    'Documento gerado automaticamente pelo sistema a partir dos dados cadastrados. A Certidão de Acervo Técnico é '
    + 'expedida pelo CREA — este requerimento serve para instruir o protocolo, acompanhado do atestado assinado pelo '
    + 'contratante e da ART correspondente. Alguns conselhos exigem o preenchimento do pedido diretamente no portal '
    + 'de serviços; neste caso, use este documento como espelho dos dados a informar.',
  );

  return doc.finalizar();
}
