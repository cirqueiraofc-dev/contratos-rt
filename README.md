# Sistema de Contratos e RT

Controle de contratos, Anotações de Responsabilidade Técnica (ART/RT) e emissão dos
documentos de CAT — do PDF do contrato assinado até o atestado pronto para a secretaria assinar.

## O que ele faz

1. **Você sobe o PDF do contrato assinado.** O sistema lê o arquivo e propõe o cadastro já
   preenchido: número, contratante, CNPJ, objeto, valor, data de assinatura, vigência e vencimento.
2. **Ele identifica quais RTs o escopo exige** — Elétrica, Civil, Refrigeração e Mecânica —
   pelos termos técnicos encontrados no objeto, mostrando os trechos que motivaram cada sugestão.
   Você confirma ou ajusta antes de salvar.
3. **Cada modalidade marcada entra como `pendente de RT`** e aparece no painel como pendência.
4. **Quando a ART é emitida, você importa o PDF dela.** O sistema lê o número, o profissional,
   o registro no CREA, o RNP e as datas, e vincula à modalidade correspondente.
5. **Perto do vencimento da ART, o painel avisa** (prazo configurável, 60 dias por padrão).
   O mesmo vale para o vencimento do contrato (90 dias por padrão).
6. **Prorrogou ou aditivou? Sobe o PDF do termo aditivo.** O sistema lê a prorrogação de prazo e o
   acréscimo (ou supressão) de valor, recalcula vigência, valor e prazo total do contrato, e
   detecta se o aditivo trouxe serviço de uma modalidade que ainda não tinha RT.
   Se alguma ART já emitida terminar **antes** da nova vigência, ele aponta a necessidade de
   **ART complementar** — o furo de cobertura que passa despercebido com mais frequência.
7. **Ao concluir o contrato**, as ARTs emitidas passam a baixadas e o contrato entra na fila de
   **gerar CAT**.
8. **Gerar CAT produz dois tipos de documento em PDF:**
   - **Atestado de Capacidade Técnica** — o modelo para o órgão contratante assinar, com os
     elementos exigidos pelo art. 57 da Resolução nº 1.025/2009 do CONFEA (identificação das
     partes, contrato, período de execução, descrição dos serviços e profissionais com as ARTs).
   - **Requerimento de CAT** — um por ART, consolidando os dados do profissional, da ART, do
     contrato e a relação de anexos, para protocolar no CREA.

   Os termos aditivos entram nos dois documentos — o CREA exige o contrato **e** os aditivos.

> **Sobre a CAT:** a Certidão de Acervo Técnico é expedida pelo CREA, não pela contratada.
> O que o sistema gera é o atestado (que o contratante assina) e o requerimento com todos os
> dados para dar entrada no conselho. Alguns CREAs exigem o preenchimento no portal de serviços —
> nesse caso o requerimento serve como espelho dos dados a informar.

## Como rodar

Requer **Node.js 22.5 ou superior** (usa o SQLite embutido do Node, sem compilar nada).

```bash
cd contratos-rt
npm install
npm start
```

Abra <http://localhost:3000>.

Os dados ficam em `data/contratos.db` e os PDFs em `uploads/` — ambos dentro desta pasta.
Para fazer backup, basta copiar essas duas pastas.

### Variáveis de ambiente

| Variável      | Padrão              | Para que serve                                            |
| ------------- | ------------------- | --------------------------------------------------------- |
| `PORT`        | `3000`              | Porta do servidor                                          |
| `APP_SENHA`   | *(vazio)*           | Se definida, exige senha para acessar (autenticação básica) |
| `DATA_DIR`    | `./data`            | Onde fica o banco                                          |
| `UPLOAD_DIR`  | `./uploads`         | Onde ficam os PDFs                                         |

Rodando só na sua máquina, pode deixar sem senha. **Se publicar em rede, defina `APP_SENHA`**
e coloque atrás de HTTPS.

### Publicar na internet

Veja **[DEPLOY.md](DEPLOY.md)** — o repositório já traz um `render.yaml` pronto, com disco
persistente configurado. Cerca de 10 minutos do zero até acessar por link, com senha.

### Primeiro uso

Vá em **Configurações** e preencha os dados da empresa (razão social, CNPJ, registro no CREA,
endereço). Eles entram automaticamente no atestado e no requerimento de CAT.

## Testes

```bash
npm test
```

Sobe a aplicação numa porta efêmera e percorre o caminho inteiro: leitura do PDF do contrato,
detecção das RTs, importação da ART, alerta de vencimento, registro e remoção de termo aditivo
(com recálculo de vigência e valor), detecção de ART complementar, conclusão, geração da CAT e
conferência do texto dos PDFs gerados.

### Como os valores do contrato são calculados

O contrato guarda os valores **originais** (`data_vencimento_original`, `valor_original`,
`vigencia_meses_original`). Vencimento, valor e vigência correntes são sempre recalculados a
partir deles somando os termos aditivos — por isso remover um aditivo devolve o contrato ao estado
anterior sem sobras, e editar o contrato edita a base, não o resultado.

## Estrutura

```
contratos-rt/
├── server.js                  # sobe o servidor
├── src/
│   ├── aplicacao.js           # montagem do Express (usada também nos testes)
│   ├── db.js                  # esquema e acesso ao SQLite
│   ├── servico.js             # regras: situação das RTs, pendências, alertas, painel
│   ├── disciplinas.js         # as 4 modalidades e os termos que as identificam
│   ├── texto.js               # datas, valores e normalização em português
│   ├── arquivos.js            # guarda, efetivação e limpeza dos PDFs
│   ├── extract/
│   │   ├── pdfTexto.js        # extração de texto (pdf.js)
│   │   ├── contrato.js        # leitura do contrato + detecção das RTs
│   │   ├── aditivo.js         # leitura do termo aditivo
│   │   └── art.js             # leitura da ART
│   ├── docs/
│   │   ├── layout.js          # montagem de PDF A4 (pdf-lib)
│   │   ├── atestado.js        # Atestado de Capacidade Técnica
│   │   └── requerimentoCat.js # Requerimento de CAT
│   └── routes/api.js          # API HTTP
├── public/                    # interface (HTML/CSS/JS puro, sem build)
└── testes/                    # teste de ponta a ponta + PDFs de exemplo
```

## Limitações conhecidas

- **PDF digitalizado (imagem) não é lido.** O sistema avisa e você pode cadastrar manualmente —
  ou passar um OCR no arquivo antes.
- **A leitura automática é heurística.** Contratos têm redações muito diferentes; por isso nada é
  gravado sem a sua conferência na tela de revisão.
- **A detecção de RT sugere, não decide.** O enquadramento da modalidade é do responsável técnico;
  o sistema apenas mostra os termos que encontrou e por que sugeriu cada uma.
- Não há controle de usuários — só a senha única opcional.
