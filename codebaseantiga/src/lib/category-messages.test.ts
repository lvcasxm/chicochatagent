import { describe, it, expect } from "vitest";
import {
  CATEGORY_MESSAGES,
  CATEGORY_KEYWORDS,
  getCategoryMessage,
} from "./category-messages";

describe("CATEGORY_MESSAGES", () => {
  const entries = Object.entries(CATEGORY_MESSAGES);

  it("toda mensagem começa com 'Olá!' (linguagem padronizada)", () => {
    for (const [cat, msg] of entries) {
      expect(msg, `categoria ${cat}`).toMatch(/^Olá!/);
    }
  });

  it("toda mensagem termina com pergunta (engaja o bot a responder)", () => {
    for (const [cat, msg] of entries) {
      expect(msg.trim().endsWith("?"), `categoria ${cat}: "${msg}"`).toBe(true);
    }
  });

  it("nenhuma mensagem é duplicada entre categorias", () => {
    const messages = entries.map(([, m]) => m);
    const unique = new Set(messages);
    expect(unique.size).toBe(messages.length);
  });

  it("nenhuma mensagem usa o termo interno 'eixo'", () => {
    for (const [cat, msg] of entries) {
      expect(msg.toLowerCase(), `categoria ${cat}`).not.toContain("eixo");
    }
  });

  it("nenhuma mensagem usa o template genérico 'problema relacionado a'", () => {
    for (const [cat, msg] of entries) {
      expect(msg.toLowerCase(), `categoria ${cat}`).not.toContain("problema relacionado a");
    }
  });

  it("cada mensagem contém ao menos uma palavra-chave do seu próprio tema", () => {
    for (const [cat, msg] of entries) {
      const keywords = CATEGORY_KEYWORDS[cat as keyof typeof CATEGORY_KEYWORDS];
      const lower = msg.toLowerCase();
      const hasMatch = keywords.some((kw) => lower.includes(kw.toLowerCase()));
      expect(hasMatch, `categoria "${cat}" deve mencionar uma de: [${keywords.join(", ")}]`).toBe(true);
    }
  });

  it("nenhuma mensagem contém palavras-chave de OUTRA categoria (proteção contra troca)", () => {
    for (const [cat, msg] of entries) {
      const ownKeywords = new Set(
        CATEGORY_KEYWORDS[cat as keyof typeof CATEGORY_KEYWORDS].map((k) => k.toLowerCase()),
      );
      const lower = msg.toLowerCase();

      for (const [otherCat, otherKeywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (otherCat === cat) continue;
        for (const kw of otherKeywords) {
          const kwLower = kw.toLowerCase();
          // Ignora palavras-chave que também são próprias desta categoria
          if (ownKeywords.has(kwLower)) continue;
          // Permite "sistema" aparecer em "sistema SEI" (SEI é o tema, não Instalação)
          if (kwLower === "sistema" && lower.includes("sistema sei")) continue;
          // Permite "TI" como termo genérico em qualquer mensagem
          if (kwLower === "ti") continue;
          expect(
            lower.includes(kwLower),
            `mensagem da categoria "${cat}" não deveria conter "${kw}" (é tema de "${otherCat}")\nmsg: "${msg}"`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("getCategoryMessage", () => {
  it("retorna mensagem específica para categoria conhecida", () => {
    expect(getCategoryMessage("Eixo da Repros", "Manutenção de Impressora")).toBe(
      CATEGORY_MESSAGES["Eixo da Repros"],
    );
  });

  it("usa fallback genérico para categoria desconhecida", () => {
    const msg = getCategoryMessage("Categoria Nova X", "Categoria Nova X");
    expect(msg).toMatch(/^Olá!/);
    expect(msg.toLowerCase()).toContain("categoria nova x");
  });
});
