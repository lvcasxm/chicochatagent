# Refinamento visual controlado

- [x] Integrar apresentação, campo de pergunta, aviso e categorias no estado inicial.
- [x] Preservar o campo inferior somente durante conversas ativas.
- [x] Refinar contraste, escala, foco e microinterações nos dois temas.
- [x] Integrar ações secundárias no desktop e no fluxo mobile.
- [x] Validar light/dark em desktop e mobile sem regressões funcionais.
- [x] Corrigir alinhamento do campo de pergunta durante a conversa (centralizado).

# Integração Google Sheets

- [x] Registrar mensagens e tentativas persistidas com identificadores estáveis; proteger dados pessoais.
- [x] Disponibilizar exportação paginada autenticada e carga histórica com campos desconhecidos sinalizados.
- [x] Configurar endereço recebido e token por formulário seguro.
- [ ] Ativar entrega automática, encerramento por inatividade e reconciliação: agendamento HTTP gerenciado indisponível neste projeto; receptor Google liberado, mas versão publicada não contém doPost.
- [ ] Validar entrega e deduplicação na planilha: aguarda doPost publicado e contrato de confirmação de sucesso.
- [ ] Instrumentar sessões anônimas: não são persistidas hoje; exige ponto de coleta autenticado/validado dedicado antes de afirmar cobertura completa.
