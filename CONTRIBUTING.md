# Trabalhar em dupla

Repositório privado: https://github.com/satiiiii/gestao-pecuaria

O colaborador precisa aceitar o convite do GitHub antes de clonar o projeto.
Os dois precisam de Git e Node.js 24 ou superior. Não é necessário Ollama nem
instalar dependências para executar esta versão.

## Primeira vez no computador do colaborador

```powershell
git clone https://github.com/satiiiii/gestao-pecuaria.git
cd gestao-pecuaria
npm test
npm start
```

Abra http://127.0.0.1:3000. Cada desenvolvedor terá seu próprio banco local,
criado ao executar o aplicativo. O código é compartilhado; bancos, senhas e
registros reais das fazendas não são enviados ao GitHub.

## Antes de começar uma tarefa

Combinem quem vai alterar cada parte. Com a pasta sem alterações pendentes:

```powershell
git switch main
git pull --ff-only
git switch -c feat/nome-da-tarefa
```

Use uma branch por tarefa, por exemplo `feat/filtro-por-alimento` ou
`fix/validacao-de-data`. Evitem trabalhar simultaneamente na mesma alteração.

## Enviar uma alteração

```powershell
npm test
git status
git add CAMINHO-DO-ARQUIVO
git diff --cached
git commit -m "Descreva a alteração"
git push -u origin HEAD
```

Revise os arquivos selecionados antes do commit. No GitHub, abra um **Pull
Request** da sua branch para `main`, explique a mudança e peça a revisão do
outro. O GitHub executará os testes automaticamente no Pull Request e nas
atualizações de `main`. Essa rotina é um acordo de trabalho; não há uma regra
paga de proteção de branch configurada nesta entrega.

Após a revisão e os testes, juntem a alteração à `main`. Para receber o que
o outro fez, voltem à `main` e executem `git pull --ff-only` antes da próxima
tarefa. Se o Git avisar sobre alterações locais ou conflito, preservem essas
mudanças antes de atualizar. Não usem `push --force` na branch principal.

## Arquivos que ficam fora do Git

- `data/` e bancos SQLite, incluindo backups e arquivos auxiliares.
- `.env` e suas variações; somente `.env.example` é versionado.
- Logs, cobertura de testes e `node_modules/`.

Não coloquem chaves, tokens ou senhas reais no código ou nas discussões do
repositório. As senhas dos testes são fictícias e usam contas de exemplo.

## Regras do projeto

Leiam `AGENTS.md`, `ARQUITETURA.md` e `LANCAMENTO.md`. O escopo atual é gestão
manual de fornecimentos por lote, com uso offline e sincronização. Uma futura
IA usará as mesmas regras de domínio; ela não faz parte desta versão.

Ao alterar arquivos públicos, atualizem a versão do cache em `public/sw.js`
para que os aparelhos recebam a nova interface. Confiram o funcionamento offline
quando a mudança afetar formulários, armazenamento ou sincronização.
