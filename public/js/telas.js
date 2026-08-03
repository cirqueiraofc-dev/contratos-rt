import { campo, escapar, formatarData, formatarDataHora, formatarMoeda } from './util.js';

const ROTULO_STATUS = { ativo: 'Ativo', concluido: 'Concluído', cancelado: 'Cancelado' };
const ROTULO_RT = {
  pendente: 'Pendente de RT', emitida: 'ART emitida', baixada: 'ART baixada', dispensada: 'Dispensada',
  vencida: 'ART vencida', a_vencer: 'ART a vencer',
};

function etiqueta(texto, tom = 'neutro') {
  return `<span class="etiqueta ${tom}">${escapar(texto)}</span>`;
}

/* ---------------------------------------------------------------- painel */

export function telaPainel(dados) {
  const i = dados.indicadores;
  const indicador = (valor, rotulo, tom, destino) => `
    <div class="indicador ${tom}${destino ? ' clicavel' : ''}"${destino ? ` data-ir="${destino}"` : ''}>
      <b>${valor}</b><span>${escapar(rotulo)}</span>
    </div>`;

  const alertas = dados.alertas.length
    ? dados.alertas.map((a) => `
        <div class="item-alerta ${a.tom}" data-contrato="${a.contrato_id}">
          <span class="ponto ${a.tom}"></span>
          <span>${escapar(a.texto)}</span>
          <span class="contrato">Contrato ${escapar(a.contrato_numero)}${a.contratante ? ` · ${escapar(a.contratante)}` : ''}</span>
        </div>`).join('')
    : '<div class="vazio">Nenhuma pendência no momento.</div>';

  const vencimentos = dados.proximos_vencimentos.length
    ? `<table class="tabela">
         <thead><tr><th>Contrato</th><th>Contratante</th><th>Vencimento</th><th>Faltam</th></tr></thead>
         <tbody>${dados.proximos_vencimentos.map((c) => `
           <tr data-contrato="${c.id}" style="cursor:pointer">
             <td><strong>${escapar(c.numero)}</strong></td>
             <td>${escapar(c.contratante || '—')}</td>
             <td>${formatarData(c.data_vencimento)}</td>
             <td>${c.dias < 0 ? `<span class="etiqueta critico">vencido há ${Math.abs(c.dias)}d</span>` : `${c.dias} dias`}</td>
           </tr>`).join('')}</tbody>
       </table>`
    : '<div class="vazio">Nenhum contrato com vencimento previsto.</div>';

  const avisoEmpresa = dados.empresa_configurada ? '' : `
    <div class="aviso-caixa info">
      Preencha os dados da empresa em <a href="#/configuracoes">Configurações</a> —
      eles são usados no atestado e no requerimento de CAT.
    </div>`;

  return `
    <div class="cabecalho-tela">
      <div>
        <h1>Painel</h1>
        <p>Situação de ${formatarData(dados.hoje)} · alerta de RT com ${dados.parametros.dias_alerta_rt} dias
           e de contrato com ${dados.parametros.dias_alerta_contrato} dias de antecedência</p>
      </div>
      <div class="cabecalho-acoes">
        <button class="botao primario" data-acao="novo-contrato">+ Novo contrato</button>
      </div>
    </div>

    ${avisoEmpresa}

    <div class="indicadores">
      ${indicador(i.contratos_ativos, 'Contratos ativos', 'ok', '#/contratos?status=ativo')}
      ${indicador(i.rts_pendentes, 'RTs pendentes', i.rts_pendentes ? 'alerta' : '', '#/contratos?status=ativo')}
      ${indicador(i.rts_a_vencer, 'ARTs a vencer', i.rts_a_vencer ? 'alerta' : '')}
      ${indicador(i.rts_vencidas, 'ARTs vencidas', i.rts_vencidas ? 'critico' : '')}
      ${indicador(i.contratos_a_vencer, 'Contratos a vencer', i.contratos_a_vencer ? 'alerta' : '')}
      ${indicador(i.cats_a_gerar, 'CATs a gerar', i.cats_a_gerar ? 'acao' : '', '#/contratos?status=concluido')}
    </div>

    <div class="cartao">
      <div class="cartao-titulo"><h2>Pendências</h2><span class="direita etiqueta">${dados.alertas.length}</span></div>
      <div class="lista">${alertas}</div>
    </div>

    <div class="cartao">
      <div class="cartao-titulo"><h2>Próximos vencimentos de contrato</h2></div>
      ${vencimentos}
    </div>`;
}

/* ------------------------------------------------------------- contratos */

function chipsRt(contrato) {
  if (!contrato.rts.length) return etiqueta('sem RT cadastrada');
  return contrato.rts.map((rt) => etiqueta(
    `${rt.nome_disciplina}: ${ROTULO_RT[rt.situacao] ?? rt.situacao}`,
    rt.tom,
  )).join('');
}

export function telaContratos(contratos, filtros) {
  const linhas = contratos.length ? contratos.map((c) => `
    <div class="contrato-linha" data-contrato="${c.id}">
      <div>
        <div class="titulo">Contrato ${escapar(c.numero)}</div>
        <div class="sub">${escapar(c.contratante || 'Contratante não informado')}</div>
      </div>
      <div class="direita">
        ${etiqueta(c.rotulo, c.tom)}
        <span class="sub">${formatarData(c.data_assinatura)} → ${formatarData(c.data_vencimento)}</span>
      </div>
      <div class="objeto">${escapar(c.objeto || 'Sem descrição de objeto.')}</div>
      <div class="chips" style="grid-column:1/-1">${chipsRt(c)}</div>
    </div>`).join('')
    : '<div class="vazio">Nenhum contrato encontrado. Comece enviando o PDF de um contrato assinado.</div>';

  return `
    <div class="cabecalho-tela">
      <div>
        <h1>Contratos</h1>
        <p>${contratos.length} contrato(s) listado(s)</p>
      </div>
      <div class="cabecalho-acoes">
        <button class="botao primario" data-acao="novo-contrato">+ Novo contrato</button>
      </div>
    </div>

    <div class="filtros">
      <input type="search" id="filtro-busca" placeholder="Buscar por número, contratante ou objeto…" value="${escapar(filtros.q ?? '')}" />
      <select id="filtro-status">
        <option value="">Todas as situações</option>
        <option value="ativo"${filtros.status === 'ativo' ? ' selected' : ''}>Ativos</option>
        <option value="concluido"${filtros.status === 'concluido' ? ' selected' : ''}>Concluídos</option>
        <option value="cancelado"${filtros.status === 'cancelado' ? ' selected' : ''}>Cancelados</option>
      </select>
    </div>

    <div class="lista">${linhas}</div>`;
}

/* --------------------------------------------------------- detalhe do contrato */

function cartaoRt(rt, contrato) {
  const podeEditar = contrato.status !== 'cancelado';
  const dados = rt.status === 'pendente'
    ? `<div class="rt-dados"><span>${escapar(rt.motivo ? `Detectada por: ${rt.motivo}` : 'Aguardando emissão da ART.')}</span></div>`
    : `<div class="rt-dados">
         <span>ART <b>${escapar(rt.numero_art || '—')}</b></span>
         <span>${escapar(rt.profissional || 'Profissional não informado')}</span>
         <span>${escapar(rt.crea || '')}${rt.rnp ? ` · RNP ${escapar(rt.rnp)}` : ''}</span>
         <span>Vigência: ${formatarData(rt.data_inicio)} → ${formatarData(rt.data_validade)}</span>
       </div>`;

  return `
    <div class="rt-cartao ${rt.tom}">
      <div class="rt-cabecalho">
        <strong>${escapar(rt.nome_disciplina)}</strong>
        <span class="direita">${etiqueta(ROTULO_RT[rt.situacao] ?? rt.situacao, rt.tom)}</span>
      </div>
      ${dados}
      <div class="rt-dados"><span>${escapar(rt.mensagem)}</span></div>
      <div class="rt-acoes">
        ${podeEditar && rt.status === 'pendente'
          ? `<button class="botao pequeno primario" data-acao="subir-art" data-rt="${rt.id}">Importar ART (PDF)</button>`
          : ''}
        ${rt.tem_arquivo ? `<a class="botao pequeno" href="/api/rts/${rt.id}/arquivo" target="_blank" rel="noopener">Ver ART</a>` : ''}
        ${podeEditar && rt.status !== 'pendente'
          ? `<button class="botao pequeno" data-acao="subir-art" data-rt="${rt.id}">Substituir PDF</button>`
          : ''}
        ${podeEditar ? `<button class="botao pequeno" data-acao="editar-rt" data-rt="${rt.id}">Editar</button>` : ''}
        ${podeEditar ? `<button class="botao pequeno perigo" data-acao="remover-rt" data-rt="${rt.id}">Remover</button>` : ''}
      </div>
    </div>`;
}

export function telaContrato(contrato, disciplinas) {
  const faltantes = disciplinas.filter((d) => !contrato.rts.some((rt) => rt.disciplina === d.id));

  const pendencias = contrato.pendencias.length
    ? `<div class="cartao">
         <div class="cartao-titulo"><h2>Pendências</h2></div>
         <div class="lista">${contrato.pendencias.map((p) => `
           <div class="item-alerta ${p.tom}"><span class="ponto ${p.tom}"></span><span>${escapar(p.texto)}</span></div>
         `).join('')}</div>
       </div>`
    : '';

  const documentos = contrato.documentos.length
    ? `<table class="tabela">
         <thead><tr><th>Documento</th><th>Gerado em</th><th></th></tr></thead>
         <tbody>${contrato.documentos.map((d) => `
           <tr>
             <td><strong>${escapar(d.titulo)}</strong></td>
             <td>${formatarDataHora(d.criado_em)}</td>
             <td style="text-align:right;white-space:nowrap">
               <a class="botao pequeno" href="/api/documentos/${d.id}/arquivo" target="_blank" rel="noopener">Abrir</a>
               <a class="botao pequeno" href="/api/documentos/${d.id}/arquivo?download=1" download>Baixar</a>
             </td>
           </tr>`).join('')}</tbody>
       </table>`
    : `<div class="vazio">Nenhum documento gerado.${contrato.status === 'concluido' ? '' : ' Conclua o contrato para gerar o atestado e o requerimento de CAT.'}</div>`;

  const acoesStatus = contrato.status === 'concluido'
    ? `<button class="botao" data-acao="reabrir">Reabrir contrato</button>
       <button class="botao primario" data-acao="gerar-cat">${contrato.tem_atestado ? 'Gerar CAT novamente' : 'Gerar CAT'}</button>`
    : `<button class="botao primario" data-acao="concluir">Concluir contrato</button>`;

  return `
    <div class="cabecalho-tela">
      <div>
        <a href="#/contratos" class="sub">← Contratos</a>
        <h1>Contrato ${escapar(contrato.numero)}</h1>
        <p>${escapar(contrato.contratante || 'Contratante não informado')} · ${etiqueta(contrato.rotulo, contrato.tom)}</p>
      </div>
      <div class="cabecalho-acoes">
        ${contrato.arquivo ? `<a class="botao" href="/api/contratos/${contrato.id}/arquivo" target="_blank" rel="noopener">Ver PDF do contrato</a>` : ''}
        <button class="botao" data-acao="editar-contrato">Editar dados</button>
        ${acoesStatus}
      </div>
    </div>

    ${pendencias}

    <div class="cartao">
      <div class="cartao-titulo"><h2>Dados do contrato</h2>
        <span class="direita etiqueta">${escapar(ROTULO_STATUS[contrato.status] ?? contrato.status)}</span>
      </div>
      <table class="tabela">
        <tbody>
          <tr><td style="width:32%"><strong>Contratante</strong></td><td>${escapar(contrato.contratante || '—')}${contrato.contratante_cnpj ? ` · CNPJ ${escapar(contrato.contratante_cnpj)}` : ''}</td></tr>
          <tr><td><strong>Assinatura</strong></td><td>${formatarData(contrato.data_assinatura)}</td></tr>
          <tr><td><strong>Vencimento</strong></td><td>${formatarData(contrato.data_vencimento)}${contrato.vigencia_meses ? ` · vigência de ${contrato.vigencia_meses} meses` : ''}</td></tr>
          ${contrato.data_conclusao ? `<tr><td><strong>Conclusão</strong></td><td>${formatarData(contrato.data_conclusao)}</td></tr>` : ''}
          <tr><td><strong>Valor</strong></td><td>${formatarMoeda(contrato.valor)}</td></tr>
          <tr><td><strong>Objeto</strong></td><td>${escapar(contrato.objeto || '—')}</td></tr>
          ${contrato.observacoes ? `<tr><td><strong>Observações</strong></td><td>${escapar(contrato.observacoes)}</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    <div class="cartao">
      <div class="cartao-titulo">
        <h2>Responsabilidades técnicas</h2>
        <span class="direita">
          ${faltantes.length
            ? `<select id="add-rt" class="botao" style="padding:6px 10px">
                 <option value="">+ Adicionar modalidade…</option>
                 ${faltantes.map((d) => `<option value="${d.id}">${escapar(d.nome)}</option>`).join('')}
               </select>`
            : ''}
        </span>
      </div>
      ${contrato.rts.length
        ? `<div class="grade-rts">${contrato.rts.map((rt) => cartaoRt(rt, contrato)).join('')}</div>`
        : '<div class="vazio">Nenhuma modalidade de RT cadastrada para este contrato.</div>'}
    </div>

    <div class="cartao">
      <div class="cartao-titulo"><h2>Documentos gerados (CAT)</h2></div>
      ${documentos}
    </div>

    <div class="cartao">
      <div class="cartao-titulo"><h2>Histórico</h2></div>
      <div id="historico" class="lista"><div class="vazio">Carregando…</div></div>
    </div>

    <div style="margin-top:18px;text-align:right">
      <button class="botao perigo" data-acao="remover-contrato">Excluir contrato</button>
    </div>`;
}

/* -------------------------------------------------------- configuracoes */

export function telaConfiguracoes(empresa, profissionais, disciplinas) {
  const listaProfissionais = profissionais.length
    ? `<table class="tabela">
         <thead><tr><th>Nome</th><th>Título</th><th>Registro</th><th>Modalidades</th><th></th></tr></thead>
         <tbody>${profissionais.map((p) => `
           <tr>
             <td><strong>${escapar(p.nome)}</strong></td>
             <td>${escapar(p.titulo || '—')}</td>
             <td>${escapar(p.crea || '—')}${p.rnp ? `<br><small>RNP ${escapar(p.rnp)}</small>` : ''}</td>
             <td>${p.disciplinas.map((d) => etiqueta(disciplinas.find((x) => x.id === d)?.nome ?? d, 'acento')).join(' ') || '—'}</td>
             <td style="text-align:right"><button class="botao pequeno perigo" data-remover-profissional="${p.id}">Remover</button></td>
           </tr>`).join('')}</tbody>
       </table>`
    : '<div class="vazio">Nenhum responsável técnico cadastrado.</div>';

  return `
    <div class="cabecalho-tela">
      <div>
        <h1>Configurações</h1>
        <p>Dados usados no preenchimento automático do atestado e do requerimento de CAT</p>
      </div>
    </div>

    <div class="cartao">
      <div class="cartao-titulo"><h2>Dados da empresa (contratada)</h2></div>
      <form id="form-empresa">
        <div class="grade-campos">
          ${campo({ nome: 'razao_social', rotulo: 'Razão social', valor: empresa.razao_social, largo: true })}
          ${campo({ nome: 'cnpj', rotulo: 'CNPJ', valor: empresa.cnpj })}
          ${campo({ nome: 'crea_empresa', rotulo: 'Registro no conselho', valor: empresa.crea_empresa, dica: 'Ex.: CREA-SP 1234567' })}
          ${campo({ nome: 'endereco', rotulo: 'Endereço', valor: empresa.endereco, largo: true })}
          ${campo({ nome: 'cidade', rotulo: 'Cidade', valor: empresa.cidade })}
          ${campo({ nome: 'uf', rotulo: 'UF', valor: empresa.uf, atributos: 'maxlength="2"' })}
          ${campo({ nome: 'telefone', rotulo: 'Telefone', valor: empresa.telefone })}
          ${campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: empresa.email })}
          ${campo({ nome: 'dias_alerta_rt', rotulo: 'Alerta de ART (dias antes)', tipo: 'number', valor: empresa.dias_alerta_rt, atributos: 'min="1"' })}
          ${campo({ nome: 'dias_alerta_contrato', rotulo: 'Alerta de contrato (dias antes)', tipo: 'number', valor: empresa.dias_alerta_contrato, atributos: 'min="1"' })}
        </div>
        <button class="botao primario" type="submit">Salvar dados da empresa</button>
      </form>
    </div>

    <div class="cartao">
      <div class="cartao-titulo"><h2>Responsáveis técnicos</h2></div>
      ${listaProfissionais}
      <form id="form-profissional" style="margin-top:16px">
        <div class="grade-campos">
          ${campo({ nome: 'nome', rotulo: 'Nome', largo: true })}
          ${campo({ nome: 'titulo', rotulo: 'Título profissional', dica: 'Ex.: Engenheiro Eletricista' })}
          ${campo({ nome: 'crea', rotulo: 'Registro / CREA' })}
          ${campo({ nome: 'rnp', rotulo: 'RNP' })}
          <div class="campo largura-total">
            <label>Modalidades que assina</label>
            <div class="chips">
              ${disciplinas.map((d) => `
                <label class="etiqueta" style="cursor:pointer">
                  <input type="checkbox" name="disciplinas" data-lista="1" value="${d.id}" /> ${escapar(d.nome)}
                </label>`).join('')}
            </div>
          </div>
        </div>
        <button class="botao" type="submit">Adicionar responsável</button>
      </form>
    </div>`;
}
