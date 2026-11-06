# Corrigir a síntese do chamado no GLPI

## Alteração mínima
- Manter intactos o envio ao GLPI, o histórico completo, títulos, categorias, urgência e tentativas da IA.
- Melhorar somente o resumo de contingência usado quando a IA não responde.
- Ignorar mensagens iniciais genéricas e selecionar as falas do usuário que descrevem a demanda real.
- Produzir uma síntese curta do problema e orientar os próximos pontos técnicos sem despejar a conversa completa.

## Validação
- Testar uma conversa iniciada por “Outra coisa?” seguida de uma demanda real.
- Confirmar as seis seções, ausência de falas do bot e preservação dos limites existentes.
- Validar tipos e publicar somente `glpi-ticket`.
