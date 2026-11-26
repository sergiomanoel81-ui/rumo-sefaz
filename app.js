/* ===========================================================================
   Rumo à SEFAZ — lógica do app (roteador + motor do cronograma + telas)
   =========================================================================== */
(function () {
  const S = window.SEFAZ;
  let estado = S.carregarEstado();

  // Migração de conteúdo: adiciona matérias/tópicos novos do edital e atualiza
  // os já existentes, SEM apagar o que a usuária já estudou (tópicos com
  // progresso são preservados; só os ainda 'novo' são substituídos pelos do
  // conteúdo atualizado).
  function migrarConteudo() {
    let mudou = false;
    let next = estado.materias.reduce((mx, m) => Math.max(mx, m.ordem), -1) + 1;
    // 1) matérias faltantes
    S.SEED.materias.forEach((sm) => {
      if (!estado.materias.some((m) => m.nome === sm.nome)) {
        estado.materias.push({
          id: S.uid("mat"), nome: sm.nome, pesoQ: sm.pesoQ, prioridade: "auto", ordem: next++,
          topicos: sm.topicos.map((t, j) => ({ id: S.uid("top"), nome: t, ordem: j, status: "novo", estudadoEm: null })),
        });
        mudou = true;
      }
    });
    // 2) enriquece tópicos quando a versão do conteúdo subiu
    if ((estado.contentVersion || 1) < S.SEED.contentVersion) {
      S.SEED.materias.forEach((sm) => {
        const m = estado.materias.find((x) => x.nome === sm.nome);
        if (!m) return;
        m.pesoQ = sm.pesoQ;
        const mantidos = m.topicos.filter((t) => t.status !== "novo"); // preserva progresso
        const novos = sm.topicos
          .filter((tn) => !mantidos.some((t) => t.nome === tn))
          .map((tn) => ({ id: S.uid("top"), nome: tn, status: "novo", estudadoEm: null }));
        m.topicos = [...mantidos, ...novos].map((t, j) => ({ ...t, ordem: j }));
      });
      estado.contentVersion = S.SEED.contentVersion;
      estado.perfil.planoDia = null; // ids antigos podem não existir mais
      mudou = true;
    }
    if (mudou) S.salvarEstado(estado);
  }
  migrarConteudo();
  // v8: respostas da aba Questões e fila de questões erradas
  if (!Array.isArray(estado.respostas)) estado.respostas = []; // {d, m, f, ok}
  if (!Array.isArray(estado.qErradas)) estado.qErradas = []; // ids de questões

  /* --------------------------- helpers de prioridade ----------------------- */
  const DIAS_NOME = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const TIERS = ["baixa", "media", "alta", "maxima"];
  const TIER_LABEL = { baixa: "Baixa", media: "Média", alta: "Alta", maxima: "Máxima" };
  const TIER_PESO = { baixa: 1, media: 2, alta: 3, maxima: 4 };

  function prioridadeAutomatica(m) {
    if (m.pesoQ >= 15) return "maxima";
    if (m.pesoQ >= 8) return "alta";
    if (m.pesoQ >= 4) return "media";
    return "baixa";
  }
  function prioridadeEfetiva(m) {
    return m.prioridade === "auto" ? prioridadeAutomatica(m) : m.prioridade;
  }
  function pesoNum(m) {
    return TIER_PESO[prioridadeEfetiva(m)];
  }

  /* --------------------------- motor do cronograma ------------------------- */
  // Fila de tópicos pendentes, com rodízio ponderado pela prioridade:
  // matéria "máxima" entra 4x por ciclo, "alta" 3x, etc. (Legislação BA primeiro).
  function ordenarPendentes() {
    // sequência segue a ordem manual das matérias; o peso (prioridade) define
    // quantas vezes cada matéria entra por volta.
    const mats = [...estado.materias].sort((a, b) => a.ordem - b.ordem);
    const filas = mats.map((m) => ({
      m,
      w: pesoNum(m),
      tops: m.topicos
        .filter((t) => t.status !== "concluido")
        .sort((x, y) => x.ordem - y.ordem),
    }));
    // Interleave por rodadas: em cada volta, a rodada 1 passa por todas as
    // matérias (1 tópico cada), a rodada 2 só pelas de peso >= 2, e assim por
    // diante. Isso VARIA as matérias dentro do dia, mas as de maior prioridade
    // reaparecem mais vezes ao longo do ciclo.
    const out = [];
    const maxW = Math.max(1, ...filas.map((f) => f.w));
    const total = filas.reduce((s, f) => s + f.tops.length, 0);
    let guarda = 0;
    while (out.length < total && guarda++ < 10000) {
      let avancou = false;
      for (let round = 1; round <= maxW; round++) {
        for (const f of filas) {
          if (f.w >= round && f.tops.length) {
            out.push({ mat: f.m, top: f.tops.shift() });
            avancou = true;
          }
        }
      }
      if (!avancou) break;
    }
    return out;
  }

  function cicloResumo() {
    // Em uma volta do ciclo: cada matéria pendente aparece pesoNum(m) vezes.
    return [...estado.materias]
      .filter((m) => m.topicos.some((t) => t.status !== "concluido"))
      .sort((a, b) => a.ordem - b.ordem)
      .map((m) => ({ nome: m.nome, n: pesoNum(m) }));
  }

  function planoProximosDias(qtdDias) {
    const fila = ordenarPendentes();
    const porDia = Math.max(1, estado.perfil.topicosPorDia);
    const diasEstudo = estado.perfil.diasEstudo;
    const resultado = [];
    let iso = S.hojeISO();
    let idx = 0;
    let seg = 0;
    while (resultado.length < qtdDias && seg++ < 90) {
      const dow = new Date(iso + "T00:00:00").getDay();
      if (diasEstudo.includes(dow)) {
        const itens = fila.slice(idx, idx + porDia);
        idx += itens.length;
        resultado.push({ iso, dow, itens });
      }
      iso = S.addDiasISO(iso, 1);
    }
    return resultado;
  }

  // Dia que o "Plano de hoje" representa: hoje, se for dia de estudo; senão o próximo.
  function diaDoPlano() {
    let iso = S.hojeISO();
    const dias = estado.perfil.diasEstudo;
    let seg = 0;
    while (!dias.includes(new Date(iso + "T00:00:00").getDay()) && seg++ < 14) {
      iso = S.addDiasISO(iso, 1);
    }
    return iso;
  }
  // Plano fixo do dia: uma vez montado, não troca de tópicos durante o dia —
  // os concluídos continuam aparecendo marcados. Troca só quando vira o dia.
  function planoDeHoje() {
    const dia = diaDoPlano();
    const resolver = (ids) => {
      const itens = [];
      ids.forEach((id) => {
        for (const m of estado.materias) {
          const t = m.topicos.find((x) => x.id === id);
          if (t) { itens.push({ mat: m, top: t }); break; }
        }
      });
      return itens;
    };
    const pd = estado.perfil.planoDia;
    let itens = (pd && pd.data === dia && Array.isArray(pd.ids)) ? resolver(pd.ids) : [];
    if (!itens.length) {
      const ids = ordenarPendentes().slice(0, Math.max(1, estado.perfil.topicosPorDia)).map((x) => x.top.id);
      estado.perfil.planoDia = { data: dia, ids };
      salvar();
      itens = resolver(ids);
    }
    return { dia, itens };
  }

  function estimativaSemanas() {
    const pendentes = ordenarPendentes().length;
    const porSemana = Math.max(1, estado.perfil.topicosPorDia) * estado.perfil.diasEstudo.length;
    return Math.max(0, Math.ceil(pendentes / porSemana));
  }

  function progresso() {
    let total = 0, feitos = 0;
    const porMateria = estado.materias.map((m) => {
      const t = m.topicos.length;
      const f = m.topicos.filter((x) => x.status === "concluido").length;
      total += t; feitos += f;
      return { nome: m.nome, pct: t ? Math.round((f / t) * 100) : 0 };
    });
    return { geral: total ? Math.round((feitos / total) * 100) : 0, porMateria };
  }

  /* --------------------------- estatísticas -------------------------------- */
  function minutosDoDia(iso) {
    return estado.sessoes
      .filter((s) => s.data === iso)
      .reduce((a, s) => a + (s.minutos || 0), 0);
  }
  function streakDias() {
    let streak = 0;
    let iso = S.hojeISO();
    if (minutosDoDia(iso) === 0) iso = S.addDiasISO(iso, -1); // ainda não estudou hoje: conta até ontem
    let guarda = 0;
    while (minutosDoDia(iso) > 0 && guarda++ < 400) {
      streak++;
      iso = S.addDiasISO(iso, -1);
    }
    return streak;
  }
  function fmtMin(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}` : `${m}min`;
  }
  // escapa texto vindo de fora (questões) antes de pôr no HTML
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function minutosUltimosDias(n) {
    let tot = 0;
    for (let i = 0; i < n; i++) tot += minutosDoDia(S.addDiasISO(S.hojeISO(), -i));
    return tot;
  }
  function inicioSemana(iso) { // segunda-feira da semana de iso
    const dow = new Date(iso + "T00:00:00").getDay();
    return S.addDiasISO(iso, -((dow + 6) % 7));
  }
  function nomeMateriaPorId(id) {
    const m = estado.materias.find((x) => x.id === id);
    return m ? m.nome : "";
  }
  // acertos juntando lançamentos manuais (sessões) e respostas da aba Questões
  function acertosPorMateria() {
    const por = {};
    const soma = (nome, q, a) => {
      if (!nome || !q) return;
      por[nome] = por[nome] || { q: 0, a: 0 };
      por[nome].q += q; por[nome].a += a;
    };
    estado.sessoes.forEach((s) => soma(nomeMateriaPorId(s.materiaId), s.questoes || 0, s.acertos || 0));
    estado.respostas.forEach((r) => soma(r.m, 1, r.ok ? 1 : 0));
    return por;
  }
  function acertosGeral() {
    let q = 0, a = 0;
    Object.values(acertosPorMateria()).forEach((x) => { q += x.q; a += x.a; });
    return { q, a, pct: q ? Math.round((a / q) * 100) : null };
  }

  /* --------------------------- revisões ------------------------------------ */
  function agendarRevisoes(topicoId, materiaId) {
    const base = S.hojeISO();
    [1, 7, 15, 30].forEach((d) => {
      estado.revisoes.push({
        id: S.uid("rev"),
        topicoId, materiaId,
        data: S.addDiasISO(base, d),
        feito: false,
      });
    });
  }
  function revisoesPendentes() {
    const hoje = S.hojeISO();
    return estado.revisoes
      .filter((r) => !r.feito && r.data <= hoje)
      .sort((a, b) => a.data.localeCompare(b.data));
  }
  function nomeTopico(id) {
    for (const m of estado.materias) {
      const t = m.topicos.find((x) => x.id === id);
      if (t) return { mat: m.nome, top: t.nome };
    }
    return { mat: "", top: "(tópico removido)" };
  }

  /* --------------------------- util DOM ------------------------------------ */
  function el(id) { return document.getElementById(id); }
  function salvar() { S.salvarEstado(estado); }

  /* ============================ TELA: HOJE ================================= */
  function renderHoje() {
    const nome = esc(estado.perfil.nome || "estudante");
    const hoje = S.hojeISO();
    const meta = estado.perfil.metaDiariaMin;
    const hojeMin = minutosDoDia(hoje);
    const media7 = Math.round(minutosUltimosDias(7) / 7);
    const ac = acertosGeral();
    const prog = progresso();
    const revs = revisoesPendentes();
    const { dia, itens } = planoDeHoje();
    const ehHojeEstudo = dia === hoje;
    const feitos = itens.filter((it) => it.top.status === "concluido").length;

    const tarefasHTML = itens.length
      ? itens.map((it) => `
          <div class="task ${it.top.status === "concluido" ? "done" : ""}" data-top="${it.top.id}">
            <button class="box" aria-label="Marcar tópico">✓</button>
            <div class="txt"><span class="mat">${esc(it.mat.nome)}</span>${esc(it.top.nome)}</div>
          </div>`).join("")
      : `<div class="empty">Tudo em dia por aqui! 🎉</div>`;
    const avisoDescanso = ehHojeEstudo ? "" :
      `<p style="font-size:14px;color:var(--text-3);margin:0 0 6px">Hoje é folga no seu plano. Este é o próximo dia de estudo:</p>`;

    // constância: 4 semanas alinhadas por dia da semana (domingo a sábado)
    const domingoAtual = S.addDiasISO(hoje, -new Date(hoje + "T00:00:00").getDay());
    let heat = "";
    for (let i = 0; i < 28; i++) {
      const iso = S.addDiasISO(domingoAtual, i - 21);
      if (iso > hoje) { heat += `<span style="visibility:hidden"></span>`; continue; }
      const lvl = intensidade(minutosDoDia(iso));
      heat += `<span class="${lvl ? "h" + lvl : ""}${iso === hoje ? " hoje" : ""}" title="${iso.slice(8)}/${iso.slice(5, 7)}"></span>`;
    }
    const ini = inicioSemana(hoje);
    let semanaMin = 0;
    for (let iso = ini; iso <= hoje; iso = S.addDiasISO(iso, 1)) semanaMin += minutosDoDia(iso);
    const metaSemana = Math.max(1, meta * estado.perfil.diasEstudo.length);
    const pctSemana = Math.min(100, Math.round((semanaMin / metaSemana) * 100));

    // últimos 7 dias
    const dias7 = [];
    for (let i = 6; i >= 0; i--) {
      const iso = S.addDiasISO(hoje, -i);
      dias7.push({ iso, min: minutosDoDia(iso), dow: new Date(iso + "T00:00:00").getDay() });
    }
    const maxMin = Math.max(meta, ...dias7.map((d) => d.min), 1);
    const semanaHTML = dias7.map((d) => `
      <div class="col${d.iso === hoje ? " hoje" : ""}" title="${fmtMin(d.min)}">
        <div class="bar-v" style="height:${Math.max(4, Math.round((d.min / maxMin) * 100))}%"></div>
        <span>${"DSTQQSS"[d.dow]}</span>
      </div>`).join("");

    // acertos por matéria
    const porMat = Object.entries(acertosPorMateria()).sort((a, b) => b[1].q - a[1].q).slice(0, 5);
    const acertosHTML = porMat.length
      ? porMat.map(([n, x]) => `
          <div class="ac-row"><span>${esc(n)}</span><span><span class="n">${x.a}/${x.q}</span> <span class="pct">${Math.round((x.a / x.q) * 100)}%</span></span></div>`).join("")
      : `<div class="empty" style="font-size:16px">Responda questões na aba ✏️ Questões pra ver aqui.</div>`;

    const revsHTML = revs.length
      ? revs.slice(0, 4).map((r) => {
          const n = nomeTopico(r.topicoId);
          return `<div class="task"><div class="txt"><span class="mat">${esc(n.mat)}</span>${esc(n.top)}</div></div>`;
        }).join("")
      : `<div class="empty" style="font-size:16px">Sem revisões pra hoje.</div>`;
    const erradasHTML = estado.qErradas.length
      ? `<button class="btn" id="dash-erradas" style="width:100%;margin-top:10px">✏️ Refazer ${estado.qErradas.length} ${estado.qErradas.length === 1 ? "questão errada" : "questões erradas"}</button>`
      : "";

    const progHTML = prog.porMateria.map((p) => `
        <div class="row-prog">
          <span class="nome">${esc(p.nome)}</span>
          <span class="bar"><span style="width:${p.pct}%"></span></span>
          <span class="pct">${p.pct}%</span>
        </div>`).join("");

    el("view-hoje").innerHTML = `
      <div class="dash-head">
        <h1 class="saudacao">Oi, ${nome}!</h1>
      </div>
      <div class="tiles">
        <div class="tile"><div class="lbl">hoje</div><div class="val">${fmtMin(hojeMin)}</div></div>
        <div class="tile"><div class="lbl">média 7 dias ${hlp("media")}</div><div class="val">${fmtMin(media7)}</div></div>
        <div class="tile"><div class="lbl">acertos ${hlp("acertos")}</div><div class="val">${ac.pct == null ? "—" : ac.pct + "<small>%</small>"}</div></div>
        <div class="tile"><div class="lbl">edital ${hlp("progresso")}</div><div class="val">${prog.geral}<small>%</small></div></div>
      </div>
      <div class="dash-grid">
        <div class="card">
          <h3>Plano recomendado de hoje <span style="font-family:var(--f-hand);font-size:17px;color:var(--text-2)">(${feitos}/${itens.length})</span> ${hlp("hoje")}</h3>
          ${avisoDescanso}
          ${tarefasHTML}
        </div>
        <div class="card">
          <h3>Constância ${hlp("sequencia")}</h3>
          <div class="heat-dow">${["D", "S", "T", "Q", "Q", "S", "S"].map((x) => `<span>${x}</span>`).join("")}</div>
          <div class="heat">${heat}</div>
          <div class="meta-lbl">🔥 ${streakDias()} ${streakDias() === 1 ? "dia seguido" : "dias seguidos"}</div>
          <div class="meta-lbl">meta da semana · ${fmtMin(semanaMin)} de ${fmtMin(metaSemana)}</div>
          <div class="bar"><span style="width:${pctSemana}%"></span></div>
        </div>
      </div>
      <div class="dash-row3">
        <div class="card">
          <h3>Revisões de hoje ${hlp("revisoes")}</h3>
          ${revsHTML}
          ${erradasHTML}
        </div>
        <div class="card">
          <h3>Últimos 7 dias</h3>
          <div class="week">${semanaHTML}</div>
          <div class="meta-lbl" style="margin-top:8px">total: ${fmtMin(minutosUltimosDias(7))}</div>
        </div>
        <div class="card">
          <h3>Acertos por matéria</h3>
          ${acertosHTML}
        </div>
      </div>
      <div class="card">
        <h3>Progresso no edital · ${prog.geral}% ${hlp("progresso")}</h3>
        ${progHTML}
      </div>
    `;

    // marcar / desmarcar tarefa (o check fica marcado no dia)
    el("view-hoje").querySelectorAll(".task[data-top]").forEach((node) => {
      node.querySelector(".box").addEventListener("click", () => {
        toggleTopicoPlano(node.dataset.top);
      });
    });
    const be = el("dash-erradas");
    if (be) be.addEventListener("click", () => { irPara("questoes"); iniciarSessaoQuestoes(true); });
  }

  function toggleTopicoPlano(topId) {
    for (const m of estado.materias) {
      const t = m.topicos.find((x) => x.id === topId);
      if (!t) continue;
      if (t.status === "concluido") {
        // desmarcar: volta a pendente e remove as revisões ainda não feitas desse tópico
        t.status = "estudando";
        t.estudadoEm = null;
        estado.revisoes = estado.revisoes.filter((r) => !(r.topicoId === topId && !r.feito));
      } else {
        t.status = "concluido";
        t.estudadoEm = S.hojeISO();
        agendarRevisoes(t.id, m.id);
      }
      salvar();
      renderHoje();
      return;
    }
  }

  /* ============================ TELA: CRONOGRAMA ========================== */
  function renderCronograma() {
    const p = estado.perfil;
    const matsHTML = [...estado.materias]
      .sort((a, b) => a.ordem - b.ordem)
      .map((m) => {
        const tier = prioridadeEfetiva(m);
        const auto = m.prioridade === "auto" ? " · auto" : "";
        return `
          <div class="mat-row" data-mid="${m.id}">
            <span class="grip" title="Arraste para reordenar">⣿</span>
            <span class="nome">${m.nome}</span>
            <span class="peso">${m.pesoQ}q${auto}</span>
            <button class="badge ${tier}" data-mat="${m.id}">${TIER_LABEL[tier]}</button>
          </div>`;
      }).join("");

    const diasTxt = p.diasEstudo.length === 7 ? "Todos" :
      p.diasEstudo.map((d) => DIAS_NOME[d]).join(" ");

    let planoHTML = "";
    if (p.modo === "ciclo") {
      const resumo = cicloResumo();
      const maxN = 4;
      planoHTML = `<div class="card">
        <h3>Em cada volta do ciclo</h3>
        <p style="font-size:12px;color:var(--text-3);margin:0 0 12px">Quanto maior a prioridade, mais blocos a matéria recebe por volta.</p>
        ${resumo.length ? resumo.map((r) => `
          <div class="ciclo-row">
            <span class="nome">${r.nome}</span>
            <span class="ciclo-bar"><span style="width:${Math.round(r.n / maxN * 100)}%"></span></span>
            <span class="ciclo-n">${r.n}×</span>
          </div>`).join("") : '<div class="empty">Edital concluído 🎉</div>'}
      </div>`;
    } else {
      const dias = planoProximosDias(6);
      planoHTML = `<div class="card"><h3>Próximos dias</h3>${
        dias.map((d) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:12px;color:var(--text-3);margin-bottom:3px">${DIAS_NOME[d.dow]} · ${d.iso.slice(8)}/${d.iso.slice(5,7)}</div>
            ${d.itens.length ? d.itens.map((it) => `<div style="font-size:13px">• ${it.top.nome} <span style="color:var(--text-3)">(${it.mat.nome.split(" ")[0]})</span></div>`).join("") : '<div style="font-size:13px;color:var(--text-3)">livre</div>'}
          </div>`).join("")
      }</div>`;
    }

    el("view-cronograma").innerHTML = `
      <div class="banner">📌 Este é o seu <strong>cronograma recomendado</strong> — montado automaticamente pelos pesos da prova. Tudo aqui é ajustável por você.</div>
      <div class="sec-title">Modo de estudo ${hlp("modo")}</div>
      <div class="seg">
        <button data-modo="ciclo" class="${p.modo === "ciclo" ? "on" : ""}">Ciclo de Estudos</button>
        <button data-modo="semanal" class="${p.modo === "semanal" ? "on" : ""}">Cronograma Semanal</button>
      </div>
      <div class="grid-2">
        <div class="col">
          <div class="card">
            <div class="sec-title">Matérias por prioridade ${hlp("prioridade")}</div>
            <div id="mat-list">${matsHTML}</div>
            <p style="font-size:12px;color:var(--text-3);margin-top:10px">👆 Toque na etiqueta para a prioridade · arraste pelo ⣿ para reordenar.</p>
          </div>
        </div>
        <div class="col">
          <div class="sec-title">Seu ritmo — personalize ${hlp("ritmo")}</div>
          <div class="config">
            <button class="cfg" id="cfg-horas"><div class="k">Horas/dia</div><div class="v">${fmtMin(p.horasPorDiaMin)}</div></button>
            <button class="cfg" id="cfg-dias"><div class="k">Dias</div><div class="v">${diasTxt}</div></button>
            <button class="cfg" id="cfg-top"><div class="k">Tóp/dia</div><div class="v">${p.topicosPorDia}</div></button>
          </div>
          <div class="estimativa">🏁 No seu ritmo, cobre o edital em <strong>~${estimativaSemanas()} semanas</strong> ${hlp("estimativa")}</div>
          ${planoHTML}
        </div>
      </div>
    `;

    // trocar modo
    el("view-cronograma").querySelectorAll(".seg button").forEach((b) =>
      b.addEventListener("click", () => {
        estado.perfil.modo = b.dataset.modo; salvar(); renderCronograma();
      })
    );
    // escolher prioridade (seletor claro)
    el("view-cronograma").querySelectorAll(".badge[data-mat]").forEach((b) =>
      b.addEventListener("click", () => modalPrioridade(b.dataset.mat))
    );
    // config
    el("cfg-horas").addEventListener("click", modalHoras);
    el("cfg-top").addEventListener("click", () =>
      modalNumero("Tópicos por dia de estudo", "Quantos tópicos entram em cada dia do plano.", estado.perfil.topicosPorDia, 1, (v) => {
        estado.perfil.topicosPorDia = v; salvar(); renderCronograma();
      })
    );
    el("cfg-dias").addEventListener("click", editarDias);

    // arrastar para reordenar (SortableJS)
    const lista = el("mat-list");
    if (window.Sortable && lista) {
      window.Sortable.create(lista, {
        handle: ".grip",
        animation: 150,
        onEnd: () => {
          const ids = [...lista.querySelectorAll(".mat-row")].map((r) => r.dataset.mid);
          ids.forEach((id, i) => {
            const m = estado.materias.find((x) => x.id === id);
            if (m) m.ordem = i;
          });
          salvar(); renderCronograma();
        },
      });
    }
  }

  function editarDias() {
    const sel = new Set(estado.perfil.diasEstudo);
    const botoes = DIAS_NOME.map((d, i) => `<button data-d="${i}" class="${sel.has(i) ? "on" : ""}">${d}</button>`).join("");
    const bg = abrirModal(`
      <h3>Dias de estudo</h3><p class="sub">Toque nos dias em que ela estuda.</p>
      <div class="daypick">${botoes}</div>
      <div class="btn-row"><button class="btn" id="mod-cancel" style="flex:1">Cancelar</button><button class="btn primary" id="mod-ok" style="flex:1">Salvar</button></div>
    `);
    bg.querySelectorAll(".daypick button").forEach((b) =>
      b.addEventListener("click", () => {
        const d = +b.dataset.d;
        if (sel.has(d)) sel.delete(d); else sel.add(d);
        b.classList.toggle("on");
      })
    );
    bg.querySelector("#mod-cancel").addEventListener("click", fecharModal);
    bg.querySelector("#mod-ok").addEventListener("click", () => {
      if (sel.size) { estado.perfil.diasEstudo = [...sel].sort(); salvar(); renderCronograma(); }
      fecharModal();
    });
  }

  /* ============================ TELA: REGISTRAR =========================== */
  function renderRegistrar() {
    el("view-registrar").innerHTML = `
      <div class="grid-2">
        <div class="col">
          <div class="card">
            <h3>Cronômetro ${hlp("cronometro")}</h3>
            <div class="timer">
              <div class="big" id="timer-disp">00:00</div>
              <div class="ctrls">
                <button class="btn primary" id="t-start" style="width:auto">Iniciar</button>
                <button class="btn" id="t-zero">Zerar</button>
              </div>
            </div>
            <div id="t-salvar" style="display:none;margin-top:12px">
              ${selectMateriaTopico("t")}
              <button class="btn ok" id="t-save" style="width:100%;margin-top:12px">Salvar sessão</button>
            </div>
          </div>
        </div>
        <div class="col">
          <div class="card">
            <h3>Lançamento manual ${hlp("manual")}</h3>
            ${selectMateriaTopico("m")}
            <label>Minutos estudados</label>
            <input type="number" id="m-min" min="0" placeholder="ex.: 40" />
            <div style="display:flex;gap:10px">
              <div style="flex:1"><label>Questões</label><input type="number" id="m-q" min="0" placeholder="0" /></div>
              <div style="flex:1"><label>Acertos</label><input type="number" id="m-a" min="0" placeholder="0" /></div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
              <input type="checkbox" id="m-concluir" style="width:auto" /> marcar tópico como concluído
            </label>
            <button class="btn primary" id="m-save" style="margin-top:12px">Salvar lançamento</button>
          </div>
        </div>
      </div>
    `;
    ligarSelectMateriaTopico("t");
    ligarSelectMateriaTopico("m");

    // cronômetro (o mesmo do botão flutuante; continua rodando entre telas)
    atualizaTimer();
    el("t-start").addEventListener("click", toggleTimer);
    el("t-zero").addEventListener("click", zerarTimer);
    el("t-save").addEventListener("click", salvarSessaoTimer);

    // manual
    el("m-save").addEventListener("click", salvarManual);
  }

  function selectMateriaTopico(pfx) {
    const opts = estado.materias.map((m) => `<option value="${m.id}">${m.nome}</option>`).join("");
    return `
      <label>Matéria</label>
      <select id="${pfx}-mat">${opts}</select>
      <label>Tópico</label>
      <select id="${pfx}-top"></select>`;
  }
  function ligarSelectMateriaTopico(pfx) {
    const selMat = el(`${pfx}-mat`), selTop = el(`${pfx}-top`);
    function popularTopicos() {
      const m = estado.materias.find((x) => x.id === selMat.value);
      selTop.innerHTML = (m ? m.topicos : [])
        .map((t) => `<option value="${t.id}">${t.status === "concluido" ? "✓ " : ""}${t.nome}</option>`)
        .join("");
    }
    selMat.addEventListener("change", popularTopicos);
    popularTopicos();
  }

  // Cronômetro baseado em horário (não em contagem), salvo no estado:
  // sobrevive a troca de tela, app em segundo plano e recarregar a página.
  let timerTick = null;
  function timerObj() {
    if (!estado.perfil.timer) estado.perfil.timer = { inicio: null, acum: 0 };
    return estado.perfil.timer;
  }
  function timerRodando() { return !!timerObj().inicio; }
  function timerSegs() {
    const t = timerObj();
    return Math.max(0, Math.floor(t.acum + (t.inicio ? (Date.now() - t.inicio) / 1000 : 0)));
  }
  function garantirTick() {
    if (timerRodando() && !timerTick) timerTick = setInterval(atualizaTimer, 1000);
    if (!timerRodando() && timerTick) { clearInterval(timerTick); timerTick = null; }
  }
  function atualizaTimer() {
    const s = timerSegs();
    const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const txt = (h ? `${h}:${String(mm).padStart(2, "0")}` : String(mm).padStart(2, "0")) + ":" + String(ss).padStart(2, "0");
    const d = el("timer-disp"); if (d) d.textContent = txt;
    const ft = el("float-timer"); if (ft) ft.classList.toggle("rodando", timerRodando());
    const ftt = el("ft-txt"); if (ftt) ftt.textContent = (timerRodando() || s > 0) ? txt : "";
    const b = el("t-start"); if (b) b.textContent = timerRodando() ? "Pausar" : (s > 0 ? "Continuar" : "Iniciar");
    const sv = el("t-salvar"); if (sv) sv.style.display = s > 0 ? "block" : "none";
  }
  function iniciaTimer() {
    const t = timerObj();
    if (!t.inicio) { t.inicio = Date.now(); salvar(); }
    garantirTick(); atualizaTimer();
  }
  function pausaTimer() {
    const t = timerObj();
    if (t.inicio) { t.acum += (Date.now() - t.inicio) / 1000; t.inicio = null; salvar(); }
    garantirTick(); atualizaTimer();
  }
  function zerarTimer() {
    const t = timerObj();
    t.inicio = null; t.acum = 0; salvar();
    garantirTick(); atualizaTimer();
  }
  function toggleTimer() { if (timerRodando()) pausaTimer(); else iniciaTimer(); }
  function salvarSessaoTimer() {
    pausaTimer();
    const min = Math.round(timerSegs() / 60);
    if (min <= 0) { toast("Estude ao menos 1 minuto antes de salvar."); return; }
    registrarSessao(el("t-mat").value, el("t-top").value, min, 0, 0, false);
    zerarTimer();
    toast(`Sessão de ${min}min salva!`);
  }
  function salvarManual() {
    const min = +el("m-min").value || 0;
    const q = +el("m-q").value || 0;
    const a = +el("m-a").value || 0;
    if (min <= 0 && q <= 0) { toast("Informe minutos ou questões."); return; }
    registrarSessao(el("m-mat").value, el("m-top").value, min, q, a, el("m-concluir").checked);
    el("m-min").value = ""; el("m-q").value = ""; el("m-a").value = ""; el("m-concluir").checked = false;
    toast("Lançamento salvo!");
  }
  function registrarSessao(matId, topId, min, q, a, concluir) {
    estado.sessoes.push({ id: S.uid("ses"), data: S.hojeISO(), materiaId: matId, topicoId: topId, minutos: min, questoes: q, acertos: a });
    const m = estado.materias.find((x) => x.id === matId);
    const t = m && m.topicos.find((x) => x.id === topId);
    if (t) {
      if (concluir && t.status !== "concluido") { t.status = "concluido"; t.estudadoEm = S.hojeISO(); agendarRevisoes(t.id, m.id); }
      else if (t.status === "novo") t.status = "estudando";
    }
    salvar();
  }

  /* ============================ TELA: QUESTÕES =========================== */
  // Dois bancos: Cesgranrio (múltipla escolha, provas reais) e Lei Seca
  // (certo/errado: texto original da lei = CERTO; pegadinha = ERRADO).
  let QBANCO = null, qCarregando = null, qSessao = null, qErro = false;
  const Q_POR_SESSAO = 10;
  function carregarQuestoes() {
    if (QBANCO) return Promise.resolve(QBANCO);
    if (!qCarregando) {
      qCarregando = Promise.all([
        fetch("questoes/cesgranrio.json?v=8").then((r) => r.json()),
        fetch("questoes/leiseca.json?v=8").then((r) => r.json()),
      ]).then(([c, l]) => {
        QBANCO = { cesg: c.questoes || [], lei: l.questoes || [] };
        qErro = false;
        return QBANCO;
      }).catch((e) => { qErro = true; qCarregando = null; throw e; });
    }
    return qCarregando;
  }
  function qCfg() {
    if (!estado.perfil.qCfg) estado.perfil.qCfg = { fonte: "cesg", materia: "todas" };
    return estado.perfil.qCfg;
  }
  function embaralhar(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function prepararItem(q) {
    if (q.a) { // Cesgranrio: a primeira alternativa é a correta
      return { tipo: "mc", id: q.id, m: q.m, p: q.p, e: q.e, alts: embaralhar(q.a.map((t, i) => ({ t, certa: i === 0 }))) };
    }
    const usarPegadinha = q.v && q.v.length && Math.random() < 0.55;
    const v = usarPegadinha ? q.v[Math.floor(Math.random() * q.v.length)] : null;
    return { tipo: "ce", id: q.id, m: q.m, l: q.l, r: q.r, o: q.o, afirm: v ? v.t : q.o, certo: !v, expl: v ? v.e : "" };
  }
  function iniciarSessaoQuestoes(soErradas) {
    return carregarQuestoes().then((B) => {
      const cfg = qCfg();
      let pool;
      if (soErradas) {
        const set = new Set(estado.qErradas);
        pool = [...B.cesg, ...B.lei].filter((q) => set.has(q.id));
      } else {
        pool = cfg.fonte === "lei" ? B.lei : B.cesg;
        if (cfg.materia !== "todas") pool = pool.filter((q) => q.m === cfg.materia);
      }
      if (!pool.length) { toast("Não há questões pra essa escolha."); qSessao = null; renderQuestoes(); return; }
      qSessao = { itens: embaralhar(pool).slice(0, Q_POR_SESSAO).map(prepararItem), i: 0, acertos: 0, resp: null, fim: false, erradas: !!soErradas };
      renderQuestoes();
    }).catch(() => { renderQuestoes(); });
  }
  function fmtEnun(txt) {
    let h = esc(txt);
    h = h.replace(/```[a-z]*\n?([\s\S]*?)```/gi, (_, c) => `<pre>${c.replace(/\n/g, "&#10;")}</pre>`);
    h = h.replace(/`([^`]+)`/g, '<span class="fonte-txt">$1</span>');
    h = h.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    return h.replace(/\n/g, "<br>");
  }
  function registrarResposta(item, ok) {
    estado.respostas.push({ d: S.hojeISO(), m: item.m, f: item.tipo === "mc" ? "cesg" : "lei", ok });
    const i = estado.qErradas.indexOf(item.id);
    if (!ok && i < 0) estado.qErradas.push(item.id);
    if (ok && i >= 0) estado.qErradas.splice(i, 1);
    salvar();
  }
  function responder(valor) {
    const s = qSessao;
    if (!s || s.resp !== null) return;
    const it = s.itens[s.i];
    const ok = it.tipo === "mc" ? !!it.alts[valor].certa : (valor === "certo") === it.certo;
    s.resp = valor;
    if (ok) s.acertos++;
    registrarResposta(it, ok);
    renderQuestoes();
  }
  function proximaQuestao() {
    const s = qSessao;
    if (!s) return;
    if (s.i + 1 >= s.itens.length) s.fim = true;
    else { s.i++; s.resp = null; }
    renderQuestoes();
  }

  function renderQuestoes() {
    const v = el("view-questoes");
    if (!QBANCO) {
      v.innerHTML = qErro
        ? `<div class="card"><div class="empty">Não consegui carregar as questões. Verifique a conexão e toque de novo na aba.</div></div>`
        : `<div class="card"><div class="empty">Abrindo o banco de questões…</div></div>`;
      if (!qErro) carregarQuestoes().then(renderQuestoes).catch(renderQuestoes);
      else { qErro = false; }
      return;
    }
    if (qSessao && qSessao.fim) return renderResultadoQ(v);
    if (qSessao) return renderQuestaoAtual(v);
    renderSetupQ(v);
  }

  function renderSetupQ(v) {
    const cfg = qCfg();
    const banco = cfg.fonte === "lei" ? QBANCO.lei : QBANCO.cesg;
    const cont = {};
    banco.forEach((q) => { cont[q.m] = (cont[q.m] || 0) + 1; });
    if (cfg.materia !== "todas" && !cont[cfg.materia]) cfg.materia = "todas";
    const chips = [`<button class="q-chip ${cfg.materia === "todas" ? "on" : ""}" data-m="todas">Todas <small>(${banco.length})</small></button>`]
      .concat(Object.keys(cont).sort().map((m) => `<button class="q-chip ${cfg.materia === m ? "on" : ""}" data-m="${esc(m)}">${esc(m)} <small>(${cont[m]})</small></button>`))
      .join("");
    v.innerHTML = `
      <div class="q-wrap">
        <div class="banner">✏️ Escolha o tipo de questão e a matéria. Suas respostas entram nos <strong>acertos</strong> do painel, e as erradas ficam guardadas pra você refazer.</div>
        <div class="sec-title">Tipo de questão ${hlp("questoes")}</div>
        <div class="q-fontes">
          <button class="q-fonte ${cfg.fonte === "cesg" ? "on" : ""}" data-f="cesg"><span class="t">Estilo da banca</span><span class="d">Múltipla escolha · provas reais da Cesgranrio (${QBANCO.cesg.length})</span></button>
          <button class="q-fonte ${cfg.fonte === "lei" ? "on" : ""}" data-f="lei"><span class="t">Lei seca</span><span class="d">Certo ou errado · CF, CTN, ICMS e Simples (${QBANCO.lei.length} artigos)</span></button>
        </div>
        <div class="sec-title">Matéria</div>
        <div class="q-chips">${chips}</div>
        <button class="btn primary" id="q-start">Começar ${Q_POR_SESSAO} questões</button>
        ${estado.qErradas.length ? `<button class="btn" id="q-erradas" style="width:100%;margin-top:12px">Refazer as erradas (${estado.qErradas.length})</button>` : ""}
        <p class="q-credito">Questões da Cesgranrio: projeto QuestoesDeConcursoBot (GPL-3.0). Lei seca: app Lei Seca. Detalhes na aba Sobre.</p>
      </div>`;
    v.querySelectorAll(".q-fonte").forEach((b) => b.addEventListener("click", () => {
      cfg.fonte = b.dataset.f; cfg.materia = "todas"; salvar(); renderQuestoes();
    }));
    v.querySelectorAll(".q-chip").forEach((b) => b.addEventListener("click", () => {
      cfg.materia = b.dataset.m; salvar(); renderQuestoes();
    }));
    el("q-start").addEventListener("click", () => iniciarSessaoQuestoes(false));
    const be = el("q-erradas");
    if (be) be.addEventListener("click", () => iniciarSessaoQuestoes(true));
  }

  function renderQuestaoAtual(v) {
    const s = qSessao, it = s.itens[s.i], resp = s.resp, respondida = resp !== null;
    let corpo, fb = "";
    if (it.tipo === "mc") {
      const alts = it.alts.map((a, i) => {
        let cls = "";
        if (respondida && a.certa) cls = "certa";
        else if (respondida && i === resp) cls = "errada";
        return `<button class="q-alt ${cls}" data-i="${i}" ${respondida ? "disabled" : ""}><span class="letra">${"ABCDE"[i] || i + 1})</span><span>${esc(a.t)}</span></button>`;
      }).join("");
      corpo = `<div class="q-enun">${fmtEnun(it.e)}</div><div class="q-alts">${alts}</div>`;
      if (respondida) {
        const ok = !!it.alts[resp].certa;
        const iCerta = it.alts.findIndex((a) => a.certa);
        fb = `<div class="q-fb"><span class="tit">${ok ? "Acertou! ✨" : "Não foi dessa vez"}</span>${ok ? "" : `A resposta certa é a <strong>${"ABCDE"[iCerta]}</strong>.`}</div>`;
      }
    } else {
      const clsC = respondida ? (it.certo ? "certa" : (resp === "certo" ? "errada" : "")) : "";
      const clsE = respondida ? (!it.certo ? "certa" : (resp === "errado" ? "errada" : "")) : "";
      corpo = `
        <div class="q-lei-ref">${esc(it.r)} · julgue o texto abaixo:</div>
        <div class="q-afirm">${esc(it.afirm)}</div>
        <div class="q-ce">
          <button class="btn ${clsC}" data-ce="certo" ${respondida ? "disabled" : ""}>Certo</button>
          <button class="btn ${clsE}" data-ce="errado" ${respondida ? "disabled" : ""}>Errado</button>
        </div>`;
      if (respondida) {
        const ok = (resp === "certo") === it.certo;
        fb = it.certo
          ? `<div class="q-fb"><span class="tit">${ok ? "Acertou! ✨" : "Era CERTO"}</span>Esse é exatamente o texto da lei.</div>`
          : `<div class="q-fb"><span class="tit">${ok ? "Acertou, era pegadinha! ✨" : "Pegadinha! Era ERRADO"}</span>${esc(it.expl)}<span class="orig"><strong>Texto original:</strong> ${esc(it.o)}</span></div>`;
      }
    }
    const tag = it.tipo === "mc" ? `Cesgranrio · ${esc(it.p)}` : esc(it.l);
    v.innerHTML = `
      <div class="q-wrap">
        <div class="card">
          <div class="q-head"><span class="q-tag">${tag}</span><span>${s.erradas ? "refazendo erradas · " : ""}${s.i + 1} de ${s.itens.length}</span></div>
          <div style="font-family:var(--f-hand);font-size:16px;color:var(--text-2);margin-bottom:8px">${esc(it.m)}</div>
          ${corpo}
          ${fb}
          <div class="q-foot">
            <span class="placar">acertos: ${s.acertos} de ${s.i + (respondida ? 1 : 0)}</span>
            <span style="display:flex;gap:10px">
              <button class="btn" id="q-sair">Encerrar</button>
              ${respondida ? `<button class="btn primary" id="q-prox" style="width:auto">${s.i + 1 >= s.itens.length ? "Ver resultado" : "Próxima →"}</button>` : ""}
            </span>
          </div>
        </div>
      </div>`;
    v.querySelectorAll(".q-alt").forEach((b) => b.addEventListener("click", () => responder(+b.dataset.i)));
    v.querySelectorAll("[data-ce]").forEach((b) => b.addEventListener("click", () => responder(b.dataset.ce)));
    const bp = el("q-prox"); if (bp) bp.addEventListener("click", proximaQuestao);
    el("q-sair").addEventListener("click", () => {
      if (s.i === 0 && !respondida) { qSessao = null; renderQuestoes(); return; }
      s.fim = true;
      s.itens = s.itens.slice(0, s.i + (respondida ? 1 : 0)); // só as que ela respondeu
      renderQuestoes();
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderResultadoQ(v) {
    const s = qSessao, n = s.itens.length || 1;
    const pct = Math.round((s.acertos / n) * 100);
    const msg = pct >= 80 ? "Mandou muito bem!" : pct >= 60 ? "Bom caminho!" : "Bora revisar!";
    v.innerHTML = `
      <div class="q-wrap">
        <div class="card">
          <div class="q-res">
            <div class="msg">${msg}</div>
            <div class="nota">${s.acertos}/${s.itens.length}</div>
            <div class="meta-lbl">${pct}% de acertos nesta sessão</div>
          </div>
          <div class="btn-row">
            <button class="btn" id="q-novo" style="flex:1">Nova sessão</button>
            ${estado.qErradas.length ? `<button class="btn primary" id="q-refazer" style="flex:1">Refazer erradas (${estado.qErradas.length})</button>` : ""}
          </div>
        </div>
      </div>`;
    el("q-novo").addEventListener("click", () => { qSessao = null; renderQuestoes(); });
    const br = el("q-refazer"); if (br) br.addEventListener("click", () => iniciarSessaoQuestoes(true));
  }

  /* ============================ TELA: REVISÕES =========================== */
  function renderRevisoes() {
    const hoje = S.hojeISO();
    const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    function labelData(iso) {
      if (iso <= hoje) return "Hoje";
      if (iso === S.addDiasISO(hoje, 1)) return "Amanhã";
      const dow = DOW[new Date(iso + "T00:00:00").getDay()];
      return `${dow} ${iso.slice(8)}/${iso.slice(5, 7)}`;
    }
    function ordinal(r) {
      const todas = estado.revisoes
        .filter((x) => x.topicoId === r.topicoId)
        .sort((a, b) => a.data.localeCompare(b.data));
      return todas.findIndex((x) => x.id === r.id) + 1;
    }
    function linha(r, due) {
      const n = nomeTopico(r.topicoId);
      return `<div class="task" data-rev="${r.id}">
        ${due ? '<button class="box">✓</button>' : '<span class="box dash"></span>'}
        <div class="txt"><div class="mat">${n.mat}</div>${n.top}</div>
        <span class="revtag">${ordinal(r)}ª revisão</span>
      </div>`;
    }

    const pend = estado.revisoes.filter((r) => !r.feito).sort((a, b) => a.data.localeCompare(b.data));
    const dueHoje = pend.filter((r) => r.data <= hoje);
    const prox = pend.filter((r) => r.data > hoje);

    const grupos = [];
    prox.forEach((r) => {
      let g = grupos.find((x) => x.data === r.data);
      if (!g) { g = { data: r.data, itens: [] }; grupos.push(g); }
      g.itens.push(r);
    });
    const gruposHTML = grupos.slice(0, 10).map((g) => `
      <div class="rev-group">
        <div class="rev-group-head"><span>${labelData(g.data)}</span><span class="rev-count">${g.itens.length}</span></div>
        ${g.itens.map((r) => linha(r, false)).join("")}
      </div>`).join("");

    el("view-revisoes").innerHTML = `
      <div class="card">
        <h3>Para revisar hoje <span style="color:var(--text-3);font-weight:400">(${dueHoje.length})</span> ${hlp("revisoes")}</h3>
        ${dueHoje.length ? dueHoje.map((r) => linha(r, true)).join("") : '<div class="empty">Nada pendente por enquanto. ✨</div>'}
      </div>
      <div class="card">
        <h3>Agenda de revisões</h3>
        <p style="font-size:12px;color:var(--text-3);margin:0 0 6px">Cada tópico concluído volta pra revisar em <strong>1, 7, 15 e 30 dias</strong>. Por isso o mesmo assunto reaparece em datas diferentes — é de propósito, pra fixar.</p>
        ${grupos.length ? gruposHTML : '<div class="empty">Conforme você conclui tópicos, as revisões aparecem aqui.</div>'}
      </div>
    `;
    el("view-revisoes").querySelectorAll('.task[data-rev] button.box').forEach((box) => {
      const node = box.closest(".task[data-rev]");
      box.addEventListener("click", () => {
        const r = estado.revisoes.find((x) => x.id === node.dataset.rev);
        if (r) { r.feito = true; salvar(); renderRevisoes(); }
      });
    });
  }

  /* ============================ TELA: HISTÓRICO ========================== */
  let histMes = null; // ISO do 1º dia do mês exibido
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  function intensidade(min) {
    if (min <= 0) return 0;
    if (min <= 30) return 1;
    if (min <= 60) return 2;
    if (min <= 120) return 3;
    return 4;
  }
  function melhorSequencia() {
    const dias = [...new Set(estado.sessoes.filter((s) => (s.minutos || 0) > 0).map((s) => s.data))].sort();
    let best = 0, cur = 0, prev = null;
    for (const d of dias) {
      cur = (prev && S.addDiasISO(prev, 1) === d) ? cur + 1 : 1;
      best = Math.max(best, cur); prev = d;
    }
    return best;
  }
  function isoMesDelta(iso, delta) {
    let y = parseInt(iso.slice(0, 4)), m = parseInt(iso.slice(5, 7)) + delta;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return `${y}-${String(m).padStart(2, "0")}-01`;
  }
  function verDia(iso) {
    const ss = estado.sessoes.filter((s) => s.data === iso);
    const titulo = `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    if (!ss.length) { modalInfo(titulo, "Nenhum estudo registrado neste dia."); return; }
    const total = ss.reduce((a, s) => a + (s.minutos || 0), 0);
    const linhas = ss.map((s) => {
      const n = nomeTopico(s.topicoId);
      const q = s.questoes ? ` · ${s.acertos || 0}/${s.questoes}` : "";
      return `<div class="task"><div class="txt"><div class="mat">${n.mat}</div>${n.top}</div><span class="meta">${fmtMin(s.minutos || 0)}${q}</span></div>`;
    }).join("");
    const bg = abrirModal(`<h3>${titulo}</h3><p class="sub">${fmtMin(total)} estudados</p>${linhas}<button class="btn primary" id="info-ok" style="width:100%;margin-top:10px">Fechar</button>`);
    bg.querySelector("#info-ok").addEventListener("click", fecharModal);
  }
  function renderHistorico() {
    if (!histMes) histMes = S.hojeISO().slice(0, 8) + "01";
    const y = parseInt(histMes.slice(0, 4)), mo = parseInt(histMes.slice(5, 7));
    const offset = new Date(y, mo - 1, 1).getDay();
    const diasNoMes = new Date(y, mo, 0).getDate();

    let cells = "";
    for (let i = 0; i < offset; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= diasNoMes; d++) {
      const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const min = minutosDoDia(iso);
      const hoje = iso === S.hojeISO() ? " today" : "";
      cells += `<div class="cal-cell d${intensidade(min)}${hoje}" data-dia="${iso}"><span>${d}</span></div>`;
    }

    const totalMin = estado.sessoes.reduce((a, s) => a + (s.minutos || 0), 0);
    const diasEstudados = new Set(estado.sessoes.filter((s) => (s.minutos || 0) > 0).map((s) => s.data)).size;
    const acG = acertosGeral();
    const pctAc = acG.pct == null ? 0 : acG.pct;

    el("view-historico").innerHTML = `
      <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
        <div class="tile"><div class="lbl">Total</div><div class="val">${fmtMin(totalMin)}</div></div>
        <div class="tile"><div class="lbl">Dias</div><div class="val">${diasEstudados}</div></div>
        <div class="tile"><div class="lbl">Melhor seq.</div><div class="val">🔥 ${melhorSequencia()}</div></div>
        <div class="tile"><div class="lbl">Acertos</div><div class="val">${pctAc}<small>%</small></div></div>
      </div>
      <div class="card">
        <div class="cal-head">
          <button class="cal-nav" id="cal-prev" aria-label="Mês anterior">‹</button>
          <strong>${MESES[mo - 1]} ${y}</strong>
          <button class="cal-nav" id="cal-next" aria-label="Próximo mês">›</button>
        </div>
        <div class="cal-dow">${["D", "S", "T", "Q", "Q", "S", "S"].map((x) => `<span>${x}</span>`).join("")}</div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-legend"><span>menos</span><i class="d1"></i><i class="d2"></i><i class="d3"></i><i class="d4"></i><span>mais</span></div>
        <p style="font-size:12px;color:var(--text-3);margin-top:10px">Toque num dia para ver o que você estudou.</p>
      </div>
    `;
    el("cal-prev").addEventListener("click", () => { histMes = isoMesDelta(histMes, -1); renderHistorico(); });
    el("cal-next").addEventListener("click", () => { histMes = isoMesDelta(histMes, 1); renderHistorico(); });
    el("view-historico").querySelectorAll(".cal-cell[data-dia]").forEach((c) =>
      c.addEventListener("click", () => verDia(c.dataset.dia))
    );
  }

  /* ============================ TELA: SOBRE =============================== */
  function renderSobre() {
    const gerais = [
      ["Língua Portuguesa", 7], ["Direito Constitucional", 5], ["Direito Administrativo", 5],
      ["Direito Tributário", 5], ["Contabilidade Geral", 5], ["Estatística", 5], ["Noções de Igualdade Racial", 3],
    ];
    const linhasGerais = gerais.map(([n, q]) => `<tr><td>${n}</td><td>${q} questões</td></tr>`).join("");
    el("view-sobre").innerHTML = `
      <div class="card">
        <h3>Em que este app se baseia</h3>
        <p style="font-size:14px;color:var(--text-2);line-height:1.6">A lista de matérias e a prioridade de cada uma vêm da <strong>última prova já realizada</strong> para o cargo: concurso <strong>SEFAZ-BA — Agente de Tributos Estaduais</strong>, aplicado pela banca <strong>FGV em 2022</strong> (70 questões objetivas). Os pesos do cronograma seguem quantas questões cada matéria teve nessa prova — não são chutes.</p>
      </div>
      <div class="card">
        <h3>Distribuição da prova — FGV 2022</h3>
        <p style="font-size:13px;color:var(--text-3);margin:0 0 8px">Conhecimentos gerais (35 de 70 questões):</p>
        <table class="sobre-tbl">${linhasGerais}</table>
        <p style="font-size:13px;color:var(--text-2);margin:12px 0 0;line-height:1.6">As <strong>específicas da área de Administração Tributária</strong> (35 questões) são: <strong>Legislação Tributária da Bahia (~25 questões)</strong>, <strong>Noções de Informática</strong> e <strong>Raciocínio Lógico-Matemático</strong>.</p>
      </div>
      <div class="card">
        <h3>Legislação Tributária da Bahia</h3>
        <p style="font-size:14px;color:var(--text-2);line-height:1.6">É o maior peso da prova. Segundo o edital, abrange:</p>
        <ul style="font-size:13px;color:var(--text-2);line-height:1.7;margin:8px 0 0;padding-left:18px">
          <li>ICMS da Bahia — Lei 7.014/1996</li>
          <li>ITCMD — Lei 4.826/1989</li>
          <li>IPVA — Lei 6.348/1991</li>
          <li>Código Tributário do Estado da Bahia — Lei 3.956/1981</li>
          <li>Simples Nacional — LC 123/2006</li>
          <li>Conselho de Fazenda Estadual — Decreto 7.592/1991</li>
        </ul>
      </div>
      <div class="card">
        <h3>Concurso atual (2026)</h3>
        <p style="font-size:14px;color:var(--text-2);line-height:1.6">O concurso de 2026 foi autorizado com cerca de 200 vagas (Auditor e Agente), banca <strong>Cesgranrio</strong>. Até a publicação do edital oficial, o app usa como referência a prova de 2022. <strong>Quando o edital da Cesgranrio sair, as matérias e os pesos serão recalibrados por ele.</strong></p>
      </div>
      <div class="card">
        <h3>Métodos de estudo usados</h3>
        <ul style="font-size:14px;color:var(--text-2);line-height:1.7;margin:0;padding-left:18px">
          <li><strong>Revisão espaçada:</strong> cada tópico volta pra revisão em 1, 7, 15 e 30 dias.</li>
          <li><strong>Ciclo de estudos:</strong> prioriza as matérias pelo peso que tiveram na prova.</li>
          <li><strong>Cronograma semanal:</strong> distribui os tópicos pelos dias de estudo.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Questões e créditos</h3>
        <ul style="font-size:14px;color:var(--text-2);line-height:1.7;margin:0;padding-left:18px">
          <li><strong>Questões da Cesgranrio</strong> (múltipla escolha): provas do Banco do Brasil, Caixa, Eletrobrás, Agerio e Transpetro, do projeto <a href="https://github.com/GabrielRF/QuestoesDeConcursoBot" target="_blank" rel="noopener">QuestoesDeConcursoBot</a>, de Gabriel R. F., licença <strong>GPL-3.0</strong> (o arquivo de questões continua sob essa licença; veja a pasta <code>questoes/</code>).</li>
          <li><strong>Lei seca</strong> (certo/errado): texto oficial do Planalto e pegadinhas do app Lei Seca. O ICMS aqui é a <strong>LC 87/96 (lei federal)</strong>; a Lei 7.014 da Bahia ainda não tem questões.</li>
          <li><strong>Fontes</strong>: Caveat, Patrick Hand e Nunito (SIL OFL 1.1) e Permanent Marker (Apache 2.0). <strong>Arrastar e soltar</strong>: SortableJS (MIT).</li>
        </ul>
      </div>
      <div class="card">
        <h3>Transparência</h3>
        <p style="font-size:14px;color:var(--text-2);line-height:1.6">Este app é uma ferramenta de <strong>organização</strong>, montada a partir de dados públicos da prova anterior. Ele <strong>não substitui o edital oficial</strong> e o conteúdo é um ponto de partida que pode ser editado e ajustado a qualquer momento.</p>
      </div>
    `;
  }

  /* --------------------------- toast simples ------------------------------- */
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.style.cssText = "position:fixed;left:50%;bottom:110px;transform:translateX(-50%) rotate(-1deg);background:#fbe9b7;color:#2b2b2b;border:2px solid #2b2b2b;border-radius:255px 15px 225px 15px/15px 225px 15px 255px;padding:8px 18px;font-family:'Patrick Hand',cursive;font-size:18px;z-index:70;opacity:0;transition:opacity .2s;box-shadow:2px 3px 0 rgba(43,43,43,.14);pointer-events:none";
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = "1";
    setTimeout(() => { t.style.opacity = "0"; }, 1800);
  }

  /* --------------------------- modal --------------------------------------- */
  function fecharModal() {
    const bg = document.getElementById("modal-bg");
    if (bg) bg.remove();
  }
  function abrirModal(innerHTML) {
    fecharModal();
    const bg = document.createElement("div");
    bg.className = "modal-bg"; bg.id = "modal-bg";
    bg.innerHTML = `<div class="modal">${innerHTML}</div>`;
    bg.addEventListener("click", (e) => { if (e.target === bg) fecharModal(); });
    document.body.appendChild(bg);
    return bg;
  }
  function modalNumero(titulo, sub, valor, min, onSave) {
    const bg = abrirModal(`
      <h3>${titulo}</h3><p class="sub">${sub}</p>
      <input type="number" id="mod-num" value="${valor}" min="${min}" />
      <div class="btn-row"><button class="btn" id="mod-cancel" style="flex:1">Cancelar</button><button class="btn primary" id="mod-ok" style="flex:1">Salvar</button></div>
    `);
    const inp = bg.querySelector("#mod-num");
    inp.focus(); inp.select();
    bg.querySelector("#mod-cancel").addEventListener("click", fecharModal);
    bg.querySelector("#mod-ok").addEventListener("click", () => {
      const v = +inp.value;
      if (!isNaN(v)) onSave(Math.max(min, Math.round(v)));
      fecharModal();
    });
  }

  /* --------------------------- ajuda (ⓘ) ----------------------------------- */
  const AJUDA = {
    hoje: { t: "Plano de hoje", d: "São os tópicos que o app escolheu pra você estudar hoje, já priorizando as matérias que mais caem na prova. Terminou um? Toque no quadradinho ✓ pra marcar como concluído." },
    meta: { t: "Meta do dia", d: "Quanto tempo você quer estudar por dia. Você muda isso na aba Cronograma, em \"Horas/dia\"." },
    sequencia: { t: "Sequência 🔥", d: "Quantos dias seguidos você estudou. Estude pelo menos um pouquinho todos os dias pra não zerar a ofensiva!" },
    progresso: { t: "Progresso no edital", d: "A porcentagem do conteúdo que você já concluiu — no total e matéria por matéria. Vai subindo conforme você marca tópicos como estudados." },
    revisoes: { t: "Revisões", d: "Quando você conclui um tópico, o app agenda ele pra você revisar depois (em 1, 7, 15 e 30 dias). Revisar espaçado ajuda a não esquecer." },
    modo: { t: "Ciclo x Semanal", d: "Ciclo de Estudos: uma fila que roda sem parar, ótima pra rotina imprevisível — você estuda o próximo quando dá, sem data fixa. Cronograma Semanal: organiza os tópicos em dias fixos, tipo um calendário." },
    prioridade: { t: "Prioridade das matérias", d: "Começa automática, pelo peso de cada matéria na última prova (Legislação da BA em primeiro). Toque na matéria pra escolher você mesma: Automático, Baixa, Média, Alta ou Máxima. Quanto maior, mais ela aparece no plano." },
    ritmo: { t: "Seu ritmo de estudo", d: "Personalize aqui: quantos minutos por dia (Horas/dia), em quais dias da semana (Dias) e quantos tópicos entram em cada dia (Tóp/dia). O plano e a estimativa recalculam na hora." },
    estimativa: { t: "Estimativa", d: "Quanto tempo falta pra cobrir TODO o edital no seu ritmo atual. Se você aumentar as horas, os dias ou os tópicos por dia, esse prazo diminui." },
    cronometro: { t: "Cronômetro", d: "Conta o tempo enquanto você estuda. Quando terminar, escolha a matéria e o tópico e toque em \"Salvar sessão\"." },
    manual: { t: "Lançamento manual", d: "Estudou sem usar o cronômetro? Registre aqui os minutos e as questões que você fez. Dá pra marcar o tópico como concluído de uma vez." },
    media: { t: "Média dos últimos 7 dias", d: "Quanto você estudou por dia, em média, na última semana (contando também os dias sem estudo)." },
    acertos: { t: "Acertos", d: "Sua porcentagem de acertos, somando as questões da aba Questões e as que você lançou à mão no Registrar." },
    questoes: { t: "Tipos de questão", d: "Estilo da banca: múltipla escolha de provas reais da Cesgranrio, pra pegar o jeito da banca. Lei seca: certo ou errado com o texto da lei; às vezes o texto vem certinho, às vezes com uma pegadinha trocada. As que você errar ficam guardadas pra refazer." },
  };
  function hlp(chave) {
    return `<button class="help" data-ajuda="${chave}" aria-label="O que é isso?">i</button>`;
  }
  function modalInfo(t, d) {
    const bg = abrirModal(`<h3>${t}</h3><p class="sub">${d}</p><button class="btn primary" id="info-ok" style="width:100%">Entendi</button>`);
    bg.querySelector("#info-ok").addEventListener("click", fecharModal);
  }
  document.body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ajuda]");
    if (b && AJUDA[b.dataset.ajuda]) { modalInfo(AJUDA[b.dataset.ajuda].t, AJUDA[b.dataset.ajuda].d); }
  });

  function modalPrioridade(matId) {
    const m = estado.materias.find((x) => x.id === matId);
    if (!m) return;
    const auto = prioridadeAutomatica(m);
    const opcoes = [
      { v: "auto", nome: "Automático", tag: `sugerido: ${TIER_LABEL[auto]}` },
      { v: "maxima", nome: "Máxima", tag: "aparece muito" },
      { v: "alta", nome: "Alta", tag: "" },
      { v: "media", nome: "Média", tag: "" },
      { v: "baixa", nome: "Baixa", tag: "aparece pouco" },
    ];
    const botoes = opcoes.map((o) =>
      `<button data-v="${o.v}" class="${m.prioridade === o.v ? "on" : ""}">${o.nome}${o.tag ? `<span class="tag">${o.tag}</span>` : ""}</button>`
    ).join("");
    const bg = abrirModal(`
      <h3>Prioridade</h3><p class="sub">${m.nome}</p>
      <div class="pick">${botoes}</div>
    `);
    bg.querySelectorAll(".pick button").forEach((b) =>
      b.addEventListener("click", () => {
        m.prioridade = b.dataset.v; salvar(); fecharModal(); renderCronograma();
      })
    );
  }

  function modalHoras() {
    let val = estado.perfil.horasPorDiaMin;
    const presets = [30, 60, 90, 120, 150, 180, 240];
    const presetHTML = presets.map((p) => `<button data-min="${p}">${fmtMin(p)}</button>`).join("");
    const bg = abrirModal(`
      <h3>Horas de estudo por dia</h3><p class="sub">Também vira sua meta diária. Toque num valor ou ajuste nos botões.</p>
      <div class="timer"><div class="big" id="h-disp" style="font-size:38px">${fmtMin(val)}</div>
        <div class="ctrls"><button class="btn" id="h-menos">− 15min</button><button class="btn" id="h-mais">+ 15min</button></div>
      </div>
      <div class="daypick" style="margin-top:12px">${presetHTML}</div>
      <div class="btn-row"><button class="btn" id="mod-cancel" style="flex:1">Cancelar</button><button class="btn primary" id="mod-ok" style="flex:1">Salvar</button></div>
    `);
    const disp = bg.querySelector("#h-disp");
    const upd = () => { disp.textContent = fmtMin(val); };
    bg.querySelector("#h-menos").addEventListener("click", () => { val = Math.max(15, val - 15); upd(); });
    bg.querySelector("#h-mais").addEventListener("click", () => { val = Math.min(720, val + 15); upd(); });
    bg.querySelectorAll(".daypick button").forEach((b) => b.addEventListener("click", () => { val = +b.dataset.min; upd(); }));
    bg.querySelector("#mod-cancel").addEventListener("click", fecharModal);
    bg.querySelector("#mod-ok").addEventListener("click", () => {
      estado.perfil.horasPorDiaMin = val; estado.perfil.metaDiariaMin = val; salvar(); fecharModal(); renderCronograma();
    });
  }

  /* --------------------------- roteador ------------------------------------ */
  const RENDER = { hoje: renderHoje, cronograma: renderCronograma, questoes: renderQuestoes, registrar: renderRegistrar, revisoes: renderRevisoes, historico: renderHistorico, sobre: renderSobre };
  function irPara(view) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    el("view-" + view).classList.add("active");
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    (RENDER[view] || renderHoje)();
    window.scrollTo(0, 0);
  }
  document.getElementById("nav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) irPara(b.dataset.view);
  });
  // cronômetro flutuante: abre a tela Registrar (onde dá pra pausar e salvar)
  el("float-timer").addEventListener("click", () => irPara("registrar"));
  // ao voltar pro app (ex.: tablet desbloqueado), atualiza o relógio na hora
  document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizaTimer(); });

  /* --------------------------- primeiro uso: nome -------------------------- */
  function pedirNome() {
    const bg = abrirModal(`
      <h3>Bem-vinda! 👋</h3><p class="sub">Qual o seu nome? (aparece na tela inicial)</p>
      <input type="text" id="mod-nome" placeholder="seu nome" />
      <div class="btn-row"><button class="btn" id="mod-skip" style="flex:1">Agora não</button><button class="btn primary" id="mod-ok" style="flex:1">Começar</button></div>
    `);
    bg.querySelector("#mod-nome").focus();
    const salvarNome = () => {
      const n = bg.querySelector("#mod-nome").value.trim();
      if (n) { estado.perfil.nome = n; salvar(); renderHoje(); }
      fecharModal();
    };
    bg.querySelector("#mod-ok").addEventListener("click", salvarNome);
    bg.querySelector("#mod-skip").addEventListener("click", fecharModal);
    bg.querySelector("#mod-nome").addEventListener("keydown", (e) => { if (e.key === "Enter") salvarNome(); });
  }
  if (!estado.perfil.nome) setTimeout(pedirNome, 300);

  /* --------------------------- service worker ------------------------------ */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // inicial
  renderHoje();
  garantirTick();
  atualizaTimer();
})();
