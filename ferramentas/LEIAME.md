# Ferramentas de conteúdo

Scripts que geram os dados do app (rodam no PC, fora do app). Use Git Bash com `PYTHONUTF8=1`.

| Script | Gera | Entradas |
|---|---|---|
| `gerar_lei7014.py` | `dados/lei7014_dispositivos.json` | PDF oficial da Lei 7.014/96 (SEFAZ-BA) + gerador de pegadinhas do app Lei Seca |
| `gerar_questoes.py` | `../questoes/cesgranrio.json` e `../questoes/leiseca.json` | `dados/cesgranrio_yaml/`, assets do Lei Seca, `dados/lei7014_dispositivos.json` |
| `gerar_leis.py` | `../leis/*.json` (leitor "Ler a lei") | CF e CTN do Lex Vade Mecum, assets do Lei Seca, `dados/lei7014_dispositivos.json` |

## Ordem para regenerar

```bash
curl -sfL https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf -o lei7014.pdf
PYTHONUTF8=1 python -I gerar_lei7014.py lei7014.pdf ../../android/gerador dados/lei7014_dispositivos.json
PYTHONUTF8=1 python -I gerar_questoes.py ../../android/app/src/main/assets
curl -sfL https://raw.githubusercontent.com/oliveiracarlosadv/Lex-Vade-Mecum/main/leis/constituicao-federal/constituicao-federal-completa.md -o cf.md
curl -sfL https://raw.githubusercontent.com/oliveiracarlosadv/Lex-Vade-Mecum/main/leis/ctn/ctn-completa.md -o ctn.md
PYTHONUTF8=1 python -I gerar_leis.py cf.md ctn.md ../../android/app/src/main/assets
```

Depois, suba a versão `?v=N` em `index.html`, `sw.js` e nos `fetch` do `app.js`.

## Observações

- **Lei 7.014:** o texto vigente é separado das notas pelo estilo do PDF (Times 12 = lei; Arial 10 = notas e redações antigas). Dispositivos revogados e trechos truncados no PDF são descartados. As pegadinhas são automáticas (regras do Lei Seca + filtro de qualidade), sem revisão manual.
- **Cesgranrio:** dados do QuestoesDeConcursoBot, licença GPL-3.0 (ver `../questoes/LEIAME.md`).
- **Lex Vade Mecum:** texto das leis em domínio público; organização CC BY 4.0, com crédito no app.
- **Quando sair o edital da Cesgranrio:** ajustar matérias/tópicos/pesos em `../data.js` e subir `CONTENT_VERSION`; a migração do app atualiza sem apagar o progresso.
