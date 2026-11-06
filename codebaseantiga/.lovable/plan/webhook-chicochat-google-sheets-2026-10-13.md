# Webhook ChicoChat+ → Google Sheets

## O que será entregue
- Enviar `sessao.encerrada`, `chamado.aberto` e `chamado.falha` ao Web App já publicado por você.
- Usar as colunas das abas `raw_chico_sessoes` e `raw_chico_chamados` da documentação, com uma chave estável por sessão e por tentativa de chamado.
- Proteger dados pessoais: somente identificador de usuário por hash; sem nomes, e-mails, IPs ou texto da conversa.
- Preservar o atendimento, a geração dos resumos, a autenticação GLPI e a abertura de chamados. Falhas na planilha não impedirão o atendimento.

## Regras confirmadas
- Encerramento por ação do usuário ou após 30 minutos sem mensagens. Trocar de conversa não será tratado, sozinho, como confirmação de resolução.
- Resolução exige confirmação do usuário; nota não resolve uma sessão automaticamente.
- Elegibilidade exige uma mensagem real sobre TI; testes e sessões apenas com saudações ficam fora.
- Até três novas tentativas de entrega com intervalos crescentes. Eventos não entregues permanecem registrados para reconciliação.

## Exportação e reconciliação
- Criar `exportar-sessoes` com autenticação e paginação para sessões e tentativas alteradas nas últimas 48 horas ou em período informado.
- Permitir carga histórica usando os dados disponíveis. Campos não registrados no passado serão sinalizados como indisponíveis, sem inventar valores.
- Reconciliação diária com regravação pela chave, sem duplicação de linhas. Confirmar o contrato de sucesso do receptor para reconhecer a entrega.

## Detalhes técnicos
- Registrar sessões, tentativas e entregas pendentes no servidor, com acesso restrito e sem armazenar o token nos eventos.
- Registrar tentativas no ponto de sucesso/erro da função GLPI e encerramentos por ação explícita e processamento periódico de inatividade, independente de o navegador continuar aberto.
- Enviar o segredo compartilhado no corpo JSON, conforme a limitação do Apps Script. Guardá-lo somente no ambiente seguro do servidor.
- Documentar as decisões e testar deduplicação, falha de entrega, isolamento dos dados, exportação e ausência de regressões no atendimento.

## Necessário para ativar
A URL `/exec` do Web App foi recebida. Será solicitado o token por formulário seguro; o mesmo valor deverá estar configurado nas propriedades do Apps Script. Não envie o token no chat. A ativação inclui verificar se o Web App aceita requisições do ChicoChat+ sem exigir login no Google.