# Gestão Pecuária — MVP sem IA

Código compartilhado em [satiiiii/gestao-pecuaria](https://github.com/satiiiii/gestao-pecuaria).
Para clonar em outro computador e trabalhar em branches, veja
[CONTRIBUTING.md](CONTRIBUTING.md).

Aplicativo funcional para o primeiro módulo aprovado: contas, usuários, fazendas,
lotes, alimentos, fornecimentos em kg e histórico. Funciona com armazenamento
local e sincronização com servidor Node.js. Não depende de Ollama, APIs de IA,
assinaturas de ferramentas ou pacotes externos.

Esta entrega é a versão **0.1.0 para piloto local**. A infraestrutura pública e a
homologação comercial estão descritas em `LANCAMENTO.md`; ainda não foram
contratadas, publicadas ou verificadas em produção.

## Abrir no seu computador

Requer Node.js 24 ou superior. Seu ambiente já tem Node.js 24.

```powershell
cd C:\Users\gabcu\gestao-pecuaria\app
npm start
```

Abra **http://127.0.0.1:3000** no navegador. Não precisa executar `npm install`.
Mantenha esse terminal aberto enquanto o servidor estiver em uso.

1. Clique em **Criar conta** e informe nome, nome da conta, primeira fazenda,
   e-mail e uma senha de pelo menos 12 caracteres.
2. Cadastre um lote e um alimento.
3. Em **Fornecimentos**, escolha **Novo fornecimento**, preencha e revise.
4. Confirme em **Salvar no aparelho**. O selo muda de **Salvo no aparelho**
   para **Sincronizado** depois que o servidor confirma.

O banco central é criado em `data/pecuaria.sqlite`, junto com arquivos auxiliares
do SQLite. Nenhum cadastro fictício ou senha padrão acompanha a entrega.
Os dados de QA ficam fora desta pasta e fora do ZIP de entrega.

Não use caminhos diferentes (`localhost` e `127.0.0.1`) alternadamente: o
navegador trata cada endereço como um armazenamento independente.

## O que funciona

- Conta independente por cliente, com uma ou mais fazendas.
- Usuários administradores e operadores, com login e senha.
- Administração de equipe online: criação, papel, ativação/desativação e senha.
- Lotes e alimentos separados por fazenda, com edição e arquivamento.
- Fornecimento com data completa, lote, alimento, quantidade positiva em kg e
  observação opcional. O formulário aceita ponto ou vírgula decimal.
- Revisão antes de salvar, edição, cancelamento com motivo e histórico de alterações.
- Filtros por texto, intervalo de datas e situação, com exportação CSV do filtro.
- Dados locais persistentes, telas preparadas para uso offline e fila de sincronização.
- Reenvios sem duplicação e conflitos explícitos entre versões.
- Layout para celular e desktop, menu lateral retrátil e temas claro/escuro.
- Backup consistente do banco e restauração em um novo arquivo.

Administradores gerenciam toda a conta. Operadores podem consultar as fazendas,
cadastrar/editar lotes e alimentos e registrar/editar/cancelar fornecimentos,
mas não alteram fazendas nem equipe. Todos os usuários da conta têm acesso às
fazendas dela; permissões por fazenda não fazem parte desta versão.
Cada e-mail pertence a uma única conta nesta versão.

## Uso offline

Faça o primeiro acesso e uma sincronização com internet. Aguarde a preparação
das telas offline. Depois, pode fechar e reabrir o app no mesmo navegador e
endereço, cadastrar e registrar sem conexão.

O acesso offline dura até o vencimento da sessão, atualmente **sete dias após
o login**. Para renovar, conecte-se e entre novamente. Mudanças de permissão
feitas no servidor passam a valer no aparelho quando ele volta a se conectar.
Use um aparelho protegido e de confiança.

A sincronização ocorre ao abrir o app, após salvar, ao voltar a conexão e a
cada 30 segundos enquanto ele estiver visível. Também existe o botão
**Sincronizar agora**. Em **Preferências**, você pode pausar os envios.

O navegador precisa continuar com seus dados. Não limpe armazenamento,
desinstale o app nem use navegação privada antes de sincronizar os pendentes.
Em Preferências, há proteção de armazenamento e exportação de uma cópia JSON
dos dados do aparelho. Essa cópia é para preservação/suporte; importação pelo
aplicativo ainda não está implementada. O backup restaurável do servidor é o SQLite.

Para sair da conta, é preciso conexão e todos os envios resolvidos. Isso evita
remover registros ainda não enviados. Se a sessão vencer, o app pede login
novamente e preserva a fila local para a mesma conta.

## Conflitos e histórico

Se dois aparelhos editarem o mesmo registro, o servidor não escolhe uma versão
silenciosamente. A tela **Sincronização** mostra as duas. Você pode revisar seus
dados e reenviar sobre a versão atual ou manter a versão do servidor.

Fornecimentos cancelados permanecem no histórico, com motivo, e não podem ser
reativados ou alterados. Caso necessário, faça um novo fornecimento correto.
O histórico detalhado requer conexão; os dados do registro continuam offline.
O servidor apresenta até 100 eventos por consulta de histórico nesta versão.

## Testar

```powershell
npm test
```

Veja `VALIDACAO.md` para os cenários automatizados e os testes reais de navegador.
Veja `ARQUITETURA.md` para entender as camadas e onde uma futura IA entrará.

## Backup do servidor

Depois de começar a usar o aplicativo:

```powershell
npm run backup
```

Cria um snapshot consistente em `data/backups/`. Um destino explícito também é
aceito: `node scripts/backup.mjs C:\caminho\novo-backup.sqlite`.
Arquivos existentes não são sobrescritos.

Guarde cópias protegidas em outro equipamento/local. O comando não agenda
backups nem envia arquivos a serviços externos automaticamente.

## Restaurar um backup

```powershell
node scripts/restore.mjs .\data\backups\ARQUIVO.sqlite .\data\restaurado.sqlite
```

O script verifica a integridade, cria um arquivo novo e encerra as sessões da
cópia restaurada. O banco original permanece intacto. Para usar a cópia, pare
o servidor com Ctrl+C e execute:

```powershell
$env:DATABASE_PATH = '.\data\restaurado.sqlite'
npm start
```

Depois de restaurar, confira os dados e as permissões dos usuários antes de
liberar acesso. Um backup representa a situação da data em que foi criado.

## Recuperar acesso administrativo

Se o administrador esquecer sua senha, o responsável pelo servidor pode usar
o comando abaixo no PowerShell 7. A senha não é colocada nos argumentos:

```powershell
$senhaTemporaria = Read-Host 'Nova senha de pelo menos 12 caracteres' -MaskInput
$senhaTemporaria | node .\scripts\recover-password.mjs EMAIL-DO-USUARIO
Remove-Variable senhaTemporaria
```

Isso redefine a senha e encerra as sessões do usuário, registrando a manutenção
no histórico. Não há recuperação automática por e-mail nesta versão.

## Configuração

As variáveis são opcionais em desenvolvimento: `HOST`, `PORT`, `APP_ORIGIN`,
`DATABASE_PATH` e `NODE_ENV`. Existe um `.env.example`. Para usar arquivo `.env`,
execute `node --env-file=.env src/server.mjs`.

Para produção, `NODE_ENV=production` exige `APP_ORIGIN=https://SEU-DOMINIO`.
É necessário um proxy com HTTPS na frente do Node. Há um Dockerfile de preparação,
mas a imagem e a hospedagem ainda precisam de validação no ambiente de implantação.
O servidor não serve o diretório `data/` nem arquivos internos.
