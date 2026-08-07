# Publicar o sistema na internet

O repositório traz dois arquivos de configuração prontos:

| Arquivo                 | Para que serve                                                    |
| ----------------------- | ----------------------------------------------------------------- |
| `render.yaml`           | **Padrão.** Plano gratuito, sem cartão. Para a cliente testar.     |
| `render-producao.yaml`  | Plano pago com disco persistente. Para contrato de verdade.        |

O Render lê o `render.yaml` da raiz automaticamente, então subir a versão de teste é só
conectar o repositório e dar Apply.

## Por que Render (e por que não Cloudflare)

O sistema grava o banco (SQLite) e os PDFs **em arquivo**. Isso exige **disco persistente**:
se o disco reinicia zerado, os contratos e as ARTs somem.

- **Cloudflare Workers / Pages não servem.** Não têm sistema de arquivos gravável. Rodar lá
  exigiria reescrever a persistência inteira para D1 + R2.
- **Render com disco** resolve com dois cliques e sem administrar servidor.
- **VPS** (Hetzner, DigitalOcean) sai mais barato a longo prazo, mas você assume systemd,
  nginx, certificado TLS e backup na mão.

## Subir para teste (grátis, sem cartão)

1. Acesse <https://dashboard.render.com> e entre com a conta do GitHub.
2. **+ New** → **Blueprint** → **Connect** no repositório `contratos-rt`.
3. Dê um nome ao Blueprint e confira que a branch é `main`. Não precisa mexer em mais nada —
   o `render.yaml` da raiz já é o gratuito.
4. Ele vai pedir o valor de `APP_SENHA` (é a única variável marcada como `sync: false`).
   Defina uma senha forte e guarde — é ela que protege o acesso ao sistema.
5. **Apply**. O primeiro deploy leva de 2 a 4 minutos.
6. Abra a URL gerada (`https://contratos-rt.onrender.com` ou parecida).
   O navegador pede a senha: **usuário em branco**, senha a que você definiu.
7. Vá em **Configurações** no sistema e preencha os dados da empresa.

### O que avisar antes de mandar o link

- **Hiberna** após ~15 minutos parado; a primeira visita depois disso demora uns 50 segundos.
- **O disco é apagado** a cada reinício ou deploy — o que ela cadastrar some. É demonstração.
- **0,1 de CPU**: ler um PDF, que é a parte pesada, leva alguns segundos em vez de um.

## Passar para produção (com disco)

Cerca de **US$ 7,25/mês** (instância `starter` ~US$ 7 + disco de 1 GB ~US$ 0,25). Sem hibernação
e sem perder dado. Faça isso **antes de entrar o primeiro contrato real**.

1. No repositório, troque os arquivos de lugar:

   ```bash
   git mv render.yaml render-teste.yaml
   git mv render-producao.yaml render.yaml
   git commit -m "Passa o deploy para producao" && git push
   ```

   Trocar os nomes evita depender do campo **Blueprint Path** da tela de criação, que nem
   sempre aparece.

2. No Render, **apague o serviço gratuito** (Settings → Delete). Isso libera o nome
   `contratos-rt`, e a URL final continua a mesma.
3. Crie o Blueprint de novo: **+ New** → **Blueprint** → mesmo repositório → **Apply**.
   Agora ele pede o cartão, porque o disco é recurso pago.
4. Preencha os dados da empresa outra vez — o banco do serviço antigo não vem junto.

O código da aplicação não muda em nenhum dos dois casos.

## Backup

Com disco, o backup é copiar duas pastas: `/var/dados/data` (banco) e `/var/dados/uploads` (PDFs).

No Render, abra a aba **Shell** do serviço e rode:

```bash
tar czf /tmp/backup.tar.gz -C /var/dados data uploads
```

Depois baixe o arquivo pela própria Shell. Vale fazer isso periodicamente — o disco do Render
não tem backup automático no plano starter.

## Variáveis de ambiente

| Variável     | Para que serve                                                        |
| ------------ | --------------------------------------------------------------------- |
| `APP_SENHA`  | Senha de acesso. **Sempre defina** quando publicar na internet.         |
| `APP_USUARIO`| Nome de usuário exigido no login. Em branco = qualquer nome serve.      |
| `R2_CONTA`   | Id da conta na Cloudflare. Sem as quatro do R2, os dados somem a cada deploy. |
| `R2_BALDE`   | Nome do bucket no R2 (ex.: `contratos-rt`).                            |
| `R2_CHAVE_ID`| Access Key Id do token do R2.                                          |
| `R2_CHAVE_SECRETA` | Secret Access Key do token do R2.                                |
| `DATA_DIR`   | Pasta do banco. No Render, dentro do disco montado.                    |
| `UPLOAD_DIR` | Pasta dos PDFs. No Render, dentro do disco montado.                    |
| `PORT`       | Porta. O Render define sozinho, não mexa.                              |

## Checagem rápida

`GET /saude` responde `{"ok":true}` sem exigir senha — é o que o Render usa para saber
se a aplicação subiu. Se essa rota responder e a página inicial pedir senha, está tudo certo.
