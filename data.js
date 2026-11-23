/* ===========================================================================
   Rumo à SEFAZ — dados e armazenamento
   App de estudos (PWA) para o concurso SEFAZ-BA, Agente de Tributos Estaduais.
   Pesos das matérias baseados na última prova de referência (FGV 2022).
   Tudo fica salvo localmente no aparelho (localStorage). Nada vai pra internet.
   =========================================================================== */

const STORE_KEY = "sefaz_estudo_v1";

/* ---- Semente: concurso + matérias + tópicos + pesos (nº de questões) ------
   Pode ser 100% editado pela usuária. Serve só como ponto de partida.        */
const SEED = {
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
  },
  materias: [
    {
      nome: "Legislação Tributária Estadual (BA)",
      pesoQ: 25,
      topicos: [
        "ICMS-BA — incidência e fato gerador",
        "ICMS-BA — não incidência e isenções",
        "ICMS-BA — base de cálculo e alíquotas",
        "ICMS-BA — substituição tributária",
        "ICMS-BA — obrigações acessórias",
        "RPAF — processo administrativo fiscal",
        "ITD — transmissão causa mortis e doação",
        "IPVA",
        "Taxas estaduais",
      ],
    },
    {
      nome: "Direito Tributário",
      pesoQ: 5,
      topicos: [
        "Competência e limitações ao poder de tributar",
        "Tributos e suas espécies",
        "Obrigação tributária",
        "Crédito tributário",
        "Responsabilidade tributária",
        "Administração tributária",
      ],
    },
    {
      nome: "Língua Portuguesa",
      pesoQ: 7,
      topicos: [
        "Interpretação de textos",
        "Ortografia e acentuação",
        "Classes de palavras",
        "Sintaxe e concordância",
        "Regência e crase",
        "Pontuação",
      ],
    },
    {
      nome: "Direito Constitucional",
      pesoQ: 5,
      topicos: [
        "Princípios fundamentais",
        "Direitos e garantias fundamentais",
        "Organização do Estado",
        "Administração pública",
        "Sistema tributário nacional",
      ],
    },
    {
      nome: "Direito Administrativo",
      pesoQ: 5,
      topicos: [
        "Princípios da administração",
        "Atos administrativos",
        "Poderes administrativos",
        "Agentes públicos",
        "Licitações (Lei 14.133)",
        "Improbidade administrativa",
      ],
    },
    {
      nome: "Contabilidade Geral",
      pesoQ: 5,
      topicos: [
        "Patrimônio e plano de contas",
        "Escrituração e lançamentos",
        "Demonstrações contábeis",
        "Princípios de contabilidade",
      ],
    },
    {
      nome: "Estatística",
      pesoQ: 5,
      topicos: [
        "Medidas de tendência central",
        "Medidas de dispersão",
        "Probabilidade",
        "Distribuições",
      ],
    },
    {
      nome: "Noções de Igualdade Racial",
      pesoQ: 3,
      topicos: [
        "Estatuto da Igualdade Racial",
        "Lei 7.716 (crimes de preconceito)",
        "Convenções e normas correlatas",
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
