# Diretrizes para desenvolvimento

Base: os dois arquivos de design fornecidos pelo usuário (Design System V1). Este resumo não substitui os originais.

- Produto: aplicativo responsivo de gestão pecuária. Não assumir funcionalidades, campos ou métricas ainda não definidos.
- Identidade: profissional, natural, agro; verde #1F5D42, verde profundo #12382A, âmbar #D99A2B. Fundo claro #F5F7F2.
- Uma família tipográfica: Manrope; fallback Inter/system-ui/sans-serif.
- Valores visuais em tokens semânticos, incluindo temas claro e escuro. Espaçamento em múltiplos de 4; arredondamento moderado.
- Sidebar retrátil no desktop; navegação adaptada no celular. Teclado, foco, contraste e redução de movimento são obrigatórios.
- Iconografia outline consistente. Sem emojis, neon, gradientes arbitrários ou cards decorativos.
- Não apresentar dados fictícios como reais. Estados vazios e áreas ainda sem implementação devem comunicar sua situação com clareza.
- Não criar gráficos ou KPIs sem uma pergunta útil e dados reais para respondê-la.
- Reutilizar componentes. Criar apenas os componentes necessários para a tarefa atual.
- Mudanças estruturais de design devem ser justificadas e aprovadas pelo usuário; decisões técnicas rotineiras compatíveis podem prosseguir.
- Antes de implementar cadastros: confirmar campos, regras e persistência do primeiro módulo. Não tratar as seções desta base visual como escopo funcional confirmado.

## Escopo confirmado em 01/11/2026

- MVP sem IA: contas, usuários, fazendas, lotes, alimentos, fornecimentos e histórico.
- Usuário autorizou salvamento local e sincronização com banco no servidor.
- Fazenda e alimento: nome; lote: identificação. Fornecimento: data completa,
  lote, alimento, quantidade positiva em kg e observação opcional.
- Offline e sincronização fazem parte do escopo. Pesagens, movimentações,
  financeiro e sanidade ficam para etapas posteriores.
- O lançamento comercial é futuro. Desenvolver e testar localmente até a
  preparação da hospedagem, sem publicar dados de teste como reais.
