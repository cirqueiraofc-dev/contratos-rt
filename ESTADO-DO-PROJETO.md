# Estado do projeto — Sistema de Contratos e RT

Documento de passagem. Escrito em **04/08/2026**, ao fim da sessão que construiu o sistema.
Serve para quem for continuar o trabalho (pessoa ou agente) entender onde tudo está, o que já
funciona, o que ficou pendente e por que cada decisão foi tomada.

---

## 1. O que é este projeto

Sistema de gestão de contratos e Responsabilidades Técnicas (ART/RT) para a **ECOART SOLUÇÕES
LTDA**, empresa de engenharia de Manaus/AM. É um **serviço terceirizado**: a ECOART é a cliente,
o desenvolvimento é feito por Cirqueira (`cirqueiraofc-dev`).

### Pedido original da cliente, na íntegra

> "Eu quero um sistema onde eu vou ter acesso aos contratos. Assim que eu assinar o contrato, eu
> quero que o sistema reconheça em PDF — eu subo o PDF e ele já lança o item do contrato, com data
> de assinatura e de vencimento. E ele identifique quais RTs precisa: a RT de elétrica, de civil,
> de refrigeração e mecânica. São os quatro tipos de RT que pode ter. Aí ele já identifica quais
> RTs precisa ter e coloca lá, pendente de RT. Aí quando a gente emitir a RT, a gente já importa
> também o PDF lá, a RT que a gente emitiu. Quando tiver perto do vencimento da RT [avisa]. E
> quando o contrato concluir, esse sistema já bota lá 'contrato concluído, gerar CAT', aí ele já
> gera uma CAT com os modelos oficiais para a gente mandar para a secretaria emitir o atestado."

**Esse escopo está inteiramente entregue.** Detalhe item a item na seção 3.

---

## 2. Onde está tudo

| Item | Endereço / identificador |
| --- | --- |
| Repositório | <https://github.com/cirqueiraofc-dev/contratos-rt> — branch `main` |
| Visibilidade do repositório | **Público** (decisão consciente: fechar quando o sistema estiver pronto) |
| Sistema no ar | <https://contratos-rt.onrender.com> |
| Hospedagem | Render, workspace "My Workspace", plano Hobby (US$ 0) |
| Serviço no Render | `contratos-rt` — instância **gratuita**, sem disco |
| Blueprint do Render | ID `exs-d9ov3lb7uimc73a9a6bg` |
| Região | Virginia (mais próxima do Brasil; o Render não tem data center na América do Sul) |
| Acesso ao sistema | Usuário = variável `APP_USUARIO`, senha = variável `APP_SENHA`, ambas no painel do Render |

O repositório `cirqueiraofc-dev/threejs-skills` tem uma branch `claude/contract-rt-management-system-0d292l`
com uma **cópia obsoleta** deste código — foi onde o projeto nasceu antes de ganhar repositório
próprio. Pode ser apagada; o `main` daquele repositório nunca foi tocado.

---

## 3. O que já funciona

### O escopo pedido pela cliente

| O que ela pediu | Como ficou |
| --- | --- |
| Acesso aos contratos | Painel com indicadores, lista com busca e filtro, tela de detalhe por contrato |
| Subir o PDF e já lançar o contrato com data de assinatura e vencimento | Lê o PDF e propõe o cadastro preenchido: número, contratante, CNPJ, objeto, valor, data de assinatura, vigência em meses e vencimento calculado. O usuário confere numa tela de revisão antes de salvar |
| Identificar quais RTs o contrato exige | Detecta **elétrica, civil, refrigeração e mecânica** por termos técnicos com peso, e mostra os trechos do contrato que motivaram cada sugestão |
| Marcar "pendente de RT" | Cada modalidade confirmada entra como pendente e aparece no painel |
| Importar o PDF da ART emitida | Lê número da ART, profissional, título, CREA, RNP, datas de registro/início/término e valor |
| Avisar perto do vencimento da RT | Alerta configurável — 60 dias para ART, 90 para contrato |
| Contrato concluído → gerar CAT | Ao concluir, as ARTs emitidas passam a "baixadas" e o contrato entra na fila de CAT |
| Gerar a CAT para mandar à secretaria | Gera dois PDFs — ver seção 7.1 |

### O que foi além do pedido

- **Termos aditivos.** Contrato de manutenção continuada quase sempre é prorrogado. Sem isso, o
  sistema começaria a mostrar "vigência encerrada" para contrato prorrogado. Lê o PDF do aditivo
  (prorrogação de prazo, acréscimo ou supressão de valor, novas modalidades no escopo) e recalcula
  vigência, valor e prazo total.
- **Detecção de ART complementar.** Se uma ART já emitida termina **antes** do fim do contrato, o
  sistema aponta a necessidade de ART complementar. É o furo que uma prorrogação abre e que passa
  despercebido.
- **Histórico por contrato.** Registra cadastro, ART registrada, aditivo, conclusão e geração de CAT.
- **Proteção por senha** para publicar na internet.

---

## 4. Como rodar

### Na máquina

Requer **Node.js 22.5 ou superior** (usa o SQLite embutido do Node — nada para compilar).

```bash
git clone https://github.com/cirqueiraofc-dev/contratos-rt
cd contratos-rt
npm install
npm start          # http://localhost:3000
```

Os dados ficam em `data/contratos.db` e os PDFs em `uploads/`. Backup = copiar essas duas pastas.

### Testes

```bash
npm test
```

**23 testes**, todos passando. Cobrem o caminho inteiro de ponta a ponta: leitura do PDF do
contrato, detecção das RTs, importação da ART, alerta de vencimento, registro e remoção de aditivo
com recálculo, detecção de ART complementar, conclusão, geração da CAT e conferência do **texto dos
PDFs gerados**. Mais os testes de senha e da rota de saúde.

### Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `APP_SENHA` | Senha de acesso. **Sempre defina** ao publicar na internet. Sem ela o sistema roda aberto |
| `APP_USUARIO` | Nome exigido no campo Usuário. Em branco, qualquer nome serve e só a senha vale |
| `R2_CONTA`, `R2_BALDE`, `R2_CHAVE_ID`, `R2_CHAVE_SECRETA` | Cloudflare R2. Com as quatro, os PDFs e a cópia do banco vivem fora do Render e sobrevivem a publicação e reinício. Faltando qualquer uma, tudo fica no disco efêmero |
| `PORT` | Porta (padrão 3000). No Render é definida automaticamente |
| `DATA_DIR` | Pasta do banco (padrão `./data`) |
| `UPLOAD_DIR` | Pasta dos PDFs (padrão `./uploads`) |

---

## 5. Mapa do código

```
contratos-rt/
├── server.js                  # sobe o servidor
├── render.yaml                # deploy Render — versão GRATUITA (é a lida por padrão)
├── render-producao.yaml       # deploy Render — versão paga, com disco persistente
├── DEPLOY.md                  # passo a passo de publicação e de migração para o pago
├── src/
│   ├── aplicacao.js           # Express, porteira de acesso, rota /saude
│   ├── sessao.js              # cookie de sessão assinado
│   ├── db.js                  # esquema SQLite e migrações
│   ├── servico.js             # regras: situação das RTs, pendências, alertas, recálculo por aditivo
│   ├── disciplinas.js         # as 4 modalidades e os termos que as identificam (com peso)
│   ├── texto.js               # datas, valores e normalização em português
│   ├── arquivos.js            # guarda, efetivação e limpeza dos PDFs
│   ├── backup.js              # cópia de segurança e restauração (escreve e lê ZIP sem dependência)
│   ├── extract/
│   │   ├── pdfTexto.js        # extração de texto (pdf.js)
│   │   ├── contrato.js        # leitura do contrato + detecção das RTs
│   │   ├── aditivo.js         # leitura do termo aditivo
│   │   └── art.js             # leitura da ART
│   ├── docs/
│   │   ├── layout.js          # montagem de PDF A4 (pdf-lib): quebra de linha, tabelas, assinatura
│   │   ├── atestado.js        # Atestado de Capacidade Técnica
│   │   └── requerimentoCat.js # Requerimento de CAT
│   └── routes/api.js          # API HTTP
├── public/                    # interface: HTML/CSS/JS puro, sem build
└── testes/                    # teste de ponta a ponta + geração dos PDFs de exemplo
```

**Dependências:** só quatro — `express`, `multer`, `pdf-lib`, `pdfjs-dist`. Sem framework de
frontend, sem etapa de build, sem banco externo.

---

## 6. Decisões que valem saber

### 6.1 A CAT é expedida pelo CREA — o sistema não a emite

Este é o ponto que mais gera confusão. O fluxo real é:

1. O sistema gera o **Atestado de Capacidade Técnica** → a secretaria/órgão **assina**
2. O sistema gera o **Requerimento de CAT** (um por ART) → você protocola no CREA com o atestado
   assinado e a ART
3. **O CREA expede a CAT**

Por isso o botão "Gerar CAT" produz esses dois documentos, e não uma "CAT" pronta — que não teria
validade nenhuma. O atestado segue os elementos exigidos pelo **art. 57 da Resolução nº 1.025/2009
do CONFEA**: identificação das partes, contrato, período de execução, descrição dos serviços e
profissionais responsáveis com as respectivas ARTs. Os termos aditivos entram nos dois documentos,
porque o CREA exige o contrato **e** seus aditivos.

### 6.2 Disco persistente é o que decide a hospedagem

O sistema grava o banco SQLite e os PDFs **em arquivo**. Consequências:

- **Cloudflare Workers/Pages não servem.** Não têm sistema de arquivos gravável. Usar lá exigiria
  reescrever a persistência para D1 + R2.
- **O plano gratuito do Render apaga tudo** a cada reinício ou deploy.
- Migrar para o pago (~US$ 7,25/mês) é renomear `render-producao.yaml` para `render.yaml`, apagar o
  serviço gratuito e recriar o Blueprint. Passo a passo no `DEPLOY.md`.

Enquanto a decisão de plano não é tomada, **Configurações tem cópia de segurança e restauração**
(`src/backup.js`). Isso não substitui o disco: o backup depende de alguém lembrar de baixar. É a
diferença entre poder perder trabalho e perder trabalho com certeza.

- **Baixar** gera um `.zip` com `contratos.db` e a pasta `uploads/` inteira. O banco sai por
  `VACUUM INTO`, que produz uma cópia consistente mesmo com escrita em curso — copiar o arquivo na
  mão pegaria metade de uma transação, com o resto ainda no WAL.
- **Restaurar** anexa o banco do backup (`ATTACH`) e copia tabela por tabela dentro de uma única
  transação, em vez de trocar o arquivo do banco. Assim o serviço não precisa cair, não há arquivo
  aberto para brigar, e uma falha no meio deixa o sistema exatamente como estava. Só as colunas
  presentes nos dois lados são copiadas, então um backup antigo ainda entra.
- O ZIP é escrito e lido à mão, sem dependência: `node:zlib` já traz deflate cru e CRC-32. O CRC de
  cada entrada é conferido na leitura, e nomes como `uploads/../../server.js` são descartados em
  vez de gravados — um `.zip` preparado de má fé não sobrescreve o sistema.
- A tela exige que a palavra `RESTAURAR` seja digitada antes de apagar qualquer coisa.

### 6.3 Vigência e valor são calculados, não armazenados soltos

O contrato guarda os valores **originais** (`data_vencimento_original`, `valor_original`,
`vigencia_meses_original`). Vencimento, valor e vigência correntes saem deles **mais os aditivos**.
Por isso remover um aditivo devolve o contrato exatamente ao estado anterior, e editar o contrato
edita a base, não o resultado.

### 6.4 A leitura automática é heurística, e a conferência humana é obrigatória

Contratos têm redações muito diferentes. Nada é gravado direto: todo PDF lido passa por uma tela de
revisão com os campos preenchidos e as evidências da detecção. É proposital — o enquadramento da
modalidade é responsabilidade do RT, o sistema apenas sugere e mostra por quê.

### 6.5 O login confere usuário e senha

Foi corrigido um bug
em que senha contendo `:` nunca funcionaria (o cabeçalho Basic é `usuario:senha`, e o código
quebrava em todos os `:`). A comparação é feita em tempo constante.

A porta de entrada é `public/login.html`, e ela é de verdade: o formulário posta em `/entrar`, que
confere o par e devolve um cookie assinado (`src/sessao.js`). Não há banco de sessões - o cookie
carrega a própria validade e um HMAC dela feito com `APP_USUARIO` + `APP_SENHA` juntos, então
trocar qualquer um dos dois derruba todas as sessões emitidas antes.

O usuário é conferido de forma tolerante - ignora maiúscula e espaço sobrando - porque é um nome,
não um segredo. A senha continua em comparação de tempo constante. Quando `APP_USUARIO` está em
branco o sistema se comporta como sempre se comportou: qualquer nome entra e só a senha decide.

O Basic continua aceito, para chamar a API de fora do navegador sem inventar um segundo segredo.
A tela de entrada e o que ela carrega (`/css/`, `/imagens/`, `/fontes/`) respondem antes da
porteira, senão o visitante veria um formulário sem estilo; nada sob `/api` está nesse conjunto.
Há um `Sair` no rodapé da barra lateral.

### 6.6 Cabe mais de uma empresa, e o contrato sabe de quem é

A tabela `empresa` nasceu com `CHECK (id = 1)`: uma empresa e ponto. Passou a caber mais de uma, e
cada contrato carrega `empresa_id`. O que decide o CNPJ e o registro do atestado é a empresa **do
contrato** (`empresaDoContrato`), nunca a que está aberta na tela - errar isso significa entregar
ao contratante um atestado com o registro da empresa errada, que é o pior defeito que este sistema
poderia ter.

As listas, o painel e os alertas são filtrados por empresa. Não há visão "todas juntas": a
separação é o que impede o erro acima. A empresa aberta fica no `localStorage` do navegador e viaja
como `?empresa=` em cada chamada; o servidor não guarda essa escolha, e um id que não existe mais
cai na primeira empresa em vez de deixar a tela vazia.

Os responsáveis técnicos continuam **compartilhados** entre as empresas - o mesmo engenheiro pode
ser RT de duas. Se um dia isso atrapalhar, é a próxima coisa a separar.

No SQLite não se remove um `CHECK` com `ALTER`: a migração recria a tabela e troca o nome,
preservando os ids. O índice de `empresa_id` é criado **depois** da migração, não junto das tabelas
- criá-lo antes derruba o arranque de quem já tinha banco, que é justamente quem não pode ficar sem.
`testes/migracao.test.mjs` monta um banco no formato antigo, com dados dentro, e prova que ele
atravessa inteiro.

### 6.7 O cofre: o banco guardado fora do Render

O plano gratuito do Render não tem disco. O sistema de arquivos volta ao estado da build a cada
publicação **e a cada reinício** - e o serviço reinicia sozinho depois de um tempo parado. Os PDFs
já escapavam disso: com o R2 configurado eles nunca chegam a tocar o disco de lá (`arquivos.js`).
O que ficava exposto era o banco - empresas, contratos, RTs, datas -, que é justamente o que
ninguém remonta de memória.

`src/cofre.js` resolve com duas metades. Depois de cada escrita, uma cópia do banco sobe para o R2;
ao subir com o disco em branco, essa cópia desce **antes de o banco abrir**. Por isso os imports do
sistema em `server.js` são dinâmicos: `db.js` abre o arquivo no instante em que é carregado, e
trocar o arquivo por baixo dele depois não faria efeito.

Três decisões que valem mais que o código:

- **Não sobe a cada escrita.** Espera 2,5s de silêncio e sobe uma vez. Cadastrar um contrato com
  cinco RTs são seis escritas e um envio só. O que sobe é sempre o estado final.
- **Não restaura por cima de dado que existe.** Só desce a cópia se o banco local estiver vazio de
  verdade (nenhum contrato, nenhuma empresa preenchida). Restaurar sobre um banco com conteúdo
  seria trocar o certo pelo antigo sem ninguém pedir.
- **Falha de leitura derruba o arranque.** Se o R2 está ligado e a leitura da cópia quebra, o
  processo morre em vez de subir vazio. Subir vazio com o cofre cheio faria a primeira escrita
  sobrescrever a cópia boa - e aí o dado teria acabado de verdade. Ficar fora do ar por minutos é
  barato perto disso.

Além da cópia viva (`cofre/banco.db`), fica uma por dia em `cofre/historico/AAAA-MM-DD.db`. São
alguns KB e desfazem um dia ruim.

`VACUUM INTO` em vez de copiar o arquivo: com escrita em andamento, uma cópia crua sai pela metade.

**O cofre só funciona com o R2 configurado.** Sem `R2_CHAVE_ID` e `R2_CHAVE_SECRETA` o sistema roda
igual, grava tudo em disco e avisa no arranque - e aí os dados voltam a se perder a cada publicação.

### 6.8 As fontes são hospedadas junto, não vêm de CDN

`public/fontes` guarda a Inter (interface) e a Nunito (marca ECOART), ambas variáveis e com licença
livre. Servidas com cache de um ano e `immutable`; trocar a fonte significa trocar o nome do
arquivo. Duas razões para não usar CDN: o sistema continua abrindo se a rede externa cair, e
nenhum terceiro recebe requisição contando quem abriu um sistema de contratos.

As fontes da Apple (SF Pro, SF Symbols) **não podem ser embutidas** — a licença as restringe a
desenvolvimento para plataformas Apple. Por isso `--fonte-marca` pede `SF Pro Rounded` primeiro:
em aparelho da Apple o próprio sistema fornece, o que é permitido; nos demais cai na Nunito.

A tela de entrada é a arte da própria ECOART em tela cheia, e o cartão cai no vazio claro que a arte
deixa à esquerda, embaixo da marca. Quem pinta é `background: cover` ancorado à esquerda - o corte
come pela direita, onde só há foto. Uma segunda caixa, invisível, repete esse retângulo em geometria
e serve de sistema de coordenadas: o cartão é posicionado em porcentagem da arte, não em margem
chutada, e por isso acompanha qualquer tamanho de janela. Abaixo de 760px a arte sai de cena.

A marca da barra lateral (`public/imagens/marca-ecoart*.svg`) foi traçada dessa mesma arte, com o
`SOLUÇÕES` dentro do vetor - não remontado em texto espaçado.

---

## 7. O que o sistema gera

### 7.1 Documentos de CAT

- **Atestado de Capacidade Técnica** — um por contrato. Modelo para o órgão contratante assinar,
  com identificação das partes, dados do contrato, termos aditivos, objeto e serviços por
  modalidade, tabela de responsáveis técnicos com as ARTs, campo de avaliação e bloco de assinatura.
  Campos que precisam de preenchimento humano vêm marcados `[ASSIM]`.
- **Requerimento de CAT** — um por ART. Dados do profissional, da ART, do contrato e do contratante,
  objeto, checklist de documentos anexos e declaração com assinatura.

Ambos em A4, com paginação e rodapé identificando o contrato.

### 7.2 Limitações conhecidas

- **PDF digitalizado (imagem) não é lido.** O sistema avisa e permite cadastro manual. Solução:
  passar OCR antes.
- **A detecção de RT sugere, não decide.**
- **Não há controle de usuários** — só a senha única.

---

## 8. Dados da ECOART já levantados

Extraídos do SICAF + Cartão CNPJ enviados pela cliente. **Ainda não foram cadastrados no sistema**
(a tela de Configurações exige a senha, que o assistente não tem).

| Campo em Configurações | Valor |
| --- | --- |
| Razão social | ECOART SOLUÇÕES LTDA |
| CNPJ | 11.781.576/0001-50 |
| Registro no conselho | **FALTA** — ver pendências |
| Endereço | Rua Professora Úrsula Monteiro, 14 — Quadra 10, Lotes 14 e 14A — Loteamento Paraíso T — Tarumã — CEP 69.041-085 |
| Cidade | Manaus |
| UF | AM |
| Telefone | (92) 3088-8553 |
| E-mail | ecoart.ep@gmail.com |

Outros dados do cadastro, para referência: nome fantasia ECOART, abertura 07/04/2010, natureza
jurídica Sociedade Empresária Limitada, situação cadastral ativa, SICAF credenciado com vencimento
em 27/07/2026. Consta `JORCENES BATALHA MARINHO` como quem emitiu a consulta SICAF — **não foi
cadastrado como responsável técnico** porque o documento não diz que ele é.

### As quatro modalidades batem com os CNAEs da empresa

- `43.21-5-00` instalação e manutenção elétrica · `42.21-9-02/03` redes de distribuição de energia → **elétrica**
- `41.20-4-00` construção de edifícios · `43.30-4-04` pintura · `43.13-4-00` terraplenagem → **civil**
- `43.22-3-02` ar condicionado, ventilação e refrigeração · `33.14-7-07` refrigeração industrial → **refrigeração**
- `43.99-1-04` equipamentos de elevação de cargas e pessoas → **mecânica**

---

## 9. Pendências, por prioridade

1. **Cadastrar os dados da empresa** em Configurações (tabela da seção 8). Sem isso, o atestado sai
   com `[RAZÃO SOCIAL DA CONTRATADA]` no lugar do nome.
2. **Descobrir o registro da ECOART no CREA-AM.** Está na Certidão de Registro e Quitação do CREA,
   formato aproximado `CREA-AM 1234567`. É item que o CREA confere ao registrar a CAT.
3. **Testar com contratos reais da cliente.** É o teste que importa: as regras de leitura foram
   escritas para o padrão de contrato administrativo de prefeitura, e cada órgão redige do seu
   jeito. Anotar o que o sistema acertou e errou (número, contratante, datas, vigência, valor e
   principalmente **quais RTs marcou**) e ajustar `src/extract/contrato.js` e `src/disciplinas.js`.
4. **Cadastrar os responsáveis técnicos** da ECOART em Configurações (nome, título, CREA, RNP e as
   modalidades que cada um assina).
5. ~~Migrar para o plano pago antes do primeiro contrato real~~ — **resolvido em 07/08/2026** sem
   custo: o cofre (`src/cofre.js` + `src/r2.js`) foi configurado com um bucket no Cloudflare R2
   (as quatro variáveis `R2_CONTA`, `R2_BALDE`, `R2_CHAVE_ID`, `R2_CHAVE_SECRETA` estão no Render).
   Testado com reinício manual do serviço: os dados sobreviveram. O plano gratuito do Render
   continua apagando o disco a cada deploy/reinício, mas o banco agora volta sozinho a partir do
   R2 antes de o sistema abrir — ver seção 6.7. Continua valendo **baixar a cópia de segurança em
   Configurações de vez em quando**: cobre o caso raro de falha na conta do Cloudflare, que o
   cofre sozinho não cobre. As limitações que sobram são as de CPU e hibernação do plano
   gratuito (ver `DEPLOY.md`), não mais perda de dado.
6. **Fechar o repositório** (tornar privado) quando o sistema estiver pronto.

### Identidade visual — feita

As cores da ECOART foram amostradas em pixel na logo e aplicadas ao sistema:

| Cor | Hex | Onde entra na interface |
| --- | --- | --- |
| Laranja | `#E5762D` | Alertas e ações — substituiu o âmbar genérico |
| Índigo | `#40316A` | Acento principal: links, botões, item ativo do menu |
| Cinza | `#A6A6A6` | Texto secundário e bordas |

Estão em `public/css/app.css` como `--marca-laranja`, `--marca-indigo` e `--marca-cinza`, no topo
do arquivo. Trocar a marca inteira é mexer nessas três linhas.

Para texto e bordas o laranja usa um tom escurecido (`#B45C17` no claro): o laranja puro sobre
fundo claro não alcança contraste de leitura. No modo escuro, laranja e índigo sobem de
luminosidade mantendo o matiz, senão o índigo fica ilegível.

A logo não tem símbolo — é só "eco" laranja + "art" índigo + "SOLUÇÕES" cinza espaçado. Por isso
foi reproduzida em texto na barra lateral, sem depender de arquivo de imagem. O favicon usa as duas
cores da marca. **Se um dia aparecer o arquivo vetorial** (`.ai`/`.eps`/`.svg`/`.cdr`), vale
reamostrar as cores e trocar a marca em texto pelo SVG real.

No modo escuro o acento e o vermelho viram tons claros, e o texto branco por cima deles ficava em
2,8:1 e 2,7:1 — abaixo dos 4,5:1 que a leitura exige. Sofriam o botão primário e os contadores da
barra lateral. A variável `--sobre-cor` guarda a cor do texto que vai sobre preenchimento sólido
(branco no claro, o tom escuro do fundo no escuro) e leva os dois para ~6,6:1. O defeito é anterior
à marca: o azul que havia antes tinha o mesmo problema.

### Ideias levantadas, ainda não decididas

- **Importador de dados da empresa por PDF**: subir o cartão CNPJ ou o SICAF em Configurações e o
  sistema preencher razão social, CNPJ, endereço, cidade, UF, telefone e e-mail sozinho — mesma
  lógica já usada para contrato, ART e aditivo.
- **Aviso automático por e-mail** dos vencimentos (exige credenciais de SMTP).
- **Ligar contratos a medições** (MED01, MED02…): saldo contratual, quanto já foi medido. É o maior
  ganho e o maior trabalho; depende de entender o fluxo de medição em uso.
- **OCR** para contratos digitalizados.

---

## 10. O que o assistente NÃO conseguiu fazer

Registrado para a próxima sessão não perder tempo tentando o mesmo:

- **Sem acesso à conta do Render.** Nenhuma credencial, nenhuma ferramenta. Todo o deploy foi feito
  pelo usuário, com orientação passo a passo.
- **Sem a `APP_SENHA`.** Por isso os dados da ECOART não foram cadastrados diretamente — não há como
  fazer login no sistema publicado. Isso é intencional e deve continuar assim.
- **O GitHub App não tem permissão para criar repositórios** (erro 403). O repositório foi criado
  manualmente pelo usuário; o código foi migrado com `git subtree split`, preservando o histórico.
- **Não é possível buscar fotos do Instagram** (`instagram.com/ecoartof`). O conteúdo é fechado por
  login e não há como baixá-lo pelas ferramentas disponíveis. Qualquer galeria de fotos precisa que
  os arquivos sejam enviados diretamente.
- **O arquivo da logo não chegou em disco.** A imagem foi colada na conversa, o que permite vê-la,
  mas não amostrar as cores exatas em pixel. Para trabalhar a identidade visual direito é preciso
  **o arquivo original da logo** (`.ai`, `.eps`, `.svg`, `.cdr` ou PNG em alta) — de quem a
  desenhou. Vale dizer: aumentar um PNG pequeno não cria detalhe; o que resolve de verdade é o
  **vetor**, que escala para qualquer tamanho sem perda.

### Pergunta em aberto, importante

O usuário mencionou "personalizar o **site**" com fotos de eventos, funcionários e do dono. **Isso
não é este sistema.** Este é uma ferramenta interna de controle de contratos; fotos institucionais
não têm lugar aqui. O arquivo enviado chamava-se `ECO_SITE.pdf`, o que sugere que exista (ou vá
existir) um **site institucional da ECOART** como entrega separada. Antes de misturar as duas
coisas, confirmar com o usuário se são dois projetos distintos.

Aplicar **as cores e a logo da ECOART neste sistema** faz sentido e estava em andamento. Fotos de
evento, não.

---

## 11. Histórico de commits

Lista completa fica desatualizada rápido demais para manter aqui — ver `git log --oneline` no
repositório (53 commits até 07/08/2026). Por época, o que cada leva de commits trouxe:

| Época | O que entrou |
| --- | --- |
| `580799f` → `4bb89a4` | Escopo original: cadastro por PDF, detecção de RT, ARTs, termos aditivos, deploy no Render, correção do login com senha contendo `:` |
| `77c97b7` → `2ed34cc` | Documento de passagem (este arquivo), identidade visual ECOART, correção de contraste no modo escuro |
| `9a57368` → `671367d` | Animações de tela, tela de login com a marca em partículas, ajustes de tamanho/responsividade |
| `cf70875` → `4124762` | Cofre no R2 (banco sobrevive a reinício do plano gratuito), backup/restauração em `.zip`, tipografia própria (Inter/Nunito) |
| `1b6ecbc` → `d21fb4c` | PDFs também passam a viver no R2, logo da ECOART traçada em vetor para a marca da barra lateral e da tela de entrada |
| `59f3a68` → `191bae4` | Tela de entrada com a arte da ECOART em tela cheia, geometria do cartão sobre a arte |
| `eb40ee9` → `7bef4e9` | Suporte a mais de uma empresa (`empresa_id`, migração da trava `CHECK (id=1)`, página própria de empresas), log do R2 diz qual variável falta |

---

## 12. Avisos finais

- **O plano gratuito do Render apaga os dados.** Vale repetir porque é o erro mais caro possível
  aqui: no dia em que entrar o primeiro contrato real, o sistema tem que estar no plano pago.
- **A senha protege contratos de terceiros.** Ela é o único controle de acesso. Não compartilhe em
  conversa, e-mail ou repositório.
- **O repositório é público hoje.** Nenhum dado vaza por isso (o `.gitignore` exclui `data/` e
  `uploads/`, então banco e PDFs nunca sobem), mas o código está exposto. Fechar quando terminar.
- **Rode `npm test` antes de qualquer push.** Os 23 testes pegam regressão em toda a cadeia,
  inclusive no conteúdo dos PDFs gerados.
