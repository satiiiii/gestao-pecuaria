# Como o aplicativo funciona

## Quatro camadas

1. **Formulários — `public/app.mjs`:** coletam os campos, mostram a revisão e
   apresentam dados reais e estados de armazenamento. Nenhuma IA é chamada.
2. **Regras — `public/domain.mjs`:** validam data completa, quantidade positiva,
   unidade kg e referências da mesma fazenda. O navegador e o servidor usam
   o mesmo módulo. Uma futura interpretação por IA passará por essas regras
   e pela revisão humana, da mesma forma que o formulário.
3. **Offline — `public/db.mjs` e `public/sync-core.mjs`:** mantêm registros e
   operações no IndexedDB. O service worker armazena somente as telas e os
   arquivos públicos; respostas autenticadas da API nunca entram no cache HTTP.
4. **Servidor — `src/server.mjs` e `src/store.mjs`:** autentica, verifica papéis,
   isola as contas, aplica as regras novamente, grava no SQLite e registra auditoria.

## Como um registro chega ao banco

- O formulário gera um UUID e um objeto validado.
- Ao confirmar, registro e operação são gravados atomicamente no armazenamento local.
- Cada operação carrega seu identificador e a versão do registro que foi editada.
- Ao conectar, o app autentica a sessão e envia operações em lotes de até 100.
- O servidor grava registro, recibo da operação e auditoria na mesma transação.
- Se uma resposta se perder, o recibo permite repetir o envio sem duplicar a gravação.
- Se a versão do servidor tiver mudado, o app apresenta um conflito.
- A fila local só remove uma operação depois de receber confirmação de sucesso.

Edições sucessivas offline usam versões sucessivas. Outra aba que tente gravar
sobre um estado local antigo recebe um aviso para recarregar, em vez de apagar
as mudanças da primeira aba.

## Segurança implementada

- Cada consulta usa a conta do usuário autenticado, obtida no servidor.
- O cliente não escolhe o identificador da conta nas requisições.
- Referências entre fazendas e contas são verificadas no servidor.
- Senhas usam scrypt com sal aleatório; a senha original não é armazenada.
- Sessões usam tokens aleatórios; o banco guarda o hash do token.
- Cookies HttpOnly/SameSite, Secure em produção, validação de origem e token CSRF.
- Limites de tamanho de requisição e tentativas de autenticação.
- SQL parametrizado, escape de conteúdo na interface e política CSP.
- Desativar usuário, mudar permissões ou senha revoga suas sessões.
- Exportação CSV protege células que poderiam ser interpretadas como fórmulas.

O banco local do navegador não é criptografado pelo aplicativo. A proteção do
aparelho, do perfil do navegador, dos arquivos do servidor e dos backups faz
parte da operação. O acesso offline conserva a última autorização válida até
o vencimento da sessão; a revogação remota é conhecida quando a conexão volta.

## Limites atuais

SQLite e um único processo Node atendem ao piloto sem serviços pagos. O banco
precisa ficar em disco persistente, não no filesystem descartável de uma função
serverless. Snapshots completos são sincronizados; não há sincronização incremental
ou paginação do catálogo. Capacidade para muitos clientes e registros simultâneos
precisa de teste de carga antes de definir planos comerciais.

Ao alterar os arquivos públicos para uma nova versão, altere também a versão
do cache em `public/sw.js`, para os aparelhos baixarem a nova interface.

O app não tem assinatura, cobrança automática, e-mail transacional, notificações,
telemetria externa, cálculo de dieta, controle financeiro, pesagens, movimentações
ou sanidade. Esses módulos estão fora do escopo confirmado.
