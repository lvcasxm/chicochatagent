export const SECTORES = [
  "Gabinete do Prefeito",
  "Chefia de Gabinete",
  "Assessoria Executiva",
  "Procuradoria",
  "Controladoria",
  "Secretaria de Governo",
  "Secretaria Adjunta de Transformação Digital",
  "Secretaria Adjunta de Relações Institucionais",
  "Secretaria de Gestão e Finanças",
  "Secretaria Adjunta de Gestão e Administração",
  "Secretaria Adjunta de Finanças e Tesouraria",
  "Secretaria de Saúde",
  "Secretaria Adjunta de Planejamento e Média e Alta Complexidade",
  "Secretaria Adjunta de Atenção Primária e Vigilância em Saúde",
  "Secretaria Adjunta de Gestão Administrativa e Financeira",
  "Secretaria de Educação",
  "Secretaria Adjunta de Educação",
  "Secretaria de Infraestrutura",
  "Secretaria Adjunta de Limpeza Urbana",
  "Secretaria Adjunta de Obras e Serviços Públicos",
  "Secretaria de Bem-Estar",
  "Secretaria Adjunta de Esportes, Lazer e Juventude",
  "Secretaria Adjunta de Cultura e Patrimônio Histórico",
  "Secretaria de Desenvolvimento Social",
  "Secretaria de Segurança",
  "Secretaria de Meio-Ambiente",
  "Secretaria de Desenvolvimento Econômico"
];

export const CPF_REGEX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;

export const maskCPF = (value: string) => {
  return value
    .replace(/\D/g, "")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})/, "$1-$2")
    .replace(/(-\d{2})\d+?$/, "$1");
};

export const validateCPF = (cpf: string) => {
  const cleanCPF = cpf.replace(/\D/g, "");
  if (cleanCPF.length !== 11) return false;
  if (/^(\d)\1+$/.test(cleanCPF)) return false;
  
  let sum = 0;
  let remainder;
  
  for (let i = 1; i <= 9; i++) {
    sum = sum + parseInt(cleanCPF.substring(i - 1, i)) * (11 - i);
  }
  
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCPF.substring(9, 10))) return false;
  
  sum = 0;
  for (let i = 1; i <= 10; i++) {
    sum = sum + parseInt(cleanCPF.substring(i - 1, i)) * (12 - i);
  }
  
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCPF.substring(10, 11))) return false;
  
  return true;
};
