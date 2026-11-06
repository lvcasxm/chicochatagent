-- 1) Deduplicar: remover categorias e flows da org chicobot (duplicatas)
DELETE FROM flow_steps WHERE flow_id IN (SELECT id FROM flows WHERE organization_id = '66a2a90f-8530-496c-9521-3bdc5562dfe9');
DELETE FROM flows WHERE organization_id = '66a2a90f-8530-496c-9521-3bdc5562dfe9';
DELETE FROM categories WHERE organization_id = '66a2a90f-8530-496c-9521-3bdc5562dfe9';

-- 2) Corrigir conflito de IP: remover exigência de IP via chat na descrição de redes
UPDATE categories
SET description = 'Este eixo foca na resolução de problemas relacionados a rede e internet. Aqui é extremamente importante que o agente diferencie se o problema está acontecendo somente com um funcionário ou com mais pessoas do setor, para que a resposta se adeque melhor a esse determinado cenário. Aqui, temos três problemas principais: "não tenho conexão", "conexão está lenta", "serviço está fora do ar". IMPORTANTE: O endereço de IP NÃO deve ser solicitado no chat — ele será coletado automaticamente no formulário de abertura de chamado.'
WHERE id = '9d08be1e-a31f-4454-97a7-d8d4a44a532d';

-- Também remover menção a IP da descrição de Requisição de acesso
UPDATE categories
SET description = 'Este eixo de atendimento compreende demandas relativas à requisição de acesso a sistemas internos, como à criação de contas de e-mail institucional, diretório ativo (AD), recursos correlatos ou acesso ao SEI, Sistema Eletrônico de Informações. É fundamental esclarecer que este chatbot não possui autonomia técnica ou administrativa para realizar a liberação direta de acessos, os quais são gerenciados exclusivamente por meio do sistema Sonner, via portal de gestão GRP (Portal do Cidadão). Nestes casos, o usuário deverá ser orientado a fornecer o máximo de informações relevantes para que a equipe técnica possa processar a solicitação. O chatbot deve coletar via chat: o sistema específico ao qual se deseja o acesso e a justificativa detalhada da necessidade. Dados como nome, setor e IP da máquina serão coletados automaticamente no formulário de abertura de chamado — NÃO devem ser solicitados no chat.'
WHERE id = '838d6a67-4f59-4a53-b74a-40f77317b115';

-- 3) Criar 3 novas categorias na org chicochat
INSERT INTO categories (id, name, description, organization_id) VALUES
('11111111-1111-1111-1111-111111111101',
 'Eixo de segurança da informação',
 'Este eixo trata de questões de segurança digital: suspeita de vírus, malware, ransomware, e-mails de phishing, bloqueios suspeitos, acessos indevidos a contas, comportamento estranho da máquina (lentidão extrema, pop-ups, arquivos sumindo ou criptografados) e vazamentos de dados. O agente deve investigar com urgência: perguntar quais sintomas o usuário observou, se clicou em algum link ou anexo suspeito, se notou arquivos renomeados ou inacessíveis, e orientar a desconectar a máquina da rede em caso de suspeita de ransomware. Em qualquer suspeita real, abrir chamado imediatamente como prioridade alta.',
 '01efa1a1-c7bd-41c8-8063-c1872a413cbc'),
('11111111-1111-1111-1111-111111111102',
 'Eixo de instalação de sistemas',
 'Este eixo cobre solicitações de instalação ou atualização de softwares: pacote Office, navegadores, leitores de PDF, sistemas internos, drivers de impressora, certificados digitais, etc. O agente deve identificar exatamente qual software é necessário, a versão (se aplicável), e a justificativa de uso. Lembrar que instalações dependem de aprovação e devem ser feitas pela equipe técnica via chamado — o chatbot NÃO orienta o usuário a baixar ou instalar nada por conta própria.',
 '01efa1a1-c7bd-41c8-8063-c1872a413cbc'),
('11111111-1111-1111-1111-111111111103',
 'Eixo de e-mail e comunicação',
 'Este eixo trata de problemas com e-mail institucional e ferramentas de comunicação: não consegue enviar, não recebe mensagens, e-mails indo para spam indevidamente, problemas de configuração no Outlook ou em apps de celular, anexos que não abrem, listas de distribuição, assinatura de e-mail. O agente deve investigar primeiro se o problema é só com um destinatário ou com todos, se é envio ou recebimento, e se houve mudança recente de senha. Não confundir com redefinição de senha (eixo próprio).',
 '01efa1a1-c7bd-41c8-8063-c1872a413cbc');

-- 4) Criar flows com perguntas-chave para todas as categorias principais
-- Limpar flows existentes para recriar de forma consistente
DELETE FROM flow_steps WHERE flow_id IN (SELECT id FROM flows WHERE organization_id = '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
DELETE FROM flows WHERE organization_id = '01efa1a1-c7bd-41c8-8063-c1872a413cbc';

-- Hardware
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222201', 'Diagnóstico de hardware', '211f802c-64c1-41b9-8355-ae0a955e8ee6', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222201', 0, 'Identificar o equipamento', 'Pergunte qual equipamento apresenta o problema (computador, monitor, teclado, mouse, fonte, etc.).', 'Coletar tipo de equipamento'),
('22222222-2222-2222-2222-222222222201', 1, 'Verificar sintoma exato', 'Pergunte o que exatamente acontece: não liga, liga e desliga, tela preta, lentidão, barulho estranho, etc.', 'Coletar sintoma'),
('22222222-2222-2222-2222-222222222201', 2, 'Verificar cabos e energia', 'Peça para o usuário conferir se cabos de força e de vídeo estão firmes e se a tomada/régua tem energia.', 'Validar conexões físicas'),
('22222222-2222-2222-2222-222222222201', 3, 'Tentar reinício', 'Solicitar reinício do equipamento e perguntar se o problema persiste.', 'Reiniciar equipamento'),
('22222222-2222-2222-2222-222222222201', 4, 'Decidir escalonamento', 'Se o problema persistir após verificações, abrir chamado com tipo do equipamento, sintoma e o que já foi tentado.', 'Abrir chamado se necessário');

-- Rede e internet
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222202', 'Diagnóstico de rede', '9d08be1e-a31f-4454-97a7-d8d4a44a532d', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222202', 0, 'Verificar abrangência', 'Pergunte se o problema afeta apenas o usuário ou outras pessoas do mesmo setor também estão sem rede.', 'Identificar se é individual ou coletivo'),
('22222222-2222-2222-2222-222222222202', 1, 'Identificar tipo de problema', 'Pergunte se está totalmente sem conexão, se está lenta, ou se um serviço específico está fora do ar.', 'Classificar sintoma'),
('22222222-2222-2222-2222-222222222202', 2, 'Conferir cabo de rede', 'Peça para verificar se o cabo de rede está conectado firmemente no computador (se não for Wi-Fi).', 'Validar cabo'),
('22222222-2222-2222-2222-222222222202', 3, 'Reiniciar máquina', 'Solicitar reinício do computador e perguntar se voltou a funcionar.', 'Reiniciar'),
('22222222-2222-2222-2222-222222222202', 4, 'Escalar para chamado', 'Se persistir, abrir chamado descrevendo abrangência, sintoma e tentativas. NÃO peça IP no chat — será coletado no formulário.', 'Abrir chamado');

-- Redefinição de senhas
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222203', 'Redefinição de senha', '25845ae4-04df-427a-b4d0-974e3fa32b41', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222203', 0, 'Identificar sistema', 'Pergunte de qual sistema é a senha: AD (computador), e-mail institucional, Sonner, SEI ou GRP.', 'Identificar sistema'),
('22222222-2222-2222-2222-222222222203', 1, 'Orientar autoatendimento', 'Oriente o usuário a usar a opção "Esqueci minha senha" do próprio sistema, guiando passo a passo.', 'Guiar autoatendimento'),
('22222222-2222-2222-2222-222222222203', 2, 'Confirmar recebimento de e-mail', 'No caso de SEI/GRP, confirme se o e-mail de redefinição foi recebido e abrir o link.', 'Validar e-mail recebido'),
('22222222-2222-2222-2222-222222222203', 3, 'Cadastrar nova senha', 'Orientar criação de senha forte conforme política da Prefeitura.', 'Definir nova senha'),
('22222222-2222-2222-2222-222222222203', 4, 'Escalar se falhar', 'Se a redefinição não funcionar, abrir chamado informando o sistema e o erro apresentado.', 'Abrir chamado se necessário');

-- Requisição de acesso
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222204', 'Requisição de acesso', '838d6a67-4f59-4a53-b74a-40f77317b115', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222204', 0, 'Identificar sistema solicitado', 'Pergunte a qual sistema o usuário precisa de acesso (AD, e-mail, SEI, etc.).', 'Coletar sistema'),
('22222222-2222-2222-2222-222222222204', 1, 'Coletar justificativa', 'Pergunte qual a justificativa/necessidade do acesso para a função do usuário.', 'Coletar justificativa'),
('22222222-2222-2222-2222-222222222204', 2, 'Verificar perfil necessário', 'Pergunte se há perfil ou nível de permissão específico necessário (leitura, edição, admin).', 'Definir perfil'),
('22222222-2222-2222-2222-222222222204', 3, 'Abrir chamado', 'Abrir chamado com sistema, justificativa e perfil. Dados pessoais e IP serão coletados no formulário.', 'Abrir chamado');

-- Impressoras (Repros)
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222205', 'Problemas de impressão', '70d8d79d-3e13-4106-af8c-9e60b09faaa6', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222205', 0, 'Identificar sintoma', 'Pergunte o que está acontecendo: impressora offline, atolando papel, sem toner, fila travada, etc.', 'Coletar sintoma'),
('22222222-2222-2222-2222-222222222205', 1, 'Verificar conexão física', 'Peça para verificar se a impressora está ligada, com papel e cabos conectados.', 'Validar fisicamente'),
('22222222-2222-2222-2222-222222222205', 2, 'Encaminhar para Repros', 'Explicar que impressoras são geridas pela Repros e orientar abertura de chamado direto com eles.', 'Direcionar para Repros');

-- Segurança da informação
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222206', 'Incidente de segurança', '11111111-1111-1111-1111-111111111101', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222206', 0, 'Identificar sintoma suspeito', 'Pergunte o que o usuário observou: pop-ups, arquivos sumindo, máquina muito lenta, e-mail estranho, conta bloqueada.', 'Coletar sintoma'),
('22222222-2222-2222-2222-222222222206', 1, 'Verificar gatilho', 'Pergunte se clicou em algum link, abriu anexo de e-mail desconhecido ou conectou pendrive recente.', 'Identificar origem'),
('22222222-2222-2222-2222-222222222206', 2, 'Conter o risco', 'Em caso de suspeita de vírus/ransomware, orientar imediatamente a desconectar o cabo de rede e não desligar a máquina.', 'Isolar máquina'),
('22222222-2222-2222-2222-222222222206', 3, 'Abrir chamado urgente', 'Abrir chamado com prioridade alta descrevendo sintoma, gatilho e ações já tomadas.', 'Abrir chamado urgente');

-- Instalação de sistemas
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222207', 'Instalação de software', '11111111-1111-1111-1111-111111111102', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222207', 0, 'Identificar software', 'Pergunte exatamente qual programa precisa ser instalado ou atualizado.', 'Coletar software'),
('22222222-2222-2222-2222-222222222207', 1, 'Verificar versão', 'Pergunte se há uma versão específica necessária ou se serve a mais recente disponível.', 'Coletar versão'),
('22222222-2222-2222-2222-222222222207', 2, 'Coletar justificativa', 'Pergunte para que será usado, como forma de justificar a instalação.', 'Coletar justificativa'),
('22222222-2222-2222-2222-222222222207', 3, 'Abrir chamado', 'Orientar que a instalação será feita pela equipe técnica e abrir chamado com software, versão e justificativa.', 'Abrir chamado');

-- E-mail e comunicação
INSERT INTO flows (id, name, category_id, organization_id) VALUES
('22222222-2222-2222-2222-222222222208', 'Problemas de e-mail', '11111111-1111-1111-1111-111111111103', '01efa1a1-c7bd-41c8-8063-c1872a413cbc');
INSERT INTO flow_steps (flow_id, step_order, title, description, action) VALUES
('22222222-2222-2222-2222-222222222208', 0, 'Classificar problema', 'Pergunte se o problema é envio, recebimento, configuração ou anexo.', 'Classificar sintoma'),
('22222222-2222-2222-2222-222222222208', 1, 'Verificar abrangência', 'Pergunte se acontece com todos os destinatários/remetentes ou só com alguns específicos.', 'Verificar escopo'),
('22222222-2222-2222-2222-222222222208', 2, 'Verificar mudança recente', 'Pergunte se houve mudança recente de senha ou configuração no e-mail.', 'Identificar gatilho'),
('22222222-2222-2222-2222-222222222208', 3, 'Testar webmail', 'Peça para o usuário tentar acessar pelo webmail (navegador) para isolar problema do app local.', 'Testar webmail'),
('22222222-2222-2222-2222-222222222208', 4, 'Abrir chamado se persistir', 'Se não resolver, abrir chamado descrevendo tipo de problema, escopo e tentativas.', 'Abrir chamado');