/**
 * As quatro modalidades de Responsabilidade Tecnica tratadas pelo sistema.
 *
 * `termos` alimenta a deteccao automatica a partir do texto do contrato.
 * O peso indica o quanto o termo e decisivo:
 *   3 = praticamente prova a modalidade
 *   2 = forte indicio
 *   1 = indicio fraco (so conta somado a outros)
 */
export const DISCIPLINAS = {
  eletrica: {
    id: 'eletrica',
    nome: 'Elétrica',
    titulo: 'Engenheiro Eletricista',
    cor: '#f0b429',
    termos: [
      ['instalacoes eletricas', 3], ['instalacao eletrica', 3], ['engenharia eletrica', 3],
      ['eletrotecnic', 3], ['spda', 3], ['subestacao', 3], ['cabine primaria', 3],
      ['sistema de protecao contra descargas atmosfericas', 3], ['media tensao', 3],
      ['alta tensao', 3], ['padrao de entrada de energia', 3], ['grupo motogerador', 3],
      ['grupo gerador', 2], ['no-break', 2], ['nobreak', 2], ['fotovoltaic', 3],
      ['quadro de distribuicao', 2], ['qgbt', 3], ['transformador', 2], ['aterramento', 2],
      ['para-raios', 3], ['eletrocentro', 3], ['baixa tensao', 2], ['disjuntor', 2],
      ['energia eletrica', 2], ['rede eletrica', 2], ['iluminacao', 2], ['luminaria', 2],
      ['cabeamento estruturado', 2], ['eletric', 1], ['nr-10', 3], ['nr 10', 3],
    ],
  },
  civil: {
    id: 'civil',
    nome: 'Civil',
    titulo: 'Engenheiro Civil',
    cor: '#6b8afd',
    termos: [
      ['engenharia civil', 3], ['obra civil', 3], ['obras civis', 3], ['construcao civil', 3],
      ['reforma predial', 3], ['concreto armado', 3], ['estrutura de concreto', 3],
      ['alvenaria', 3], ['fundacao', 3], ['impermeabiliz', 3], ['pavimentacao', 3],
      ['drywall', 3], ['esquadria', 2], ['demolicao', 3], ['edificacao', 2],
      ['revestimento ceramico', 3], ['pintura predial', 3], ['cobertura metalica', 2],
      ['telhado', 2], ['calha', 1], ['forro', 1], ['piso', 1], ['reservatorio', 2],
      ['hidrossanitari', 3], ['instalacoes hidraulicas', 3], ['rede de esgoto', 3],
      ['agua pluvial', 2], ['manutencao predial', 2], ['ampliacao', 1], ['reforma', 2],
      ['construcao', 2], ['acessibilidade', 1], ['nbr 9050', 2],
    ],
  },
  refrigeracao: {
    id: 'refrigeracao',
    nome: 'Refrigeração',
    titulo: 'Engenheiro Mecânico / Responsável por Refrigeração',
    cor: '#3fb8af',
    termos: [
      ['ar condicionado', 3], ['ar-condicionado', 3], ['climatizacao', 3], ['refrigeracao', 3],
      ['pmoc', 3], ['chiller', 3], ['fancoil', 3], ['fan coil', 3], ['vrf', 3],
      ['self contained', 3], ['condensadora', 3], ['evaporadora', 3], ['camara fria', 3],
      ['camara frigorifica', 3], ['split', 2], ['carga termica', 2], ['btu', 2],
      ['tr de refrigeracao', 3], ['exaustao mecanica', 2], ['ventilacao mecanica', 2],
      ['cortina de ar', 2], ['gas refrigerante', 3], ['fluido refrigerante', 3],
      ['portaria 3523', 2], ['qualidade do ar interior', 2], ['climatizador', 2],
    ],
  },
  mecanica: {
    id: 'mecanica',
    nome: 'Mecânica',
    titulo: 'Engenheiro Mecânico',
    cor: '#e26d5c',
    termos: [
      ['engenharia mecanica', 3], ['nr-13', 3], ['nr 13', 3], ['vaso de pressao', 3],
      ['caldeira', 3], ['elevador', 3], ['plataforma elevatoria', 3], ['ponte rolante', 3],
      ['talha', 2], ['guindaste', 3], ['ar comprimido', 3], ['compressor', 2],
      ['motobomba', 2], ['bomba centrifuga', 2], ['usinagem', 3], ['caldeiraria', 3],
      ['estrutura metalica', 2], ['solda', 2], ['tubulacao industrial', 3],
      ['gases medicinais', 3], ['esteira transportadora', 3], ['portao automatico', 2],
      ['manutencao mecanica', 3], ['equipamento mecanico', 2], ['mecanic', 1],
      ['torno', 2], ['redutor', 1], ['rolamento', 1],
    ],
  },
};

export const IDS_DISCIPLINAS = Object.keys(DISCIPLINAS);

export function nomeDisciplina(id) {
  return DISCIPLINAS[id]?.nome ?? id;
}

export function tituloDisciplina(id) {
  return DISCIPLINAS[id]?.titulo ?? '';
}
