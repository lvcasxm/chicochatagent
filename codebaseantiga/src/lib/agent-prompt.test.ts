import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Testes de regressão do system prompt do agent-chat.
 *
 * Garantem que pedidos típicos de TI (criação de e-mail institucional,
 * acesso a sistemas internos como GRP, cadastro de usuários, etc.) NÃO
 * sejam redirecionados para o Sonner. O Sonner só deve ser mencionado
 * em dois cenários específicos: relato de erro/sugestão na plataforma
 * Sonner e acesso ao guia de Manifestações de Ouvidoria.
 */
const PROMPT_FILE = resolve(
  __dirname,
  "../../supabase/functions/agent-chat/index.ts",
);
const promptSource = readFileSync(PROMPT_FILE, "utf-8");

describe("agent-chat system prompt — escopo SATD vs Sonner", () => {
  it("declara que e-mail institucional é responsabilidade da TI", () => {
    expect(promptSource).toMatch(/e-mails? institucionais?/i);
    expect(promptSource).toMatch(/SATD|TI da Prefeitura/i);
  });

  it("declara que concessão de acesso a sistemas internos (GRP etc.) é da TI", () => {
    expect(promptSource).toMatch(/acesso a sistemas/i);
    expect(promptSource).toMatch(/GRP/);
  });

  it("inclui cadastro/alteração/remoção de usuários como escopo da TI", () => {
    expect(promptSource).toMatch(/usu[áa]rios? em sistemas/i);
  });

  it("restringe Sonner a erro/sugestão na plataforma OU guia de Ouvidoria", () => {
    expect(promptSource).toMatch(/ERRO ou SUGEST[ÃA]O DE MELHORIA/i);
    expect(promptSource).toMatch(/Manifesta[çc][õo]es de Ouvidoria/i);
    expect(promptSource).toMatch(/ÚNICAS EXCE[ÇC][ÕO]ES|UNICAS EXCECOES/i);
  });

  it("proíbe redirecionar pedidos de TI para o Sonner", () => {
    // Frase-chave que reforça a regra
    expect(promptSource).toMatch(/N[ÃA]O redirecione para o Sonner/i);
  });

  it("instrui a abrir chamado para pedidos de TI (marcador OPEN_TICKET_FORM)", () => {
    expect(promptSource).toContain("<<OPEN_TICKET_FORM>>");
  });

  it("mantém regra de redirecionamento exclusivo do SEI para o Joseias", () => {
    expect(promptSource).toContain("https://joseias.pl.mg.gov.br");
  });

  // Exemplos concretos citados pelo usuário — devem estar cobertos pelo prompt
  const casosTI = [
    /e-?mail.*nov[oa]s? servidor/i, // "criar e-mail para nova servidora"
    /sistema de compras/i, // "acesso ao sistema de compras do GRP"
    /cadastr.*usu[áa]rio/i, // "cadastrar usuário no GRP"
  ];

  it.each(casosTI.map((re) => [re.source]))(
    "menciona explicitamente caso de TI: %s",
    (source) => {
      const re = new RegExp(source, "i");
      expect(promptSource).toMatch(re);
    },
  );
});
