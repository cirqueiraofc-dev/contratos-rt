async function pedir(caminho, opcoes = {}) {
  const resposta = await fetch(`/api${caminho}`, opcoes);
  if (resposta.status === 204) return null;
  const tipo = resposta.headers.get('content-type') ?? '';
  const corpo = tipo.includes('application/json') ? await resposta.json() : await resposta.text();
  if (!resposta.ok) {
    throw new Error(typeof corpo === 'object' && corpo?.erro ? corpo.erro : `Falha na requisição (${resposta.status}).`);
  }
  return corpo;
}

const json = (metodo) => (caminho, dados) => pedir(caminho, {
  method: metodo,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(dados ?? {}),
});

const enviarArquivo = (caminho, arquivo) => {
  const forma = new FormData();
  forma.append('arquivo', arquivo);
  return pedir(caminho, { method: 'POST', body: forma });
};

export const api = {
  painel: () => pedir('/painel'),
  disciplinas: () => pedir('/disciplinas'),

  empresa: () => pedir('/empresa'),
  salvarEmpresa: (dados) => json('PUT')('/empresa', dados),

  profissionais: () => pedir('/profissionais'),
  criarProfissional: (dados) => json('POST')('/profissionais', dados),
  removerProfissional: (id) => pedir(`/profissionais/${id}`, { method: 'DELETE' }),

  contratos: (filtros = {}) => {
    const busca = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v),
    ).toString();
    return pedir(`/contratos${busca ? `?${busca}` : ''}`);
  },
  contrato: (id) => pedir(`/contratos/${id}`),
  analisarContrato: (arquivo) => enviarArquivo('/contratos/analisar', arquivo),
  criarContrato: (dados) => json('POST')('/contratos', dados),
  atualizarContrato: (id, dados) => json('PUT')(`/contratos/${id}`, dados),
  removerContrato: (id) => pedir(`/contratos/${id}`, { method: 'DELETE' }),
  mudarStatus: (id, dados) => json('POST')(`/contratos/${id}/status`, dados),
  descartarRascunho: (token) => json('POST')('/contratos/descartar', { token }),
  eventos: (id) => pedir(`/contratos/${id}/eventos`),

  analisarAditivo: (contratoId, arquivo) => enviarArquivo(`/contratos/${contratoId}/aditivos/analisar`, arquivo),
  salvarAditivo: (contratoId, dados) => json('POST')(`/contratos/${contratoId}/aditivos`, dados),
  removerAditivo: (id) => pedir(`/aditivos/${id}`, { method: 'DELETE' }),

  adicionarRt: (contratoId, disciplina) => json('POST')(`/contratos/${contratoId}/rts`, { disciplina }),
  atualizarRt: (id, dados) => json('PUT')(`/rts/${id}`, dados),
  removerRt: (id) => pedir(`/rts/${id}`, { method: 'DELETE' }),
  analisarArt: (rtId, arquivo) => enviarArquivo(`/rts/${rtId}/analisar-art`, arquivo),
  salvarArt: (rtId, dados) => json('POST')(`/rts/${rtId}/art`, dados),

  gerarCat: (contratoId) => json('POST')(`/contratos/${contratoId}/cat`),
  removerDocumento: (id) => pedir(`/documentos/${id}`, { method: 'DELETE' }),

  calcularVencimento: (dados) => json('POST')('/utilidades/vencimento', dados),
};
