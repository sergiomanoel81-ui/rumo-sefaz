"""Extrai a Lei 7.014/96 (ICMS da Bahia) do PDF oficial "com notas" da SEFAZ-BA
e gera itens de certo/errado (texto original + pegadinhas) no formato do Lei Seca.

Fonte oficial:
  https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf

Uso (Git Bash):
  PYTHONUTF8=1 python -I gerar_lei7014.py lei7014.pdf <pasta_gerador_lei_seca> dados/lei7014_dispositivos.json

Como separa lei vigente de nota: no PDF da SEFAZ o texto vigente está em
Times New Roman 12; as notas e as redações antigas estão em Arial 10 e os
cabeçalhos em tamanho 8-9. O script lê o estilo de cada trecho (PyMuPDF) e
fica só com o texto Times 12 — mais confiável que procurar "Nota:" ou aspas.
Também descarta dispositivos revogados, referências entre parênteses
(ex.: "(LC 87/96 e 102/00)") e textos sem pontuação final (truncados no PDF).
As pegadinhas vêm das regras determinísticas do gerador do Lei Seca (regras.py)
e passam pelo filtro de qualidade dele (limpar_qualidade.ruim), mais um filtro
extra para troca de número dentro do número por extenso. Não há curadoria
manual: por isso o app identifica esses itens como "pegadinhas automáticas".
"""
import json
import re
import sys

import pymupdf

PDF, GERADOR, SAIDA = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, GERADOR)
from regras import gerar_variantes, _span_inicio  # noqa: E402
from limpar_qualidade import ruim, _ANOT, _REVOGADO  # noqa: E402


def linhas_vigentes(caminho):
    """Linhas de texto só com os trechos no estilo da lei vigente (Times ~12pt)."""
    out = []
    for pagina in pymupdf.open(caminho):
        for bloco in pagina.get_text("dict")["blocks"]:
            for linha in bloco.get("lines", []):
                partes = [s["text"] for s in linha["spans"]
                          if "TimesNewRoman" in s["font"] and s["size"] >= 11.5]
                txt = "".join(partes).strip()
                if txt:
                    out.append(txt)
    return out

CABECALHOS = {
    "legest_1996_7014_icmscomnotas.doc",
    "LEI Nº 7.014, DE 04 DE DEZEMBRO DE 1996 – ICMS",
    "LEIS ESTADUAIS",
}
RE_ART_SOLTO = re.compile(r"^Art\.\s*\d+[º°]?(?:-[A-Z])?\.?$")
RE_ART = re.compile(r"^Art\.\s*(\d+)[º°]?(?:-([A-Z]))?\.?\s+(.*)$")
RE_PAR = re.compile(r"^(§\s*\d+[º°]?(?:-[A-Z])?|Parágrafo único)\.?\s*[-–]?\s*(.*)$")
RE_INC = re.compile(r"^([IVXLC]+(?:-[A-Z])?)\.?\s*[-–]\s*(.*)$")
RE_ALI = re.compile(r"^([a-z](?:-\d+)?)\)\s*(.*)$")
RE_NOTA = re.compile(r"^(Nota\b|Redação\b|Redaç|Ver\b|Vide\b)", re.IGNORECASE)
RE_ESTRUT = re.compile(r"^(TÍTULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO|LIVRO)\b")
ASPAS = '"“”'


def n_aspas(s):
    return sum(s.count(c) for c in ASPAS)


def juntar(a, b):
    if a.endswith("-") and len(a) > 1 and a[-2].isalpha() and b[:1].islower():
        return a[:-1] + b  # palavra hifenizada na quebra de linha
    return (a + " " + b).strip()


# ---------- 1) linhas limpas ----------
linhas = []
comecou = False
for raw in linhas_vigentes(PDF):
    s = re.sub(r"\s+", " ", raw.replace("\f", "")).strip()
    if not s or s in CABECALHOS or RE_ART_SOLTO.match(s):
        continue
    if not comecou:
        if RE_ART.match(s):
            comecou = True
        else:
            continue
    linhas.append(s)

# ---------- 2) unidades (artigo / parágrafo / inciso / alínea / nota) ----------
unidades = []
cur = None
for s in linhas:
    if RE_NOTA.match(s):  # segurança extra: as notas já saem pelo filtro de estilo
        cur = {"k": "nota", "t": s}
    elif RE_ESTRUT.match(s):
        cur = {"k": "estrut", "t": s}
    elif RE_ART.match(s):
        m = RE_ART.match(s)
        cur = {"k": "art", "n": m.group(1), "l": m.group(2), "t": m.group(3)}
    elif RE_PAR.match(s):
        m = RE_PAR.match(s)
        cur = {"k": "par", "rot": m.group(1), "t": m.group(2)}
    elif RE_INC.match(s):
        m = RE_INC.match(s)
        cur = {"k": "inc", "rot": m.group(1), "t": m.group(2)}
    elif RE_ALI.match(s):
        m = RE_ALI.match(s)
        cur = {"k": "ali", "rot": m.group(1), "t": m.group(2)}
    else:
        if cur is not None:
            cur["t"] = juntar(cur["t"], s)
        continue
    unidades.append(cur)


# ---------- 3) referências + limpeza ----------
def rotulo_art(n, l):
    base = f"Art. {n}º" if int(n) < 10 else f"Art. {n}"
    return base + (f"-{l}" if l else "")


def rotulo_par(r):
    if r.startswith("Parágrafo"):
        return "Parágrafo único"
    m = re.match(r"§\s*(\d+)[º°]?(-[A-Z])?", r)
    n = int(m.group(1))
    return (f"§ {n}º" if n < 10 else f"§ {n}") + (m.group(2) or "")


def limpar(t):
    t = re.sub(r"^[-–]\s*", "", t.strip())  # "Art. 9º-A. - O contribuinte..."
    t = re.sub(r"\s*\((?:LC|Lei Complementar|Conv[êe]nio|Conv\.|Ajuste)[^)]*\)", "", t)
    t = _ANOT.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([;:.,])", r"\1", t)
    return t


disp = []
truncados = 0
art = par = inc = None
for u in unidades:
    k = u["k"]
    if k in ("nota", "estrut"):
        continue
    if k == "art":
        art, par, inc = rotulo_art(u["n"], u["l"]), None, None
        ref = art
    elif k == "par":
        par, inc = rotulo_par(u["rot"]), None
        ref = f"{art}, {par}"
    elif k == "inc":
        inc = u["rot"]
        ref = ", ".join(x for x in (art, par, inc) if x)
    else:
        ref = ", ".join(x for x in (art, par, inc, u["rot"]) if x)
    texto = limpar(u["t"])
    if not texto or _REVOGADO.match(texto) or re.match(r"^revogad[oa]", texto, re.IGNORECASE):
        continue
    if re.search(r"\b(efeitos até|DOE de|Redação (anterior|original))\b", texto):
        continue  # sobra de nota: não arrisca
    if not re.search(r"[.;:]\s*(?:e|ou)?$", texto):
        truncados += 1
        continue  # sem pontuação final = cortado no PDF; não vira questão
    num = int(re.search(r"\d+", art).group()) if art else 0
    disp.append({"ref": ref, "artigo": num, "textoOriginal": texto, "relevante": True})


def dentro_de_parenteses(orig, novo):
    """True se a troca cai dentro de parênteses (ex.: número por extenso)."""
    i = _span_inicio(orig, novo)
    antes = " ".join(orig.split()[:i + 1])
    return antes.count("(") > antes.count(")")


# ---------- 4) pegadinhas ----------
com_var = 0
removidas = 0
for d in disp:
    t = d["textoOriginal"]
    vs = []
    if len(t.split()) >= 6:
        for v in gerar_variantes(t, max_por_dispositivo=6):
            if ruim(t, v) or (v["tipo"] == "TROCA_NUMERO" and dentro_de_parenteses(t, v["texto"])):
                removidas += 1
                continue
            vs.append({"texto": v["texto"], "tipo": v["tipo"], "explicacao": v["explicacao"], "_auto": True})
            if len(vs) >= 4:
                break
    d["variantes"] = vs
    com_var += 1 if vs else 0

saida = {
    "lei": {
        "id": "icms_ba",
        "sigla": "Lei 7.014/96",
        "nome": "Lei 7.014/1996 — ICMS da Bahia",
        "fonte": "SEFAZ-BA (DITRI) — legest_1996_7014_icmscomnotas.pdf",
    },
    "dispositivos": disp,
}
json.dump(saida, open(SAIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"unidades lidas: {len(unidades)} | dispositivos vigentes: {len(disp)} | truncados descartados: {truncados} | com pegadinha: {com_var} | pegadinhas descartadas pelo filtro: {removidas}")
print("artigos cobertos:", len({d['artigo'] for d in disp}))
