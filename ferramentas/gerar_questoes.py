"""Gera os pacotes de questões do app Rumo à SEFAZ (pasta questoes/).

Uso (Git Bash, de dentro de ferramentas/):
  PYTHONUTF8=1 python -I gerar_questoes.py <pasta_assets_do_app_lei_seca>

Entradas:
  dados/cesgranrio_yaml/*.yml      questões da Cesgranrio (QuestoesDeConcursoBot, GPL-3.0)
  <assets do Lei Seca>/*.json      CF, CTN, ICMS (LC 87) e Simples (LC 123)
  dados/lei7014_dispositivos.json  Lei 7.014/96 da Bahia (gerado por gerar_lei7014.py)
Saídas:
  ../questoes/cesgranrio.json e ../questoes/leiseca.json
"""
import json
import os
import sys

import yaml

AQUI = os.path.dirname(os.path.abspath(__file__))
PASTA_Y = os.path.join(AQUI, "dados", "cesgranrio_yaml")
PASTA_L = sys.argv[1]
LEI7014 = os.path.join(AQUI, "dados", "lei7014_dispositivos.json")
SAIDA = os.path.join(AQUI, "..", "questoes")
MAX_CHARS = 600  # dispositivos maiores (ex.: tabelas de multa) ficam fora do quiz

# ---------------- Cesgranrio (QuestoesDeConcursoBot, GPL-3.0) ----------------
PROVAS = {
    "bb21": "Banco do Brasil 2021", "bb22": "Banco do Brasil 2022", "cx21": "Caixa 2021",
    "tp23": "Transpetro 2023", "el22": "Eletrobrás 2022", "ag23": "Agerio 2023",
}
ARQS = {
    "bb21_port.yml": "Língua Portuguesa", "bb22_port.yml": "Língua Portuguesa",
    "cx21_port.yml": "Língua Portuguesa", "tp23_port.yml": "Língua Portuguesa",
    "el22_port.yml": "Língua Portuguesa", "ag23_port.yml": "Língua Portuguesa",
    "bb21_inf.yml": "Noções de Informática", "cx21_inf.yml": "Noções de Informática",
    "bb21_mat.yml": "Raciocínio Lógico-Matemático", "bb22_mat.yml": "Raciocínio Lógico-Matemático",
    "tp23_mat.yml": "Raciocínio Lógico-Matemático",
    "bb22_est.yml": "Estatística",
}
cesg = []
for arq, materia in ARQS.items():
    d = yaml.safe_load(open(os.path.join(PASTA_Y, arq), encoding="utf-8"))
    prova = PROVAS[arq[:4]]
    for i, q in enumerate(d.get("questoes") or []):
        alts = [str(a).strip() for a in (q.get("alternativas") or [])]
        if q.get("imagem") or len(alts) < 4:
            continue
        cesg.append({"id": f"c_{arq[:-4]}_{i}", "m": materia, "p": prova,
                     "e": str(q.get("enunciado", "")).strip(), "a": alts})

json.dump({
    "fonte": "QuestoesDeConcursoBot (github.com/GabrielRF/QuestoesDeConcursoBot)",
    "licenca": "GPL-3.0",
    "nota": "Questões de provas da banca Cesgranrio. A primeira alternativa é a correta.",
    "questoes": cesg,
}, open(os.path.join(SAIDA, "cesgranrio.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

# ---------------- Lei seca ----------------
LEIS = [  # (arquivo, matéria no app, rótulo, prefixo do id)
    (os.path.join(PASTA_L, "cf_principios.json"), "Direito Constitucional", "CF/88", "cf_principios"),
    (os.path.join(PASTA_L, "cf_direitos.json"), "Direito Constitucional", "CF/88", "cf_direitos"),
    (os.path.join(PASTA_L, "cf_penal.json"), "Direito Constitucional", "CF/88", "cf_penal"),
    (os.path.join(PASTA_L, "cf_remedios.json"), "Direito Constitucional", "CF/88", "cf_remedios"),
    (os.path.join(PASTA_L, "cf_nacionalidade.json"), "Direito Constitucional", "CF/88", "cf_nacionalidade"),
    (os.path.join(PASTA_L, "cf_politicos.json"), "Direito Constitucional", "CF/88", "cf_politicos"),
    (os.path.join(PASTA_L, "cf_admin.json"), "Direito Constitucional", "CF/88", "cf_admin"),
    (os.path.join(PASTA_L, "cf_tributario.json"), "Direito Tributário", "CF/88 · Sistema Tributário", "cf_tributario"),
    (os.path.join(PASTA_L, "ctn.json"), "Direito Tributário", "CTN", "ctn"),
    (os.path.join(PASTA_L, "icms.json"), "Legislação Tributária Estadual (BA)", "ICMS · LC 87/96 (lei federal)", "icms"),
    (os.path.join(PASTA_L, "simples.json"), "Legislação Tributária Estadual (BA)", "Simples Nacional · LC 123/06", "simples"),
    (LEI7014, "Legislação Tributária Estadual (BA)", "ICMS-BA · Lei 7.014/96", "icmsba"),
]
lei = []
for caminho, materia, rotulo, pref in LEIS:
    d = json.load(open(caminho, encoding="utf-8"))
    for i, x in enumerate(d.get("dispositivos") or []):
        orig = (x.get("textoOriginal") or "").strip()
        vs = [v for v in (x.get("variantes") or []) if (v.get("texto") or "").strip()]
        if not x.get("relevante") or not orig or not vs or len(orig) > MAX_CHARS:
            continue
        lei.append({
            "id": f"l_{pref}_{i}", "m": materia, "l": rotulo, "r": x.get("ref", ""), "o": orig,
            # "a": 1 = pegadinha gerada automaticamente (sem revisão humana)
            "v": [dict({"t": v["texto"].strip(), "e": (v.get("explicacao") or "").strip()}, **({"a": 1} if v.get("_auto") else {}))
                  for v in vs[:4]],
        })

json.dump({
    "fonte": "App Lei Seca (projeto próprio) + Lei 7.014/96 (texto oficial da SEFAZ-BA)",
    "nota": "Certo/errado: o texto original da lei é CERTO; cada variante é uma pegadinha ERRADA.",
    "questoes": lei,
}, open(os.path.join(SAIDA, "leiseca.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def resumo(nome, itens, chave):
    por = {}
    for q in itens:
        por[q[chave]] = por.get(q[chave], 0) + 1
    print(f"== {nome}: {len(itens)} itens")
    for k, v in sorted(por.items(), key=lambda kv: -kv[1]):
        print(f"   {v:5}  {k}")


resumo("Cesgranrio", cesg, "m")
resumo("Lei seca (por lei)", lei, "l")
for f in ("cesgranrio.json", "leiseca.json"):
    print(f, os.path.getsize(os.path.join(SAIDA, f)) // 1024, "KB")
