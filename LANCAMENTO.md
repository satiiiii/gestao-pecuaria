# Do piloto ao lançamento comercial

O escopo funcional inicial está implementado para teste local. A operação pública
ainda precisa ser preparada e homologada. Não há cobrança, contrato de hospedagem
ou publicação automática nesta entrega.

## Entregue no código

- Fluxo manual de fazendas, lotes, alimentos e fornecimentos.
- Contas separadas, equipe e papéis.
- Validação, revisão, edição, cancelamento e auditoria.
- Offline, sincronização, reenvios sem duplicação e resolução de conflitos.
- Exportação CSV e ferramentas de backup/restauração.
- Camada de regras independente da interface, reutilizável em uma futura IA.

## Preparação do servidor

Escolher uma hospedagem que execute Node.js e ofereça disco persistente para o
SQLite. Configurar domínio e HTTPS no proxy, `NODE_ENV=production`, `APP_ORIGIN`
correto e acesso restrito ao processo interno. O usuário do serviço precisa
escrever somente na área de dados. Manter o Node atualizado.

Configurar inicialização automática, reinício em caso de falha, espaço em disco,
monitoramento de disponibilidade e um canal para erros operacionais. Os limites
de login atuais consideram o endereço de rede visto pelo Node; com proxy, ajustar
o tratamento de IP confiável e validar os limites antes de liberar vários clientes.

O Dockerfile é uma preparação de implantação, não uma publicação realizada.
Se a hospedagem descartar o disco em cada implantação, os registros serão perdidos;
usar um volume persistente ou adaptar o banco a um serviço adequado.

## Dados e recuperação

Agendar o comando de backup, definir retenção, armazenar cópias protegidas fora
do servidor e executar uma restauração no ambiente final. Testar o procedimento
de recuperação de senha e definir quem pode executá-lo.

Configurar política de privacidade, termos do serviço, tratamento de dados e
atendimento aos clientes. Definir exportação de uma conta, encerramento e retenção
de dados. Revisar as medidas de acesso e proteção de dados aplicáveis à operação.

## Homologação do produto

Usar uma fazenda piloto e pelo menos dois aparelhos reais. Conferir:

- Instalação, primeira sincronização e reabertura sem internet.
- Registro offline durante a rotina real e envio posterior.
- Data do fato preservada ao sincronizar em outro dia.
- Sessão offline de sete dias e procedimento de renovação.
- Desativação de usuários e propagação de permissões ao reconectar.
- Conflitos, correção e cancelamento por pessoas diferentes.
- Uso em tela pequena, teclado, contraste e navegador de cada aparelho-alvo.
- Perda de conexão durante um envio e recuperação sem duplicação.

Fazer teste de carga com o volume previsto. Medir consumo de disco, tempo de
sincronização e comportamento com vários usuários simultâneos. A sincronização
atual usa snapshots completos; otimizar e paginar conforme o volume medido.

## Venda do serviço

Definir os planos, número de fazendas/usuários e canal de suporte. A cobrança
pode começar como um processo operacional separado; cobrança automática e
bloqueio por assinatura ainda não estão implementados no aplicativo.

Recuperação por e-mail, verificação de e-mail, política de entrada de novos
clientes e abertura pública do cadastro precisam ser decididas antes do
lançamento. Atualmente o administrador cria a equipe e fornece uma senha inicial
por um canal escolhido por ele; o aplicativo não envia mensagens.

Pesagens, movimentações, financeiro e sanidade permanecem fora deste MVP,
conforme o escopo confirmado. A integração com IA também fica para depois.
