// Mensagens automáticas enviadas ao clicar em uma categoria do menu inicial.
// Mantidas centralizadas para evitar duplicação/troca acidental e permitir testes.
//
// Regras (validadas em testes):
// - Toda categoria DEVE ter mensagem única
// - Toda mensagem DEVE começar com "Olá!"
// - Toda mensagem DEVE conter ao menos uma palavra-chave temática da categoria
// - Nenhuma mensagem genérica do tipo "problema relacionado a X"

export type CategoryKey =
  | "Eixo de manutenção/hardware"
  | "Eixo de redes e problemas de internet"
  | "E-mail e comunicação"
  | "Segurança da informação"
  | "Instalação de sistemas"
  | "Eixo de dúvidas referentes ao SEI"
  | "Eixo da Repros"
  | "Eixo de redefinição de senhas"
  | "Eixo de chamados de outros tipos";

export const CATEGORY_MESSAGES: Record<CategoryKey, string> = {
  "Eixo de manutenção/hardware":
    "Olá! Estou com um problema no meu computador ou equipamento de trabalho — pode estar lento, travando ou apresentando defeito. Pode me ajudar a investigar?",
  "Eixo de redes e problemas de internet":
    "Olá! Estou com problemas de conexão com a internet aqui no meu setor. Pode me ajudar a entender o que está acontecendo?",
  "E-mail e comunicação":
    "Olá! Estou com dificuldades no meu e-mail institucional — para enviar, receber ou configurar. Pode me ajudar?",
  "Segurança da informação":
    "Olá! Estou com uma suspeita de segurança na minha máquina — pode ser vírus, bloqueio ou acesso indevido. Pode me ajudar a verificar?",
  "Instalação de sistemas":
    "Olá! Preciso de ajuda com a instalação, atualização ou manutenção de um sistema usado internamente. Pode me orientar?",
  "Eixo de dúvidas referentes ao SEI":
    "Olá! Tenho uma dúvida sobre o sistema SEI — pode ser de acesso, uso ou algum erro. Pode me ajudar?",
  "Eixo da Repros":
    "Olá! Estou com problemas na impressora do meu setor — não está imprimindo ou ficou offline. Pode me ajudar a resolver?",
  "Eixo de redefinição de senhas":
    "Olá! Preciso de ajuda com minha senha de acesso — não consigo entrar ou gostaria de redefinir. Pode me orientar?",
  "Eixo de chamados de outros tipos":
    "Olá! Tenho uma demanda de TI que não se encaixa nas opções listadas. Pode me ajudar?",
};

// Palavras-chave temáticas que devem aparecer na mensagem da categoria
// (proteção contra mensagens trocadas entre categorias).
export const CATEGORY_KEYWORDS: Record<CategoryKey, string[]> = {
  "Eixo de manutenção/hardware": ["computador", "equipamento"],
  "Eixo de redes e problemas de internet": ["internet", "conexão"],
  "E-mail e comunicação": ["e-mail"],
  "Segurança da informação": ["segurança", "vírus"],
  "Instalação de sistemas": ["instalação", "sistema"],
  "Eixo de dúvidas referentes ao SEI": ["SEI"],
  "Eixo da Repros": ["impressora"],
  "Eixo de redefinição de senhas": ["senha"],
  "Eixo de chamados de outros tipos": ["demanda", "TI"],
};

export function getCategoryMessage(name: string, displayTitle: string): string {
  if (name in CATEGORY_MESSAGES) {
    return CATEGORY_MESSAGES[name as CategoryKey];
  }
  return `Olá! Estou com um problema relacionado a ${displayTitle.toLowerCase()}. Pode me ajudar?`;
}
