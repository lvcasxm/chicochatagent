# Design system do ChicoChat+

Base visual do sistema. Une duas fontes, nesta ordem de autoridade:

1. **A identidade do ChicoChat+** (`SONNET_CONTEXT.md`, seção I; `docs/assets/IdentidadeVisual.pdf`): paleta, logotipo e conceito. Não muda.
2. **O design system do Portal do Cidadão** (documento "Requisição de Ajustes de Interface do Novo Portal", Prefeitura de Pedro Leopoldo): tipografia, espaçamento, raios, movimento, tamanhos e comportamento dos componentes. A Prefeitura ainda não tem um design system único; este é a referência para manter um ecossistema coerente entre os sistemas municipais (ADR-035).

A regra de convivência: **a estrutura vem do Portal; a cor vem do ChicoChat+.** Quem usa o Portal e depois o ChicoChat+ reconhece a mesma família (mesmas fontes, escala, formas, alturas, foco e movimento), e cada sistema mantém a sua marca.

Implementação: `apps/web/src/styles/` (tokens), `apps/web/src/components/`, `apps/web/src/app/layouts/`. A página `/_design` (só em desenvolvimento) mostra tudo nos dois temas.

## O que vem de onde

| Item | Portal do Cidadão | ChicoChat+ (adotado) |
|---|---|---|
| Azul de ação | `#2053c2`, texto branco | `#24BCEC`, texto `#111110` (ADR-025) |
| Azul escuro (menu, hover, foco) | `#163a88` | `#111110` no claro; azul no escuro |
| Texto | `#1b2233`, `#363636`, `#606060` | `#111110` e 68% dele (`--fg-muted`) |
| Fundo | `#ebeef1` com cards `#ffffff` | `#FBFBFB`, superfícies em tom (5% e 8%) |
| Erro e PDF / XML | `#8a1c13` / `#9a5200` | `--danger` e `--warning` (mesmos valores no claro) |
| Gradiente do topo | sim | **não** (seção I.7) |
| Fontes | Montserrat (títulos) e Inter (texto) | iguais, auto-hospedadas |
| Escala de texto, espaçamento, raios, alturas, movimento | definidos | **iguais** |

## Cores

Todos os valores estão em `tokens.css`. Neutros são misturas opacas do texto com o fundo, como as escalas de 90% a 10% do material da marca. Cada combinação de texto, ícone, borda e foco é verificada por teste (`tokens.test.ts`), nos dois temas.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `bg` | `#FBFBFB` | `#111110` | fundo |
| `surface` / `surface-hover` | 5% / 8% | 5% / 8% | cards, composer, hover |
| `border` | 12% | 12% | divisória decorativa |
| `border-strong` | 55% | 40% | borda de campo (≥ 3:1) |
| `fg` / `fg-muted` | `#111110` / 68% | `#FBFBFB` / 68% | texto e texto secundário |
| `accent` | `#24BCEC` | `#24BCEC` | preenchimento, seleção, destaque |
| `accent-fg` | `#111110` | `#111110` | texto e ícone sobre o azul, sempre |
| `link` | `#111110` | `#24BCEC` | link (no claro, sublinhado azul) |
| `focus` | `#111110` | `#24BCEC` | contorno de foco |
| `danger`, `warning` | `#8a1c13`, `#9a5200` | `#ff9b8f`, `#f2a54c` | erro e contingência, sempre com ícone e texto |

Azul sobre `#FBFBFB` tem 2,1:1: **nunca** como texto, ícone ou único indicador no tema claro.

## Tipografia

Estilos com função fixa (`type-*` no Tailwind). Não crie outro tamanho.

| Classe | Fonte, peso | Tamanho / linha | Celular |
|---|---|---|---|
| `type-title-1` | Montserrat 500 | 56 / 64, −2% | 38 / 44 |
| `type-title-2` | Montserrat 500 | 36 / 44, −1% | 30 / 36 |
| `type-title-3` | Montserrat 600 | 20 / 28 | |
| `type-lead` | Inter 400 | 20 / 30 | |
| `type-body` | Inter 400 | 16 / 24 | |
| `type-label` | Inter 500 | 16 / 24 | |
| `type-small` | Inter 400 | 14 / 20 | |
| `type-caption` | Inter 600 | 12 / 16, +2% | |

`--font-display` aponta para a fonte dos títulos: a troca pela Velocity (PEND-09) é num lugar só.

## Forma, espaço e movimento

- **Espaçamento:** múltiplos de 4 px (a escala padrão do Tailwind). 8 px dentro de um item, 24 px do título ao conteúdo, 32 px do conteúdo ao botão, 96 px entre seções.
- **Layout:** conteúdo até 1200 px (`max-w-page`), margem lateral mínima de 24 px, coluna de leitura do chat de 720 px (`max-w-reading`). Pontos de quebra: 576, 640, 896 e 1200 px.
- **Alturas:** botões e campos de 48 px; alvo de toque mínimo de 44 px.
- **Raios:** pílula (`rounded-pill`) para o que é clicável (botões e campos de uma linha); 16 px (`rounded-lg`) para cards, painéis, diálogos e campos de várias linhas; 8 px (`rounded-tag`) para etiquetas; 4 px para detalhes.
- **Bordas:** 1 px em divisórias; 2 px em campos e contornos. Foco: 3 px com afastamento de 2 px.
- **Sombra:** uma só (`shadow-float`), só em quem flutua: diálogo, lista aberta, aviso.
- **Movimento:** 150 ms em cor e opacidade; ícone final do botão avança 4 px no hover; curvas do Portal (`ease-out`, `ease-standard`, `ease-spring`). Com "reduzir movimento", tudo vai a zero.

## Componentes

`Button` e `ButtonLink` (primário, contorno, discreto, destrutivo), `IconButton` (nome obrigatório), `Field` (rótulo, dica e erro ligados ao controle por `aria-describedby`), `Input`, `Textarea`, `Checkbox`, `Select`, `Dialog`, `Tooltip`, `Toast`, `Notice`, `Skeleton`, `EmptyState`, `ErrorState`, `Markdown`, `Logo`, `ProgramMark`, `ThemeSwitch`. Diálogo, lista e dica usam as primitivas do Radix; o resto é próprio.

Regras que valem para todos:

- Alvo de clique é o elemento inteiro, e o rótulo diz o que ele faz. Nada de "Clique aqui".
- Erro fica junto do campo e tem ícone e texto, nunca só cor.
- O ícone de link externo só aparece em link que sai do sistema.
- `Markdown` descarta HTML, não carrega imagem e só cria link `http`, `https` ou `mailto` (RF-013).
- Logotipo: arquivos oficiais, sem recolorir nem distorcer. A versão para cada tema entra por CSS.

## Tema

Segue o sistema e guarda a escolha explícita em `localStorage` (`chico-theme`). `public/theme-init.js` aplica `data-theme` antes da primeira pintura, para não piscar; é um arquivo próprio, sem script em linha, compatível com uma CSP restritiva (F9). Sem JavaScript, a página fica no tema claro.

## Pendências

- **PEND-09:** logotipo em vetor, grafismos exportados do PDF da marca e Velocity licenciada. Sem os vetores, os estados vazios não têm ilustração e o login não usa grafismo.
- O símbolo aparece recortado na sua área útil (o arquivo tem margem interna grande); o recorte é feito por CSS, sem alterar o arquivo.
- Composer do chat (F4): o raio mais generoso que dialoga com o símbolo é definido junto da tela, a partir do `--radius-lg`.
