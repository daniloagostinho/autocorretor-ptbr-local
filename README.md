# Autocorretor PT-BR Local

Projeto simples para autocorrecao de texto em portugues brasileiro, rodando local.

## O que ele faz

- Corrige automaticamente enquanto voce digita
- Aplica ortografia e acentuacao automaticamente
- Pode aplicar pontuacao automatica (toggle na tela)
- Mostra as ultimas alteracoes feitas
- Permite copiar o texto final com um clique

## Stack

- Node.js + Express
- Frontend HTML/CSS/JS puro
- LanguageTool
  - Prioridade: instancia local via Docker
  - Fallback: API publica gratuita do LanguageTool

## Requisitos

- Node.js 18+
- Opcional: Docker (para rodar o LanguageTool local)

## Como rodar

1. Instale dependencias:

```bash
npm install
```

2. (Opcional) Suba LanguageTool local com Docker:

```bash
docker compose up -d
```

3. Rode o app:

```bash
npm start
```

4. Abra no navegador:

- http://localhost:3000

## Configuracao (opcional)

Crie um arquivo `.env` com:

```env
PORT=3000
LANGUAGETOOL_URL=http://localhost:8010/v2/check
PUBLIC_LANGUAGETOOL_URL=https://api.languagetool.org/v2/check
```

## Observacoes

- Se Docker nao estiver instalado, o sistema tenta usar automaticamente a API publica gratuita.
- Para uso 100% local/offline, instale Docker e rode o LanguageTool local.
