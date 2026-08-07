/**
 * A empresa aberta na tela. Fica aqui, e nao em cada chamada, para que nao
 * exista rota que esqueca de mandar — esquecer significaria mostrar contrato
 * de outra empresa, ou gerar documento com o CNPJ errado.
 */
let empresaEscolhida = null;

export function usarEmpresa(id) {
  empresaEscolhida = id ?? null;
}

export function empresaEmUso() {
  return empresaEscolhida;
}

function comEmpresa(caminho) {
  if (!empresaEscolhida) return caminho;
  return `${caminho}${caminho.includes('?') ? '&' : '?'}empresa=${encodeURIComponent(empresaEscolhida)}`;
}

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
  painel: () => pedir(comEmpresa('/painel')),
  disciplinas: () => pedir('/disciplinas'),

  empresas: () => pedir('/empresas'),
  criarEmpresa: (dados) => json('POST')('/empresas', dados),
  salvarEmpresa: (id, dados) => json('PUT')(`/empresas/${id}`, dados),
  removerEmpresa: (id) => pedir(`/empresas/${id}`, { method: 'DELETE' }),

  /**
   * Baixa o backup. Nao usa `pedir` porque a resposta e binaria, nao JSON;
   * mas ainda passa pelo fetch para que um erro do servidor apareca como
   * mensagem na tela em vez de virar um arquivo quebrado na pasta Downloads.
   */
  baixarBackup: async () => {
    const resposta = await fetch('/api/backup');
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => null);
      throw new Error(corpo?.erro ?? `Falha ao gerar a cópia (${resposta.status}).`);
    }
    const nome = /filename="([^"]+)"/.exec(resposta.headers.get('content-disposition') ?? '')?.[1]
      ?? 'contratos-rt-backup.zip';
    const endereco = URL.createObjectURL(await resposta.blob());
    const link = Object.assign(document.createElement('a'), { href: endereco, download: nome });
    document.body.append(link);
    link.click();
    link.remove();
    // sem revogar, o navegador segura o arquivo inteiro na memoria
    setTimeout(() => URL.revokeObjectURL(endereco), 10000);
    return nome;
  },

  restaurarBackup: (arquivo) => enviarArquivo('/restaurar', arquivo),

  profissionais: () => pedir('/profissionais'),
  criarProfissional: (dados) => json('POST')('/profissionais', dados),
  removerProfissional: (id) => pedir(`/profissionais/${id}`, { method: 'DELETE' }),

  contratos: (filtros = {}) => {
    const busca = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v),
    ).toString();
    return pedir(comEmpresa(`/contratos${busca ? `?${busca}` : ''}`));
  },
  contrato: (id) => pedir(`/contratos/${id}`),
  analisarContrato: (arquivo) => enviarArquivo('/contratos/analisar', arquivo),
  criarContrato: (dados) => json('POST')('/contratos', { ...dados, empresa_id: empresaEscolhida }),
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
