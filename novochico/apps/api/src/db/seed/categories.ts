import type { categories } from '../schema';

type CategorySeed = typeof categories.$inferInsert;

export const SONNER_GUIDE_URL =
  'https://drive.google.com/file/d/1f6eROGNl47zhA5zuP925U-1iJGFtUBcA/view?usp=drive_link';
export const JOSEIAS_URL = 'https://joseias.pl.mg.gov.br';
export const SEI_URL = 'https://sei.pedroleopoldo.mg.gov.br';
export const INTRANET_URL = 'https://intra.pl.mg.gov.br';
export const SEI_SUPPORT_EMAIL = 'suporte.sei@pedroleopoldo.mg.gov.br';

/**
 * Cards da tela inicial: SONNET_CONTEXT, Anexo C. Textos e links transcritos do sistema
 * anterior. A ordem de exibição é proposta: os cards "Dúvidas referentes ao SEI" e "Outra
 * coisa?" ficam por último, como no legado.
 *
 * A tela inicial mostra só quatro atalhos, os mais pedidos: computador, senha, GRP Sonner e rede. Os
 * demais cards ficam cadastrados e desativados; a administração (Cards da tela inicial) reativa
 * qualquer um. Desativado some da tela inicial e das sugestões, não do catálogo.
 */
export const CATEGORY_SEEDS: CategorySeed[] = [
  {
    key: 'hardware',
    title: 'Computador e Equipamentos',
    cardDescription: 'Não liga? Está lento? Apresenta erro ou defeito?',
    icon: 'Monitor',
    action: 'chat',
    cannedMessage:
      'Olá! Estou com um problema no meu computador ou equipamento de trabalho — pode estar lento, travando ou apresentando defeito. Pode me ajudar a investigar?',
    shortLabel: 'Computador/equipamento',
    sortOrder: 10,
  },
  {
    key: 'network',
    title: 'Rede e internet',
    cardDescription: 'Conexão lenta ou está sem conexão?',
    icon: 'Globe',
    action: 'chat',
    cannedMessage:
      'Olá! Estou com problemas de conexão com a internet aqui no meu setor. Pode me ajudar a entender o que está acontecendo?',
    shortLabel: 'Internet/rede',
    sortOrder: 40,
  },
  {
    key: 'email',
    title: 'E-mail e comunicação',
    cardDescription: 'Problemas para enviar/receber ou configurar e-mail',
    icon: 'Mail',
    action: 'chat',
    cannedMessage:
      'Olá! Estou com dificuldades no meu e-mail institucional — para enviar, receber ou configurar. Pode me ajudar?',
    shortLabel: 'E-mail institucional',
    sortOrder: 50,
    active: false,
  },
  {
    key: 'security',
    title: 'Segurança da informação',
    cardDescription: 'Suspeita de vírus, bloqueios ou acessos indevidos',
    icon: 'ShieldCheck',
    action: 'chat',
    cannedMessage:
      'Olá! Estou com uma suspeita de segurança na minha máquina — pode ser vírus, bloqueio ou acesso indevido. Pode me ajudar a verificar?',
    shortLabel: 'Segurança/vírus',
    sortOrder: 60,
    active: false,
  },
  {
    key: 'install',
    title: 'Instalação de Programas',
    cardDescription: 'Instalação, atualização ou manutenção de algum sistema usado internamente',
    icon: 'Download',
    action: 'chat',
    cannedMessage:
      'Olá! Preciso de ajuda com a instalação, atualização ou manutenção de um sistema usado internamente. Pode me orientar?',
    shortLabel: 'Instalação de sistema',
    sortOrder: 70,
    active: false,
  },
  {
    key: 'grp',
    title: 'Sistemas GRP Sonner',
    cardDescription: 'Acesso a módulos, senha, erros e sugestões',
    icon: 'FileText',
    action: 'chat',
    cannedMessage: 'Olá! Preciso de ajuda com o sistema GRP/Sonner. Pode me orientar?',
    shortLabel: 'GRP/Sonner',
    sortOrder: 30,
  },
  {
    key: 'printer',
    title: 'Manutenção de Impressora',
    cardDescription: 'Problemas para imprimir ou falha de conexão',
    icon: 'Printer',
    action: 'chat',
    cannedMessage:
      'Olá! Estou com problemas na impressora do meu setor — não está imprimindo ou ficou offline. Pode me ajudar a resolver?',
    shortLabel: 'Impressora',
    sortOrder: 80,
    active: false,
  },
  {
    key: 'password',
    title: 'Acessos e Senhas',
    cardDescription: 'Precisa redefinir senha ou está sem acesso?',
    icon: 'KeyRound',
    action: 'chat',
    cannedMessage:
      'Olá! Preciso de ajuda com minha senha de acesso — não consigo entrar ou gostaria de redefinir. Pode me orientar?',
    shortLabel: 'Redefinição de senha',
    sortOrder: 20,
  },
  {
    key: 'sei',
    title: 'Dúvidas referentes ao SEI',
    cardDescription: 'Atendimento com o Joseias, IA especializada em SEI',
    icon: 'FileText',
    action: 'external_link',
    externalUrl: JOSEIAS_URL,
    shortLabel: 'Dúvida no SEI',
    sortOrder: 90,
    active: false,
  },
  {
    key: 'other',
    title: 'Outra coisa?',
    cardDescription: 'Clique aqui caso queira tratar de algo não listado',
    icon: 'MoreHorizontal',
    action: 'chat',
    cannedMessage:
      'Olá! Tenho uma demanda de TI que não se encaixa nas opções listadas. Pode me ajudar?',
    shortLabel: 'Outro tipo de chamado',
    sortOrder: 100,
    active: false,
  },
  {
    // Sem card: no legado, a categoria existia só para o prompt. A regra agora vive nas
    // instruções (ADR-030); a linha fica para manter o catálogo do Anexo C completo.
    key: 'access',
    title: 'Acesso aos serviços da SATD',
    action: 'hidden',
    sortOrder: 999,
  },
];
