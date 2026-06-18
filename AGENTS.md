# Regras para o assistente

## Validação antes de deploy
- **Sempre** rodar `node --check` em TODOS os arquivos modificados ANTES de commitar
- Revisar todos os caminhos do código afetados pela mudança (não só o trecho editado)
- Verificar funções auxiliares, variáveis globais e fluxos de chamada
- Só commitar depois de validar sintaxe E lógica

## Padrão de commits
- Nunca fazer 2+ deploys para corrigir o mesmo erro
- Testar mentalmente o fluxo completo antes de subir
