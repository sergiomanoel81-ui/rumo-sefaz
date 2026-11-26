"""Gera os textos de lei do leitor "Ler a lei" (pasta leis/), artigo por artigo.

Uso (Git Bash, de dentro de ferramentas/):
  PYTHONUTF8=1 python -I gerar_leis.py <cf.md> <ctn.md> <pasta_assets_do_app_lei_seca>

Fontes:
  - CF/88 e CTN: Lex Vade Mecum (github.com/oliveiracarlosadv/Lex-Vade-Mecum).
    Texto das leis = domínio público (Lei 9.610/98, art. 8º, IV); organização do
    acervo = CC BY 4.0. Crédito: "Lex Vade Mecum — Carlos Alexandre Albuquerque
    Oliveira (Lex Tecnologias)". Usamos só o texto da lei e a "Localização";
    as análises do autor ficam de fora.
  - LC 87/96 e LC 123/06: dispositivos do app Lei Seca (texto do Planalto).
  - Lei 7.014/96: dados/lei7014_dispositivos.json (PDF oficial da SEFAZ-BA).
"""
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
CF_MD, CTN_MD, ASSETS = sys.argv[1], sys.argv[2], sys.argv[3]
SAIDA = os.path.join(AQUI, "..", "leis")
os.makedirs(SAIDA, exist_ok=True)
CREDITO_LEX = "Lex Vade Mecum — Carlos Alexandre Albuquerque Oliveira (Lex Tecnologias), CC BY 4.0"
RE_CHAVE = re.compile(r"Art\.\s*(\d+)[º°]?(?:-([A-Z]))?")


def chave(rotulo):
    m = RE_CHAVE.search(rotulo)
    return (m.group(1) + ("-" + m.group(2) if m.group(2) else "")) if m else None


def de_lex(md):
    arts, cur = [], None
    for linha in open(md, encoding="utf-8"):
        s = linha.rstrip("\n")
        if s.startswith("### "):
            cur = None
            titulo = s[4:].strip()
            if re.match(r"^Art\.\s*\d+", titulo):  # corpo permanente (sem ADCT/Preâmbulo)
                cur = {"k": chave(titulo), "a": titulo, "loc": "", "linhas": [], "fim": False}
                arts.append(cur)
            continue
        if cur is None or cur["fim"]:
            continue
        if s.startswith("#### ") or s.startswith("## ") or s.strip() == "---":
            cur["fim"] = True
            continue
        if s.startswith("**Localização:**"):
            cur["loc"] = s.replace("**Localização:**", "").strip()
            continue
        if s.strip():
            cur["linhas"].append(s.replace("**", "").strip())
    out = []
    for a in arts:
        if a["k"] and a["linhas"]:
            out.append({"k": a["k"], "a": a["a"], "loc": a["loc"], "t": "\n".join(a["linhas"])})
    return out


def rotulo_parte(p):
    if re.fullmatch(r"[IVXLC]+(?:-[A-Z])?", p):
        return p + " - "
    if p.startswith("§"):
        return p + " "
    if p.startswith("Parágrafo"):
        return "Parágrafo único. "
    if re.fullmatch(r"[a-z](?:-\d+)?", p):
        return p + ") "
    return p + " "


def de_dispositivos(disp):
    """Reconstrói o texto de cada artigo a partir dos dispositivos (ref + texto)."""
    arts = {}
    ordem = []
    for d in disp:
        partes = [x.strip() for x in d["ref"].split(",")]
        k = chave(partes[0])
        if not k:
            continue
        if k not in arts:
            arts[k] = {"k": k, "a": partes[0], "loc": "", "linhas": []}
            ordem.append(k)
        texto = d["textoOriginal"].strip()
        if len(partes) == 1:
            arts[k]["linhas"].append(f"{partes[0]} {texto}")
        else:
            arts[k]["linhas"].append(rotulo_parte(partes[-1]) + texto)
    return [{"k": a["k"], "a": a["a"], "loc": "", "t": "\n".join(a["linhas"])} for a in (arts[k] for k in ordem)]


def salvar(ident, nome, fonte, credito, artigos):
    caminho = os.path.join(SAIDA, f"{ident}.json")
    json.dump({"id": ident, "nome": nome, "fonte": fonte, "credito": credito, "artigos": artigos},
              open(caminho, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{ident:8} {len(artigos):4} artigos  {os.path.getsize(caminho) // 1024:5} KB")


salvar("cf", "Constituição Federal de 1988", "Planalto, via Lex Vade Mecum", CREDITO_LEX, de_lex(CF_MD))
salvar("ctn", "Código Tributário Nacional (Lei 5.172/66)", "Planalto, via Lex Vade Mecum", CREDITO_LEX, de_lex(CTN_MD))
for ident, arq, nome in (("lc87", "icms.json", "Lei Complementar 87/96 (Lei Kandir — ICMS)"),
                         ("lc123", "simples.json", "Lei Complementar 123/06 (Simples Nacional)")):
    d = json.load(open(os.path.join(ASSETS, arq), encoding="utf-8"))
    salvar(ident, nome, "Planalto (app Lei Seca)", "", de_dispositivos(d["dispositivos"]))
d = json.load(open(os.path.join(AQUI, "dados", "lei7014_dispositivos.json"), encoding="utf-8"))
salvar("lei7014", "Lei 7.014/96 — ICMS da Bahia", "SEFAZ-BA (texto com notas, sem as notas)", "", de_dispositivos(d["dispositivos"]))
