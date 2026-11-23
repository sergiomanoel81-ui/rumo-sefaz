/* ===========================================================================
   Rumo à SEFAZ — dados e armazenamento
   App de estudos (PWA) para o concurso SEFAZ-BA, Agente de Tributos Estaduais,
   área de Administração Tributária.
   Conteúdo programático fiel ao ANEXO I do edital FGV 2022 (Edital nº 001/2022).
   Tudo fica salvo localmente no aparelho (localStorage). Nada vai pra internet.
   =========================================================================== */

const STORE_KEY = "sefaz_estudo_v1";
const CONTENT_VERSION = 2; // sobe quando o conteúdo (matérias/tópicos) é enriquecido

/* ---- Semente: concurso + matérias + tópicos + pesos (nº de questões) ------
   Baseada na prova FGV 2022 (área Administração Tributária). Editável.         */
const SEED = {
  contentVersion: CONTENT_VERSION,
  concurso: {
    nome: "SEFAZ-BA",
    cargo: "Agente de Tributos Estaduais",
    area: "Administração Tributária",
    banca: "Cesgranrio",
    dataProva: null, // definir quando sair o edital
    refProva: "FGV 2022",
  },
  perfil: {
    nome: "",
    metaDiariaMin: 120,
    horasPorDiaMin: 120,
    topicosPorDia: 3,
    diasEstudo: [1, 2, 3, 4, 5, 6], // 0=Dom ... 6=Sáb
    modo: "ciclo", // "ciclo" | "semanal"
    lembreteEstudo: "19:00",
    notificacoes: false,
    planoDia: null, // { data: ISO, ids: [topicoId...] } — plano fixo do dia
  },
  materias: [
    {
      nome: "Legislação Tributária Estadual (BA)",
      pesoQ: 25,
      topicos: [
        "Simples Nacional — LC 123/2006 (microempresa e EPP)",
        "ICMS-BA (Lei 7.014/1996) — incidência e fato gerador",
        "ICMS-BA — não incidência, isenções e benefícios fiscais",
        "ICMS-BA — base de cálculo e alíquotas",
        "ICMS-BA — sujeito passivo e responsabilidade",
        "ICMS-BA — substituição tributária",
        "ICMS-BA — obrigações acessórias e documentos fiscais",
        "ITCMD-BA — Lei 4.826/1989 (transmissão causa mortis e doação)",
        "IPVA-BA — Lei 6.348/1991",
        "Código Tributário do Estado da Bahia — Lei 3.956/1981",
        "Conselho de Fazenda Estadual (CRF) — Decreto 7.592/1991",
      ],
    },
    {
      nome: "Direito Tributário",
      pesoQ: 5,
      topicos: [
        "Tributo: conceito e classificação (impostos, taxas, contribuições)",
        "Normas gerais e fontes da legislação tributária",
        "Vigência e aplicação da legislação tributária",
        "Interpretação e integração da legislação tributária",
        "Obrigação tributária principal e acessória",
        "Hipótese de incidência e fato gerador",
        "Sujeição ativa e passiva; solidariedade",
        "Capacidade e domicílio tributário",
        "Sistema Tributário Nacional: princípios e limitações ao poder de tributar",
        "Tributos da União, Estados/DF e Municípios",
        "Repartição das receitas tributárias",
      ],
    },
    {
      nome: "Língua Portuguesa",
      pesoQ: 7,
      topicos: [
        "Interpretação e organização do texto; gêneros textuais",
        "Semântica: sentido e emprego de vocábulos; campos semânticos",
        "Emprego de tempos e modos verbais",
        "Morfologia: classes gramaticais e formação de palavras",
        "Sintaxe: frase, oração, período e termos da oração",
        "Coordenação e subordinação",
        "Concordância nominal e verbal",
        "Regência nominal e verbal; transitividade",
        "Colocação pronominal e coesão textual",
        "Ortografia e acentuação gráfica",
        "Emprego da crase e pontuação",
        "Reescrita de frases e variação linguística (norma culta)",
      ],
    },
    {
      nome: "Direito Constitucional",
      pesoQ: 5,
      topicos: [
        "Direitos e deveres individuais e coletivos (art. 5º)",
        "Direitos sociais",
        "Remédios constitucionais (MS, MI, HC, HD, ação popular)",
        "Nacionalidade, cidadania e direitos políticos; partidos",
        "Organização do Estado e divisão de competências",
        "Administração Pública e servidores públicos",
        "Poder Executivo; formas e sistemas de governo",
        "Ministério Público",
        "Defesa do Estado e segurança pública",
        "Ordem social (seguridade, meio ambiente, família, idoso)",
      ],
    },
    {
      nome: "Direito Administrativo",
      pesoQ: 5,
      topicos: [
        "Conceito, fontes e princípios",
        "Administração Pública: conceitos, poderes e organização",
        "Organização administrativa: direta e indireta; (des)centralização",
        "Agentes públicos: regime jurídico, provimento e vacância",
        "Direitos, deveres, regime disciplinar e responsabilidade",
        "Poderes administrativos (incl. poder de polícia)",
        "Ato administrativo: requisitos, atributos e extinção",
        "Serviços públicos e delegação (concessão, permissão, autorização)",
        "Controle da administração e responsabilidade civil do Estado",
        "Improbidade administrativa",
        "Bens públicos",
        "Intervenção do Estado na propriedade privada",
      ],
    },
    {
      nome: "Contabilidade Geral",
      pesoQ: 5,
      topicos: [
        "Conceitos, objetivos e finalidades da contabilidade",
        "Patrimônio: componentes, equação e situação líquida",
        "Atos e fatos administrativos",
        "Contas: débito, crédito e saldos; plano de contas",
        "Escrituração; regime de competência e de caixa",
        "Contabilização de operações diversas (tributos, folha, depreciação)",
        "Balancete de verificação",
        "Balanço patrimonial",
        "Demonstração do resultado do exercício (DRE)",
        "Lei 6.404/1976 e pronunciamentos do CPC",
        "NBC TSP — Estrutura Conceitual (setor público)",
      ],
    },
    {
      nome: "Estatística",
      pesoQ: 5,
      topicos: [
        "Variáveis quantitativas e qualitativas; séries estatísticas",
        "Distribuição de frequências",
        "Medidas de posição (média, moda, mediana, quartis)",
        "Medidas de dispersão (variância, desvio-padrão, CV)",
        "Correlação e regressão linear",
        "Gráficos: histograma, boxplot, dispersão; outliers",
        "Distribuições de probabilidade (binomial e normal)",
        "Inferência: estimação e intervalo de confiança",
        "Testes de hipóteses (médias e proporções)",
        "Técnicas de amostragem",
        "Séries temporais e médias móveis",
      ],
    },
    {
      nome: "Noções de Informática",
      pesoQ: 5,
      topicos: [
        "Componentes do computador (processador, memória, periféricos)",
        "Dispositivos de armazenamento de dados",
        "Arquivos digitais e arquivos PDF",
        "Windows 11: conceitos, utilitários e configurações",
        "Editor de textos (MS Office 2019 / LibreOffice)",
        "Planilhas eletrônicas (Excel / Calc)",
        "Internet: conceitos e funcionamento",
        "Navegadores (Chrome, Firefox, Edge)",
        "E-mail: uso e configurações",
        "Navegação segura: senhas, criptografia e tokens",
        "Segurança da informação: malwares, proteção e prevenção",
      ],
    },
    {
      nome: "Raciocínio Lógico-Matemático",
      pesoQ: 5,
      topicos: [
        "Lógica: proposições, conectivos e equivalências",
        "Quantificadores e predicados",
        "Conjuntos e operações; diagramas",
        "Números inteiros, racionais e reais; porcentagem",
        "Proporcionalidade direta e inversa",
        "Medidas (comprimento, área, volume, massa, tempo)",
        "Estruturas lógicas e relações; dedução",
        "Problemas de lógica e raciocínio sequencial",
        "Problemas de contagem e noções de probabilidade",
        "Compreensão de gráficos e tabelas",
        "Geometria básica (ângulos, triângulos, polígonos, área)",
      ],
    },
    {
      nome: "Noções de Igualdade Racial",
      pesoQ: 3,
      topicos: [
        "CF/88 (arts. 1º, 3º, 4º e 5º) e Constituição da BA (Cap. 'Do Negro')",
        "Estatuto da Igualdade Racial (Lei 12.288/2010)",
        "Crimes de preconceito de raça/cor (Leis 7.716/1989 e 9.459/1997)",
        "Convenção sobre discriminação racial (Dec. 65.810/1969)",
        "Convenção sobre discriminação contra a mulher (Dec. 4.377/2002)",
        "Lei Maria da Penha (Lei 11.340/2006)",
        "Injúria racial (art. 140 CP) e Crime de Tortura (Lei 9.455/1997)",
        "Crime de Genocídio (Lei 2.889/1956) e Lei Caó (Lei 7.437/1985)",
        "Órgãos de promoção da igualdade racial (Leis 10.549/2006 e 10.678/2003)",
      ],
    },
  ],
};

/* --------------------------- utilidades ----------------------------------- */
function uid(p) {
  return (p || "id") + "_" + Math.random().toString(36).slice(2, 9);
}
function hojeISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function addDiasISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* --------------------------- montagem do estado --------------------------- */
function montarEstadoInicial() {
  const materias = SEED.materias.map((m, i) => ({
    id: uid("mat"),
    nome: m.nome,
    pesoQ: m.pesoQ,
    prioridade: "auto", // "auto" | "baixa" | "media" | "alta" | "maxima"
    ordem: i,
    topicos: m.topicos.map((t, j) => ({
      id: uid("top"),
      nome: t,
      ordem: j,
      status: "novo", // "novo" | "estudando" | "concluido"
      estudadoEm: null,
    })),
  }));
  return {
    versao: 1,
    contentVersion: SEED.contentVersion,
    concurso: { ...SEED.concurso },
    perfil: { ...SEED.perfil },
    materias,
    sessoes: [], // {id, data, materiaId, topicoId, minutos, questoes, acertos}
    revisoes: [], // {id, topicoId, materiaId, data, feito}
  };
}

/* --------------------------- persistência --------------------------------- */
function carregarEstado() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Falha ao ler estado:", e);
  }
  const novo = montarEstadoInicial();
  salvarEstado(novo);
  return novo;
}
function salvarEstado(estado) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(estado));
  } catch (e) {
    console.warn("Falha ao salvar estado:", e);
  }
}

window.SEFAZ = {
  STORE_KEY,
  SEED,
  uid,
  hojeISO,
  addDiasISO,
  montarEstadoInicial,
  carregarEstado,
  salvarEstado,
};
