# Rumo à SEFAZ

PWA de estudos para o concurso **SEFAZ-BA — Agente de Tributos Estaduais** (banca Cesgranrio).
Cronograma de estudo com pesos baseados na última prova, metas diárias, revisão espaçada e
registro de estudo. Funciona **offline** e guarda tudo **localmente no aparelho**.

## Funcionalidades

- **Hoje** — plano do dia, meta diária, sequência de dias (streak), progresso no edital e revisões do dia.
- **Cronograma** — Ciclo de Estudos ou Cronograma Semanal; matérias priorizadas pelo peso na última
  prova (Legislação Tributária da BA em primeiro); prioridade, horas/dia, dias e tópicos/dia editáveis;
  estimativa de conclusão do edital.
- **Registrar** — cronômetro e lançamento manual de minutos, questões e acertos.
- **Revisões** — repetição espaçada automática (+1, +7, +15 e +30 dias) ao concluir um tópico.

## Como usar

É um PWA. Abra o link do app no navegador (celular, tablet ou computador) e, no menu do navegador,
escolha **"Adicionar à tela inicial" / "Instalar app"**. Depois ele abre como aplicativo e funciona offline.

## Rodar localmente

```
python -m http.server 8750
```

E abra `http://localhost:8750`.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | shell do app |
| `app.js` | roteador, motor do cronograma e telas |
| `data.js` | dados da SEFAZ (matérias, tópicos, pesos) e armazenamento local |
| `styles.css` | estilos (mobile-first, otimizado para tablet) |
| `sw.js` | service worker (offline) |
| `manifest.webmanifest` | manifesto do PWA |

> Conteúdo baseado na prova de referência FGV 2022. A ser recalibrado quando sair o edital da Cesgranrio.
