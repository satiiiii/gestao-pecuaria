# Validação da versão 0.1.0

## Testes automatizados

Comando: `npm test`. Resultado: **22 testes aprovados** no Node.js 24 do ambiente.
Não usam internet nem serviços externos. Os testes HTTP chamam o handler com
requisições controladas; os fluxos reais de navegador abaixo usam o servidor HTTP.

Cobertura das regras e do servidor:

- Datas possíveis, anos bissextos, quantidade decimal e unidade separada.
- Persistência após fechar e reabrir o SQLite.
- Reenvio idempotente: resposta perdida sem duplicar registro ou auditoria.
- Operação repetida com conteúdo alterado é recusada.
- Conta e fazenda: referências fora do contexto são recusadas.
- Papéis: operador não administra fazendas ou equipe.
- Nomes duplicados e referências arquivadas são recusados.
- Cancelamento exige motivo, preserva os dados e não permite reativação.
- Conflito de versão bloqueia sobrescrita e operações seguintes do registro.
- Fila offline permite criar e editar antes de sincronizar.
- Receber snapshots não remove alterações locais pendentes.
- Resolução de conflito mantendo o servidor ou reenviando os dados locais.
- Origem, token CSRF, cookies, revogação de sessão e host configurado.
- Rotas de equipe, redefinição de senha, desativação e recuperação administrativa.
- Arquivos internos e banco não são servidos pela aplicação.
- Texto UTF-8 é preservado mesmo dividido em vários pacotes HTTP.
- Exportação CSV escapa conteúdo com aparência de fórmula.
- Backup, verificação de integridade, restauração e encerramento de sessões.

## Testes reais de navegador

Executados no navegador integrado, com uma conta e um banco **exclusivos de QA**,
sem dados reais de fazendas. O banco de teste não acompanha a entrega.

1. Login e sincronização inicial da fazenda criada.
2. Cadastro de lote e alimento pelos formulários.
3. Recusa de `4KG` no campo de quantidade.
4. Aceitação de `320,5`, revisão e salvamento no aparelho.
5. Envio confirmado pelo servidor, com selo de sincronizado.
6. Servidor desligado: recarregamento das telas pelo service worker.
7. Criação de fornecimento com o servidor desligado.
8. Novo recarregamento offline: registro e fila preservados.
9. Servidor religado: fila enviada e confirmada sem duplicação.
10. Edição local offline e alteração concorrente preparada no servidor.
11. Exibição das duas versões e revisão explícita da versão local.
12. Resolução do conflito e consulta da auditoria com os valores anteriores.
13. Cancelamento com motivo e consulta pelo filtro de cancelados.
14. Exportação CSV e conferência do conteúdo gerado.
15. Consulta de equipe autenticada.
16. Inspeção visual do layout móvel e desktop (1280 × 900).

## O que estes testes não demonstram

- Não foi feita publicação em domínio com HTTPS nem teste do Docker em produção.
- Instalação e uso prolongado em aparelhos Android/iPhone físicos não foram homologados.
- Não houve teste de carga para definir quantidade de clientes ou simultaneidade.
- Não substituem revisão independente de segurança ou validação do uso real em fazendas.

Veja `LANCAMENTO.md` para as atividades que ainda separam o piloto da operação comercial.
