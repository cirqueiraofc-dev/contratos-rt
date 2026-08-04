# Publicar o sistema na internet

O repositório já vem com `render.yaml` pronto. O passo a passo abaixo leva uns 10 minutos.

## Por que Render (e por que não Cloudflare)

O sistema grava o banco (SQLite) e os PDFs **em arquivo**. Isso exige **disco persistente**:
se o disco reinicia zerado, os contratos e as ARTs somem.

- **Cloudflare Workers / Pages não servem.** Não têm sistema de arquivos gravável. Rodar lá
  exigiria reescrever a persistência inteira para D1 + R2.
- **Render com disco** resolve com dois cliques e sem administrar servidor.
- **VPS** (Hetzner, DigitalOcean) sai mais barato a longo prazo, mas você assume systemd,
  nginx, certificado TLS e backup na mão.

## Opção recomendada — Render com disco (produção)

Plano `starter` + disco de 1 GB: cerca de **US$ 8/mês**. Sem hibernação, dado preservado.

1. Acesse <https://dashboard.render.com> e entre com a conta do GitHub.
2. **New** → **Blueprint** → escolha o repositório `contratos-rt`.
   O Render lê o `render.yaml` e monta o serviço sozinho.
3. Ele vai pedir o valor de `APP_SENHA` (é a única variável marcada como `sync: false`).
   Defina uma senha forte — é ela que protege o acesso ao sistema.
4. **Apply**. O primeiro deploy leva de 2 a 4 minutos.
5. Abra a URL que o Render gerar (`https://contratos-rt.onrender.com` ou parecida).
   O navegador vai pedir a senha: usuário em branco, senha a que você definiu.
6. Vá em **Configurações** no sistema e preencha os dados da empresa.

## Opção grátis — só para a cliente testar

Funciona, com duas limitações que você precisa avisar antes:

- **O serviço hiberna** após ~15 minutos parado. A primeira visita depois disso demora
  uns 50 segundos carregando.
- **O disco é apagado** a cada reinício ou deploy. Serve para testar a ferramenta,
  não para guardar contrato de verdade.

Para usar assim, edite o `render.yaml` antes do passo 2:

- troque `plan: starter` por `plan: free`
- apague o bloco `disk:` inteiro
- apague as variáveis `DATA_DIR` e `UPLOAD_DIR`

Migrar depois para o plano pago é só desfazer essas três edições e reaplicar o Blueprint —
o código não muda.

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
| `DATA_DIR`   | Pasta do banco. No Render, dentro do disco montado.                    |
| `UPLOAD_DIR` | Pasta dos PDFs. No Render, dentro do disco montado.                    |
| `PORT`       | Porta. O Render define sozinho, não mexa.                              |

## Checagem rápida

`GET /saude` responde `{"ok":true}` sem exigir senha — é o que o Render usa para saber
se a aplicação subiu. Se essa rota responder e a página inicial pedir senha, está tudo certo.
