/* ===========================================================================
   Rumo à SEFAZ — lógica do app (roteador + motor do cronograma + telas)
   =========================================================================== */
(function () {
  const S = window.SEFAZ;
  let estado = S.carregarEstado();

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
    const mats = [...estado.materias].sort(
      (a, b) => pesoNum(b) - pesoNum(a) || a.ordem - b.ordem
    );
    const filas = mats.map((m) => ({
      m,
      w: pesoNum(m),
      tops: m.topicos
        .filter((t) => t.status !== "concluido")
        .sort((x, y) => x.ordem - y.ordem),
    }));
    const out = [];
    let restante = filas.reduce((s, f) => s + f.tops.length, 0);
    let guarda = 0;
    while (restante > 0 && guarda++ < 5000) {
      let avancou = false;
      for (const f of filas) {
        for (let k = 0; k < f.w; k++) {
          if (f.tops.length) {
            out.push({ mat: f.m, top: f.tops.shift() });
            restante--;
            avancou = true;
          }
        }
      }
      if (!avancou) break;
    }
    return out;
  }

  function cicloSequencia() {
    // Uma volta do ciclo, no nível de matéria (com repetição por peso).
    const mats = [...estado.materias]
      .filter((m) => m.topicos.some((t) => t.status !== "concluido"))
      .sort((a, b) => pesoNum(b) - pesoNum(a) || a.ordem - b.ordem);
    const seq = [];
    mats.forEach((m) => {
      for (let k = 0; k < pesoNum(m); k++) seq.push(m);
    });
    return seq;
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
    const plano = planoProximosDias(1)[0];
    const ehHojeEstudo = estado.perfil.diasEstudo.includes(new Date().getDay());

    const tarefasHTML = plano && plano.itens.length
      ? plano.itens.map((it) => `
          <div class="task" data-top="${it.top.id}" data-mat="${it.mat.id}">
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
        <div class="tile"><div class="lbl">Meta</div><div class="val">${fmtMin(meta)}</div></div>
        <div class="tile"><div class="lbl">Sequência</div><div class="val">🔥 ${streakDias()}</div></div>
      </div>
      <div class="grid-2">
        <div class="col">
          <div class="card">
            <h3>Plano de hoje</h3>
            ${avisoDescanso}
            ${tarefasHTML}
          </div>
          <div class="card">
            <h3>Revisões de hoje <span style="color:var(--text-3);font-weight:400">(${revs.length})</span></h3>
            ${revsHTML}
          </div>
        </div>
        <div class="col">
          <div class="card">
            <h3>Progresso no edital — ${prog.geral}%</h3>
            <div class="bar" style="margin-bottom:12px"><span style="width:${prog.geral}%"></span></div>
            ${progHTML}
          </div>
        </div>
      </div>
    `;

    // marcar tarefa como concluída
    el("view-hoje").querySelectorAll(".task[data-top]").forEach((node) => {
      node.querySelector(".box").addEventListener("click", () => {
        concluirTopico(node.dataset.top);
      });
    });
  }

  function concluirTopico(topId) {
    for (const m of estado.materias) {
      const t = m.topicos.find((x) => x.id === topId);
      if (t && t.status !== "concluido") {
        t.status = "concluido";
        t.estudadoEm = S.hojeISO();
        agendarRevisoes(t.id, m.id);
        // registra uma sessão curta para contar atividade do dia (se nenhuma hoje)
        salvar();
        renderHoje();
        return;
      }
    }
  }

  /* ============================ TELA: CRONOGRAMA ========================== */
  function renderCronograma() {
    const p = estado.perfil;
    const matsHTML = [...estado.materias]
      .sort((a, b) => pesoNum(b) - pesoNum(a) || a.ordem - b.ordem)
      .map((m) => {
        const tier = prioridadeEfetiva(m);
        const auto = m.prioridade === "auto" ? " · auto" : "";
        return `
          <div class="mat-row">
            <span class="grip">⋮⋮</span>
            <span class="nome">${m.nome}</span>
            <span class="peso">${m.pesoQ}q${auto}</span>
            <button class="badge ${tier}" data-mat="${m.id}">${TIER_LABEL[tier]}</button>
          </div>`;
      }).join("");

    const diasTxt = p.diasEstudo.length === 7 ? "Todos" :
      p.diasEstudo.map((d) => DIAS_NOME[d]).join(" ");

    let planoHTML = "";
    if (p.modo === "ciclo") {
      const seq = cicloSequencia();
      const chips = seq.length
        ? seq.map((m) => `<span class="chip" style="margin:3px">${m.nome.split(" ")[0]}…</span>`).join("")
        : `<div class="empty">Edital concluído 🎉</div>`;
      planoHTML = `<div class="card"><h3>Ciclo sugerido (uma volta)</h3><div style="display:flex;flex-wrap:wrap">${chips}</div></div>`;
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
      <div class="seg">
        <button data-modo="ciclo" class="${p.modo === "ciclo" ? "on" : ""}">Ciclo de Estudos</button>
        <button data-modo="semanal" class="${p.modo === "semanal" ? "on" : ""}">Cronograma Semanal</button>
      </div>
      <div class="grid-2">
        <div class="col">
          <div class="card">
            <div class="sec-title">Matérias por prioridade <button class="link" id="help-prio">?</button></div>
            ${matsHTML}
            <p style="font-size:12px;color:var(--text-3);margin-top:10px">Toque na etiqueta para mudar a prioridade. O plano recalcula sozinho.</p>
          </div>
        </div>
        <div class="col">
          <div class="config">
            <button class="cfg" id="cfg-horas"><div class="k">Horas/dia</div><div class="v">${fmtMin(p.horasPorDiaMin)}</div></button>
            <button class="cfg" id="cfg-dias"><div class="k">Dias</div><div class="v">${diasTxt}</div></button>
            <button class="cfg" id="cfg-top"><div class="k">Tóp/dia</div><div class="v">${p.topicosPorDia}</div></button>
          </div>
          <div class="estimativa">🏁 No seu ritmo, cobre o edital em <strong>~${estimativaSemanas()} semanas</strong></div>
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
    // mudar prioridade (cicla auto → baixa → media → alta → maxima)
    el("view-cronograma").querySelectorAll(".badge[data-mat]").forEach((b) =>
      b.addEventListener("click", () => ciclarPrioridade(b.dataset.mat))
    );
    el("help-prio").addEventListener("click", () =>
      abrirModal(`<h3>Prioridade das matérias</h3><p class="sub">Começa no automático, a partir do peso da matéria na última prova. Você pode fixar manualmente: cada toque na etiqueta avança Baixa → Média → Alta → Máxima → Automático. Quanto maior a prioridade, mais a matéria aparece no plano.</p><button class="btn primary" onclick="document.getElementById('modal-bg').remove()">Entendi</button>`)
    );
    // config
    el("cfg-horas").addEventListener("click", () =>
      modalNumero("Minutos de estudo por dia", "Usado como sua meta diária.", estado.perfil.horasPorDiaMin, 15, (v) => {
        estado.perfil.horasPorDiaMin = v; estado.perfil.metaDiariaMin = v; salvar(); renderCronograma();
      })
    );
    el("cfg-top").addEventListener("click", () =>
      modalNumero("Tópicos por dia de estudo", "Quantos tópicos entram em cada dia do plano.", estado.perfil.topicosPorDia, 1, (v) => {
        estado.perfil.topicosPorDia = v; salvar(); renderCronograma();
      })
    );
    el("cfg-dias").addEventListener("click", editarDias);
  }

  function ciclarPrioridade(matId) {
    const m = estado.materias.find((x) => x.id === matId);
    if (!m) return;
    const atual = m.prioridade; // auto, baixa, media, alta, maxima
    const ordem = ["auto", "baixa", "media", "alta", "maxima"];
    const i = ordem.indexOf(atual);
    m.prioridade = ordem[(i + 1) % ordem.length];
    salvar(); renderCronograma();
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
            <h3>Cronômetro</h3>
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
            <h3>Lançamento manual</h3>
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
    const pend = estado.revisoes.filter((r) => !r.feito).sort((a, b) => a.data.localeCompare(b.data));
    const dueHoje = pend.filter((r) => r.data <= hoje);
    const prox = pend.filter((r) => r.data > hoje);

    function linha(r, due) {
      const n = nomeTopico(r.topicoId);
      return `<div class="task" data-rev="${r.id}">
        ${due ? '<button class="box">✓</button>' : '<span class="box" style="border-style:dashed"></span>'}
        <div class="txt"><div class="mat">${n.mat}</div>${n.top}</div>
        <span class="meta">${due ? "hoje" : r.data.slice(8) + "/" + r.data.slice(5, 7)}</span>
      </div>`;
    }

    el("view-revisoes").innerHTML = `
      <div class="card">
        <h3>Para revisar hoje <span style="color:var(--text-3);font-weight:400">(${dueHoje.length})</span></h3>
        ${dueHoje.length ? dueHoje.map((r) => linha(r, true)).join("") : '<div class="empty">Nada pendente. Mandou bem! ✨</div>'}
      </div>
      <div class="card">
        <h3>Próximas revisões</h3>
        ${prox.length ? prox.slice(0, 12).map((r) => linha(r, false)).join("") : '<div class="empty">Conforme você conclui tópicos, as revisões aparecem aqui.</div>'}
      </div>
    `;
    el("view-revisoes").querySelectorAll('.task[data-rev] .box').forEach((box) => {
      const node = box.closest(".task[data-rev]");
      if (box.tagName === "BUTTON") box.addEventListener("click", () => {
        const r = estado.revisoes.find((x) => x.id === node.dataset.rev);
        if (r) { r.feito = true; salvar(); renderRevisoes(); }
      });
    });
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

  /* --------------------------- roteador ------------------------------------ */
  const RENDER = { hoje: renderHoje, cronograma: renderCronograma, registrar: renderRegistrar, revisoes: renderRevisoes };
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
