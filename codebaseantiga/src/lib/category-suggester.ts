// Sugere uma categoria com base no texto digitado pelo usuário.
// Retorna o rótulo amigável (mesmo usado nos cards da tela inicial) ou null.

export type SuggestedCategory =
  | "Segurança da informação"
  | "Instalação de Programas"
  | "Manutenção de Impressora"
  | "Sistemas GRP Sonner"
  | "Rede e internet"
  | "E-mail e comunicação"
  | "Acessos e Senhas"
  | "Computador e Equipamentos"
  | "Dúvidas referentes ao SEI";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const has = (txt: string, terms: string[]) =>
  terms.some((t) => txt.includes(norm(t)));

export function suggestCategory(input: string): SuggestedCategory | null {
  const t = norm(input || "").trim();
  if (t.length < 6) return null;

  // 1) Segurança da informação — prioridade máxima
  const segurancaTerms = [
    "virus", "malware", "ransomware", "trojan", "phishing", "golpe",
    "hackeado", "hackearam", "invadiram", "invasao", "acesso indevido",
    "acesso nao autorizado", "conta bloqueada", "bloqueio de seguranca",
    "suspeita de virus", "link suspeito", "email suspeito", "anexo suspeito",
    "antivirus",
  ];
  if (has(t, segurancaTerms)) return "Segurança da informação";

  // 2) Casos físicos da impressora (ANTES de "instalação") — não é Instalação de sistemas
  const impressoraFisica = [
    "papel atolado", "atolou papel", "atolamento", "toner", "cartucho",
    "trocar toner", "trocar cartucho", "manchando", "sem tinta",
    "barulho na impressora", "impressora nao liga", "instalar a impressora",
    "instalacao da impressora", "instalar impressora fisica",
    "configurar impressora na rede", "impressora fisica",
  ];
  if (has(t, impressoraFisica)) return "Manutenção de Impressora";

  // 3) Sonner/GRP — sistema de gestão específico (não confundir com "instalação de sistemas")
  const sonnerGrp = ["sonner", "grp", "ouvidoria", "protocolo grp"];
  if (has(t, sonnerGrp)) return "Sistemas GRP Sonner";

  // 4) Instalação de sistemas — software local, inclui driver/spooler de impressora
  const instalacaoTerms = [
    "instalar", "instalacao", "instalando", "reinstalar", "reinstalacao",
    "atualizar sistema", "atualizacao do sistema", "update do sistema",
    "instalar programa", "instalar software", "instalar aplicativo",
    "instalar driver", "driver da impressora", "spooler", "fila de impressao",
    "nao consigo imprimir", "impressora nao aparece no computador",
    "adicionar impressora no pc", "instalar a impressora no meu computador",
    "manutencao do sistema", "configurar sistema", "licenca do sistema",
  ];
  if (has(t, instalacaoTerms)) return "Instalação de Programas";

  // 5) Demais categorias (sugestões leves)
  if (has(t, ["sei", "processo eletronico", "peticionar"])) return "Dúvidas referentes ao SEI";
  if (has(t, ["senha", "redefinir senha", "esqueci a senha", "sem acesso", "login"])) return "Acessos e Senhas";
  if (has(t, ["email", "e-mail", "outlook", "webmail", "thunderbird", "enviar email", "receber email"])) return "E-mail e comunicação";
  if (has(t, ["internet", "wifi", "wi-fi", "rede", "sem conexao", "lenta", "cabo de rede"])) return "Rede e internet";
  if (has(t, ["computador", "pc nao liga", "tela azul", "lento", "travando", "monitor", "teclado", "mouse"])) return "Computador e Equipamentos";

  return null;
}
