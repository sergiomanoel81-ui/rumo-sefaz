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
    const nome = estado.perfil.nome ? estado.perfil.nome : "estudante";
    const meta = estado.perfil.metaDiariaMin;
    const hojeMin = minutosDoDia(S.hojeISO());
    const prog = progresso();
    const revs = revisoesPendentes();
    const { dia, itens } = planoDeHoje();
    const ehHojeEstudo = dia === S.hojeISO();
    const feitos = itens.filter((it) => it.top.status === "concluido").length;

    const tarefasHTML = itens.length
      ? itens.map((it) => `
          <div class="task ${it.top.status === "concluido" ? "done" : ""}" data-top="${it.top.id}">
            <button class="box">✓</button>
            <div class="txt"><div class="mat">${it.mat.nome}</div>${it.top.nome}</div>
          </div>`).join("")
      : `<div class="empty">Tudo em dia por aqui 🎉</div>`;

    const avisoDescanso = ehHojeEstudo ? "" :
      `<p style="font-size:13px;color:var(--text-3);margin:0 0 8px">Hoje não é dia de estudo no seu plano. Abaixo, o próximo dia:</p>`;

    const progHTML = prog.porMateria
      .filter((p) => p.pct > 0 || true).slice(0, 5)
      .map((p) => `
        <div class="row-prog">
          <span class="nome">${p.nome}</span>
          <span class="bar"><span style="width:${p.pct}%"></span></span>
          <span class="pct">${p.pct}%</span>
        </div>`).join("");

    const revsHTML = revs.length
      ? revs.slice(0, 5).map((r) => {
          const n = nomeTopico(r.topicoId);
          return `<div class="task"><div class="txt"><div class="mat">${n.mat}</div>${n.top}</div><span class="meta">revisar</span></div>`;
        }).join("")
      : `<div class="empty">Sem revisões para hoje</div>`;

    el("view-hoje").innerHTML = `
      <h1 class="saudacao">Oi, ${nome} 👋</h1>
      <div class="tiles">
        <div class="tile"><div class="lbl">Hoje</div><div class="val">${fmtMin(hojeMin)}</div></div>
        <div class="tile"><div class="lbl">Meta ${hlp("meta")}</div><div class="val">${fmtMin(meta)}</div></div>
        <div class="tile"><div class="lbl">Sequência ${hlp("sequencia")}</div><div class="val">🔥 ${streakDias()}</div></div>
      </div>
      <div class="grid-2">
        <div class="col">
          <div class="card">
            <h3>Plano recomendado de hoje <span style="color:var(--text-3);font-weight:400">(${feitos}/${itens.length})</span> ${hlp("hoje")}</h3>
            <p style="font-size:12px;color:var(--text-3);margin:0 0 8px">Escolhido automaticamente pelo seu cronograma, com as matérias que mais pesam na prova.</p>
            ${avisoDescanso}
            ${tarefasHTML}
          </div>
          <div class="card">
            <h3>Revisões de hoje <span style="color:var(--text-3);font-weight:400">(${revs.length})</span> ${hlp("revisoes")}</h3>
            ${revsHTML}
          </div>
        </div>
        <div class="col">
          <div class="card">
            <h3>Progresso no edital — ${prog.geral}% ${hlp("progresso")}</h3>
            <div class="bar" style="margin-bottom:12px"><span style="width:${prog.geral}%"></span></div>
            ${progHTML}
          </div>
        </div>
      </div>
    `;

    // marcar / desmarcar tarefa (o check fica marcado no dia)
    el("view-hoje").querySelectorAll(".task[data-top]").forEach((node) => {
      node.querySelector(".box").addEventListener("click", () => {
        toggleTopicoPlano(node.dataset.top);
      });
    });
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
  let timerSeg = 0, timerInt = null;
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

    // cronômetro
    atualizaTimer();
    el("t-start").addEventListener("click", toggleTimer);
    el("t-zero").addEventListener("click", () => { pausaTimer(); timerSeg = 0; atualizaTimer(); el("t-salvar").style.display = "none"; });
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

  function atualizaTimer() {
    const mm = String(Math.floor(timerSeg / 60)).padStart(2, "0");
    const ss = String(timerSeg % 60).padStart(2, "0");
    const d = el("timer-disp"); if (d) d.textContent = `${mm}:${ss}`;
  }
  function toggleTimer() {
    if (timerInt) pausaTimer(); else iniciaTimer();
  }
  function iniciaTimer() {
    timerInt = setInterval(() => { timerSeg++; atualizaTimer(); }, 1000);
    const b = el("t-start"); if (b) b.textContent = "Pausar";
    const sv = el("t-salvar"); if (sv) sv.style.display = "block";
  }
  function pausaTimer() {
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    const b = el("t-start"); if (b) b.textContent = "Continuar";
  }
  function salvarSessaoTimer() {
    pausaTimer();
    const min = Math.round(timerSeg / 60);
    if (min <= 0) { toast("Estude ao menos 1 minuto antes de salvar."); return; }
    registrarSessao(el("t-mat").value, el("t-top").value, min, 0, 0, false);
    timerSeg = 0; atualizaTimer(); el("t-salvar").style.display = "none";
    const b = el("t-start"); if (b) b.textContent = "Iniciar";
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
    const totalQ = estado.sessoes.reduce((a, s) => a + (s.questoes || 0), 0);
    const totalA = estado.sessoes.reduce((a, s) => a + (s.acertos || 0), 0);
    const pctAc = totalQ ? Math.round(totalA / totalQ * 100) : 0;

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
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#1a1d21;color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;z-index:50;opacity:0;transition:opacity .2s";
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
  const RENDER = { hoje: renderHoje, cronograma: renderCronograma, registrar: renderRegistrar, revisoes: renderRevisoes, historico: renderHistorico, sobre: renderSobre };
  function irPara(view) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    el("view-" + view).classList.add("active");
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    if (timerInt && view !== "registrar") pausaTimer();
    (RENDER[view] || renderHoje)();
  }
  document.getElementById("nav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) irPara(b.dataset.view);
  });

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
})();
