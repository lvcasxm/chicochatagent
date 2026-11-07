/**
 * Sugere a categoria de um card a partir do que a pessoa está digitando (RF-015). Usa só termos
 * inteiros: "sei" não casa com "seixas", nem "rede" com "pedreiro" (correção de B-03 do sistema
 * anterior). A ordem das regras é a prioridade: segurança primeiro, depois os casos físicos de
 * impressora (antes de "instalar"), GRP, instalação e, por fim, as sugestões leves.
 */

const MIN_LENGTH = 6;

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      // Grafias com hífen viram uma palavra só ("e-mail", "wi-fi").
      .replace(/\be mail\b/g, 'email')
      .replace(/\bwi fi\b/g, 'wifi')
  );
}

const RULES: Array<{ key: string; terms: string[] }> = [
  {
    key: 'security',
    terms: [
      'virus',
      'malware',
      'ransomware',
      'trojan',
      'phishing',
      'golpe',
      'hackeado',
      'hackearam',
      'invadiram',
      'invasao',
      'acesso indevido',
      'acesso nao autorizado',
      'conta bloqueada',
      'bloqueio de seguranca',
      'link suspeito',
      'email suspeito',
      'anexo suspeito',
      'antivirus',
    ],
  },
  {
    key: 'printer',
    terms: [
      'papel atolado',
      'atolou papel',
      'atolamento',
      'toner',
      'cartucho',
      'manchando',
      'sem tinta',
      'barulho na impressora',
      'impressora nao liga',
      'instalar a impressora',
      'instalacao da impressora',
      'instalar impressora fisica',
      'configurar impressora na rede',
      'impressora fisica',
    ],
  },
  { key: 'grp', terms: ['sonner', 'grp', 'protocolo grp'] },
  {
    key: 'install',
    terms: [
      'instalar',
      'instalacao',
      'instalando',
      'reinstalar',
      'reinstalacao',
      'atualizar sistema',
      'atualizacao do sistema',
      'update do sistema',
      'instalar programa',
      'instalar software',
      'instalar aplicativo',
      'instalar driver',
      'driver da impressora',
      'spooler',
      'fila de impressao',
      'nao consigo imprimir',
      'impressora nao aparece no computador',
      'adicionar impressora no pc',
      'manutencao do sistema',
      'configurar sistema',
      'licenca do sistema',
    ],
  },
  { key: 'sei', terms: ['sei', 'processo eletronico', 'peticionar'] },
  {
    key: 'password',
    terms: ['senha', 'redefinir senha', 'esqueci a senha', 'sem acesso', 'login'],
  },
  {
    key: 'email',
    terms: ['email', 'outlook', 'webmail', 'thunderbird', 'enviar email', 'receber email'],
  },
  {
    key: 'network',
    terms: ['internet', 'wifi', 'rede', 'sem conexao', 'lenta', 'cabo de rede'],
  },
  {
    key: 'hardware',
    terms: [
      'computador',
      'pc nao liga',
      'tela azul',
      'lento',
      'travando',
      'monitor',
      'teclado',
      'mouse',
    ],
  },
];

/** Chave da categoria sugerida (as do Anexo C), ou nulo se nada se encaixa. */
export function suggestCategoryKey(input: string): string | null {
  if (input.trim().length < MIN_LENGTH) return null;
  // Espaços nas pontas fazem "sei" só casar como palavra inteira.
  const text = ` ${normalize(input)} `;
  for (const { key, terms } of RULES) {
    if (terms.some((term) => text.includes(` ${normalize(term)} `))) return key;
  }
  return null;
}
