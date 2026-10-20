/* =========================================================
   Painel de Indicadores de Saúde
   Lê data.json, agrega por região e desenha gráficos (Chart.js)
   ========================================================= */

const state = {
  data: null,
  regiao: "todas",
  charts: {},
  sort: { key: "populacao", dir: "desc" },
};

const nf = new Intl.NumberFormat("pt-BR");
const nfCompact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const num = (v, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
const soma = (arr) => arr.reduce((a, b) => a + b, 0);
const somaArrays = (arrs) => arrs[0].map((_, i) => soma(arrs.map((a) => a[i])));
const mediaPonderada = (valores, pesos) => soma(valores.map((v, i) => v * pesos[i])) / soma(pesos);

/* ---------- Tema ---------- */
function temaAtual() {
  const attr = document.documentElement.dataset.theme;
  if (attr) return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function cores() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return {
    text: v("--text"), muted: v("--muted"), border: v("--border"), surface: v("--surface"),
    accent: v("--accent"), accent2: v("--accent-2"), accent3: v("--accent-3"),
    accent4: v("--accent-4"), accent5: v("--accent-5"),
    ok: v("--ok"), warn: v("--warn"), danger: v("--danger"),
  };
}

function alpha(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---------- Agregação ---------- */
function selecionarRegioes() {
  const { regioes } = state.data;
  return state.regiao === "todas" ? regioes : regioes.filter((r) => r.nome === state.regiao);
}

function agregar(regs) {
  const pops = regs.map((r) => r.populacao);
  const totInt = regs.map((r) => soma(r.internacoes));
  const nVac = state.data.vacinas.length;
  const nFaixa = state.data.faixasEtarias.length;

  return {
    populacao: soma(pops),
    atendimentos: somaArrays(regs.map((r) => r.atendimentos)),
    internacoes: somaArrays(regs.map((r) => r.internacoes)),
    dengue: somaArrays(regs.map((r) => r.casosDengue)),
    vacinas: Array.from({ length: nVac }, (_, i) => mediaPonderada(regs.map((r) => r.coberturaVacinal[i]), pops)),
    uti: mediaPonderada(regs.map((r) => r.ocupacaoUTI), pops),
    faixas: Array.from({ length: nFaixa }, (_, i) => mediaPonderada(regs.map((r) => r.internacoesPorFaixa[i]), totInt)),
  };
}

function resumoRegiao(r) {
  const atend = soma(r.atendimentos);
  const intern = soma(r.internacoes);
  return {
    nome: r.nome,
    populacao: r.populacao,
    atendimentos: atend,
    internacoes: intern,
    taxa: (intern / atend) * 100,
    incidencia: (soma(r.casosDengue) / r.populacao) * 1e5,
    uti: r.ocupacaoUTI,
    vacina: soma(r.coberturaVacinal) / r.coberturaVacinal.length,
  };
}

/* ---------- KPIs ---------- */
function renderKPIs(ag) {
  const c = cores();
  const totAt = soma(ag.atendimentos);
  const totInt = soma(ag.internacoes);
  const totDen = soma(ag.dengue);
  const incid = (totDen / ag.populacao) * 1e5;
  const vacMedia = soma(ag.vacinas) / ag.vacinas.length;
  const meta = state.data.metaVacinal;

  setText("kpi-atendimentos", nfCompact.format(totAt));
  setText("kpi-internacoes", nfCompact.format(totInt));
  setText("kpi-taxa", `${pct((totInt / totAt) * 100)} dos atendimentos`);
  setText("kpi-dengue", nf.format(totDen));
  setText("kpi-incidencia", `${nf.format(Math.round(incid))} por 100 mil hab.`);
  setText("kpi-uti", pct(ag.uti));
  setText("kpi-vacina", pct(vacMedia));

  const bar = document.getElementById("kpi-uti-bar");
  bar.style.width = Math.min(ag.uti, 100) + "%";
  bar.style.background = ag.uti >= 80 ? c.danger : ag.uti >= 70 ? c.warn : c.ok;

  const metaEl = document.getElementById("kpi-meta");
  const abaixo = state.data.vacinas.filter((_, i) => ag.vacinas[i] < meta).length;
  metaEl.textContent = abaixo === 0 ? `Todas acima da meta de ${meta}%` : `${abaixo} de ${ag.vacinas.length} abaixo da meta de ${meta}%`;
  metaEl.className = "kpi-note " + (abaixo === 0 ? "ok" : "bad");
}

function setText(id, txt) {
  document.getElementById(id).textContent = txt;
}

/* ---------- Gráficos ---------- */
function configurarChartJs() {
  const c = cores();
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.color = c.muted;
  Chart.defaults.borderColor = c.border;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.tooltip.backgroundColor = c.text;
  Chart.defaults.plugins.tooltip.titleColor = c.surface;
  Chart.defaults.plugins.tooltip.bodyColor = c.surface;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.maintainAspectRatio = false;
}

function desenhar(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(document.getElementById(id), config);
}

function renderGraficos(ag) {
  const c = cores();
  const { meses, vacinas, faixasEtarias, metaVacinal } = state.data;

  // 1. Atendimentos x internações (linha, dois eixos)
  desenhar("chartMensal", {
    type: "line",
    data: {
      labels: meses,
      datasets: [
        {
          label: "Atendimentos", data: ag.atendimentos, yAxisID: "y",
          borderColor: c.accent, backgroundColor: alpha(c.accent, 0.12),
          fill: true, tension: 0.35, pointRadius: 3,
        },
        {
          label: "Internações", data: ag.internacoes, yAxisID: "y1",
          borderColor: c.accent2, backgroundColor: c.accent2,
          tension: 0.35, pointRadius: 3, borderDash: [6, 4],
        },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${nf.format(ctx.parsed.y)}` } } },
      scales: {
        x: { grid: { display: false } },
        y: { position: "left", ticks: { callback: (v) => nfCompact.format(v) }, title: { display: true, text: "Atendimentos" } },
        y1: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: (v) => nfCompact.format(v) }, title: { display: true, text: "Internações" } },
      },
    },
  });

  // 2. Faixa etária (rosca)
  desenhar("chartFaixa", {
    type: "doughnut",
    data: {
      labels: faixasEtarias.map((f) => f + " anos"),
      datasets: [{
        data: ag.faixas.map((v) => +v.toFixed(1)),
        backgroundColor: [c.accent3, c.accent, c.accent4, c.accent5, c.accent2],
        borderColor: c.surface, borderWidth: 2, hoverOffset: 6,
      }],
    },
    options: {
      cutout: "62%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${pct(ctx.parsed)}` } },
      },
    },
  });

  // 3. Dengue mensal (barras com cor por intensidade)
  const maxDen = Math.max(...ag.dengue);
  desenhar("chartDengue", {
    type: "bar",
    data: {
      labels: meses,
      datasets: [{
        label: "Casos", data: ag.dengue, borderRadius: 6,
        backgroundColor: ag.dengue.map((v) => alpha(c.accent2, 0.25 + 0.75 * (v / maxDen))),
      }],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${nf.format(ctx.parsed.y)} casos` } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => nfCompact.format(v) } } },
    },
  });

  // 4. Cobertura vacinal (barras horizontais + linha de meta)
  desenhar("chartVacina", {
    type: "bar",
    data: {
      labels: vacinas,
      datasets: [
        {
          label: "Cobertura", data: ag.vacinas.map((v) => +v.toFixed(1)), borderRadius: 6,
          backgroundColor: ag.vacinas.map((v) => (v >= metaVacinal ? c.ok : v >= metaVacinal - 10 ? c.warn : c.danger)),
        },
      ],
    },
    options: {
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${pct(ctx.parsed.x)} (meta ${metaVacinal}%)` } },
      },
      scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } }, y: { grid: { display: false } } },
    },
    plugins: [linhaMeta(metaVacinal, c.text)],
  });

  // 5. Incidência por região (sempre todas; destaca a selecionada)
  const resumo = state.data.regioes.map(resumoRegiao);
  desenhar("chartRegioes", {
    type: "bar",
    data: {
      labels: resumo.map((r) => r.nome),
      datasets: [{
        label: "Casos por 100 mil hab.",
        data: resumo.map((r) => Math.round(r.incidencia)),
        borderRadius: 6,
        backgroundColor: resumo.map((r) =>
          state.regiao === "todas" || state.regiao === r.nome ? c.accent3 : alpha(c.accent3, 0.25)),
      }],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${nf.format(ctx.parsed.y)} por 100 mil` } } },
      scales: { x: { grid: { display: false } } },
    },
  });
}

// Plugin simples que desenha uma linha vertical na meta
function linhaMeta(valor, cor) {
  return {
    id: "linhaMeta",
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(valor);
      ctx.save();
      ctx.strokeStyle = cor;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cor;
      ctx.font = "600 11px Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`meta ${valor}%`, x - 4, chartArea.top + 10);
      ctx.restore();
    },
  };
}

/* ---------- Tabela ---------- */
function renderTabela() {
  const { key, dir } = state.sort;
  const linhas = state.data.regioes.map(resumoRegiao).sort((a, b) => {
    const r = typeof a[key] === "string" ? a[key].localeCompare(b[key], "pt-BR") : a[key] - b[key];
    return dir === "asc" ? r : -r;
  });
  const meta = state.data.metaVacinal;

  const classeUTI = (v) => (v >= 80 ? "bad" : v >= 70 ? "warn" : "ok");
  const classeVac = (v) => (v >= meta ? "ok" : v >= meta - 10 ? "warn" : "bad");

  document.querySelector("#tabela tbody").innerHTML = linhas.map((r) => `
    <tr class="${r.nome === state.regiao ? "selected" : ""}">
      <td>${r.nome}</td>
      <td class="num">${nf.format(r.populacao)}</td>
      <td class="num">${nf.format(r.atendimentos)}</td>
      <td class="num">${nf.format(r.internacoes)}</td>
      <td class="num">${pct(r.taxa)}</td>
      <td class="num">${nf.format(Math.round(r.incidencia))}</td>
      <td class="num"><span class="pill ${classeUTI(r.uti)}">${pct(r.uti)}</span></td>
      <td class="num"><span class="pill ${classeVac(r.vacina)}">${pct(r.vacina)}</span></td>
    </tr>`).join("");

  document.querySelectorAll("#tabela th").forEach((th) => {
    th.setAttribute("aria-sort", th.dataset.key === key ? (dir === "asc" ? "ascending" : "descending") : "none");
  });
}

function configurarOrdenacao() {
  document.querySelectorAll("#tabela th").forEach((th) => {
    th.tabIndex = 0;
    const ordenar = () => {
      const k = th.dataset.key;
      state.sort = { key: k, dir: state.sort.key === k && state.sort.dir === "desc" ? "asc" : "desc" };
      renderTabela();
    };
    th.addEventListener("click", ordenar);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ordenar(); } });
  });
}

/* ---------- Carrossel de destaques ---------- */
const car = {
  idx: 0, n: 0,
  duracao: 6000,     // ms por slide
  decorrido: 0, ultimo: null,
  tocando: true,     // controlado pelo botão play/pausa
  hover: false, foco: false,
  arrasteX: null,
};

const MESES_EXTENSO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"];

function montarSlides(ag) {
  const d = state.data;
  const meta = d.metaVacinal;
  const brasil = agregar(d.regioes);
  const todas = state.regiao === "todas";
  const local = todas ? "no Brasil" : `na região ${state.regiao}`;

  const totAt = soma(ag.atendimentos);
  const iPicoAt = ag.atendimentos.indexOf(Math.max(...ag.atendimentos));

  const totDen = soma(ag.dengue);
  const iPicoDen = ag.dengue.indexOf(Math.max(...ag.dengue));
  const fevMai = soma(ag.dengue.slice(1, 5));

  const iVacMin = ag.vacinas.indexOf(Math.min(...ag.vacinas));
  const vacMin = ag.vacinas[iVacMin];
  const abaixo = ag.vacinas.filter((v) => v < meta).length;

  const resumo = d.regioes.map(resumoRegiao);
  const porUTI = [...resumo].sort((a, b) => b.uti - a.uti);
  const porInc = [...resumo].sort((a, b) => b.incidencia - a.incidencia);
  const incBrasil = (soma(brasil.dengue) / brasil.populacao) * 1e5;

  const iIdosos = d.faixasEtarias.length - 1;

  // UTI: texto depende do filtro
  let descUTI;
  if (todas) {
    descUTI = `Maior pressão no ${porUTI[0].nome} (${pct(porUTI[0].uti)}); menor no ${porUTI.at(-1).nome} (${pct(porUTI.at(-1).uti)}).`;
  } else {
    const dif = ag.uti - brasil.uti;
    descUTI = `Média nacional: ${pct(brasil.uti)}. A região está ${num(Math.abs(dif))} p.p. ${dif >= 0 ? "acima" : "abaixo"} dela.`;
  }

  // Incidência: título depende do filtro
  let tituloInc, valorInc;
  if (todas) {
    tituloInc = `${porInc[0].nome} lidera a incidência de dengue`;
    valorInc = porInc[0].incidencia;
  } else {
    const pos = porInc.findIndex((r) => r.nome === state.regiao) + 1;
    tituloInc = `${state.regiao}: ${pos}ª região em incidência de dengue`;
    valorInc = resumo.find((r) => r.nome === state.regiao).incidencia;
  }
  const destaqueInc = todas ? porInc[0].nome : state.regiao;

  return [
    {
      tone: "1",
      eyebrow: "Atendimentos",
      valor: nfCompact.format(totAt),
      titulo: `atendimentos registrados ${local} em ${d.ano}`,
      desc: `Média de ${nfCompact.format(totAt / 12)} por mês; o maior volume foi em ${MESES_EXTENSO[iPicoAt]}.`,
      visual: svgSparkline(ag.atendimentos, d.meses, "Atendimentos por mês"),
    },
    {
      tone: "2",
      eyebrow: "Dengue",
      valor: `${nf.format(ag.dengue[iPicoDen])}<small>casos em ${d.meses[iPicoDen].toLowerCase()}</small>`,
      titulo: `Pico de dengue em ${MESES_EXTENSO[iPicoDen]}`,
      desc: `De fevereiro a maio concentram-se ${pct((fevMai / totDen) * 100, 0)} dos ${nf.format(totDen)} casos do ano.`,
      visual: svgSparkline(ag.dengue, d.meses, "Casos de dengue por mês"),
    },
    {
      tone: vacMin < meta - 10 ? "bad" : "4",
      eyebrow: "Vacinação",
      valor: `${pct(vacMin)}<small>${d.vacinas[iVacMin]}</small>`,
      titulo: `${d.vacinas[iVacMin]} é a vacina com menor cobertura`,
      desc: `Faltam ${num(meta - vacMin)} p.p. para a meta de ${meta}%. ${abaixo} de ${ag.vacinas.length} vacinas estão abaixo da meta.`,
      visual: svgAnel(vacMin, `meta ${meta}%`),
    },
    {
      tone: ag.uti >= 80 ? "bad" : "3",
      eyebrow: "Leitos de UTI",
      valor: pct(ag.uti),
      titulo: `Ocupação média de leitos de UTI ${local}`,
      desc: descUTI,
      visual: svgAnel(ag.uti, "ocupação"),
    },
    {
      tone: "5",
      eyebrow: "Perfil das internações",
      valor: pct(ag.faixas[iIdosos]),
      titulo: "das internações são de pessoas com 60 anos ou mais",
      desc: `É a faixa etária com mais internações. Crianças de 0 a 14 anos respondem por ${pct(ag.faixas[0])}.`,
      visual: svgBarras(d.faixasEtarias.map((f, i) => ({
        rotulo: f + " anos", valor: ag.faixas[i], texto: pct(ag.faixas[i], 0), hi: i === iIdosos,
      }))),
    },
    {
      tone: "4",
      eyebrow: "Incidência",
      valor: `${nf.format(Math.round(valorInc))}<small>casos / 100 mil hab.</small>`,
      titulo: tituloInc,
      desc: `A média nacional é de ${nf.format(Math.round(incBrasil))} casos por 100 mil habitantes.`,
      visual: svgBarras(porInc.map((r) => ({
        rotulo: r.nome, valor: r.incidencia, texto: nf.format(Math.round(r.incidencia)), hi: r.nome === destaqueInc,
      }))),
    },
  ];
}

/* Mini-visuais em SVG (cores vêm do CSS via currentColor) */
function svgSparkline(vals, rotulos, aria) {
  const W = 280, H = 120, px = 8, pt = 24, pb = 22;
  const max = Math.max(...vals), min = Math.min(...vals);
  const x = (i) => px + (i * (W - 2 * px)) / (vals.length - 1);
  const y = (v) => pt + (H - pt - pb) * (1 - (v - min) / (max - min || 1));
  const linha = "M" + vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
  const area = `${linha} L${x(vals.length - 1).toFixed(1)},${H - pb} L${x(0).toFixed(1)},${H - pb} Z`;
  const im = vals.indexOf(max);
  const ancora = im < 2 ? "start" : im > vals.length - 3 ? "end" : "middle";
  const rotuloPico = im >= 2 && im <= vals.length - 3
    ? `<text class="lbl" x="${x(im)}" y="${H - 4}" text-anchor="middle">${rotulos[im]}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">
    <path class="area" d="${area}"/>
    <path class="line" d="${linha}"/>
    <circle class="dot" cx="${x(im)}" cy="${y(max)}" r="4.5"/>
    <text class="lbl-strong" x="${x(im)}" y="${y(max) - 10}" text-anchor="${ancora}">${nfCompact.format(max)}</text>
    <text class="lbl" x="${x(0)}" y="${H - 4}">${rotulos[0]}</text>
    ${rotuloPico}
    <text class="lbl" x="${x(vals.length - 1)}" y="${H - 4}" text-anchor="end">${rotulos.at(-1)}</text>
  </svg>`;
}

function svgAnel(valor, legenda) {
  const r = 46, C = 2 * Math.PI * r;
  const alvo = C * (1 - Math.min(valor, 100) / 100);
  return `<svg viewBox="0 0 280 120" role="img" aria-label="${pct(valor)} ${legenda}">
    <g transform="translate(140 60) rotate(-90)">
      <circle class="track" r="${r}" stroke-width="12"/>
      <circle class="ring" r="${r}" stroke-width="12" stroke-dasharray="${C.toFixed(2)}"
              stroke-dashoffset="${C.toFixed(2)}" data-alvo="${alvo.toFixed(2)}"/>
    </g>
    <text class="ring-txt" x="140" y="66" text-anchor="middle">${pct(valor, 0)}</text>
    <text class="lbl" x="140" y="84" text-anchor="middle">${legenda}</text>
  </svg>`;
}

function svgBarras(itens) {
  const W = 280, linhaH = 22, H = itens.length * linhaH, lw = 92, vw = 44;
  const max = Math.max(...itens.map((i) => i.valor));
  const larg = W - lw - vw;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${itens.map((i) => `${i.rotulo}: ${i.texto}`).join(", ")}">
    ${itens.map((it, i) => {
      const yy = i * linhaH;
      return `<text class="${it.hi ? "lbl-strong" : "lbl"}" x="0" y="${yy + 15}">${it.rotulo}</text>
        <rect class="bar-bg" x="${lw}" y="${yy + 6}" width="${larg}" height="10" rx="5"/>
        <rect class="bar-fg${it.hi ? " hi" : ""}" x="${lw}" y="${yy + 6}" width="${Math.max(4, (it.valor / max) * larg).toFixed(1)}" height="10" rx="5"/>
        <text class="${it.hi ? "lbl-strong" : "lbl"}" x="${W}" y="${yy + 15}" text-anchor="end">${it.texto}</text>`;
    }).join("")}
  </svg>`;
}

function renderCarrossel(ag) {
  const slides = montarSlides(ag);
  const track = document.getElementById("car-track");
  track.innerHTML = slides.map((s, i) => `
    <article class="slide" data-tone="${s.tone}" role="group" aria-roledescription="slide"
             aria-label="${i + 1} de ${slides.length}: ${s.eyebrow}">
      <div class="slide-text">
        <span class="slide-eyebrow">${s.eyebrow}</span>
        <strong class="slide-value">${s.valor}</strong>
        <h2 class="slide-title">${s.titulo}</h2>
        <p class="slide-desc">${s.desc}</p>
      </div>
      <div class="slide-visual">${s.visual}</div>
    </article>`).join("");

  const dots = document.getElementById("car-dots");
  dots.innerHTML = slides.map((s, i) =>
    `<button type="button" data-i="${i}" aria-label="Ir para o destaque ${i + 1}: ${s.eyebrow}"></button>`).join("");

  car.n = slides.length;
  if (car.idx >= car.n) car.idx = 0;
  car.decorrido = 0;
  aplicarSlide();

  // anima os anéis depois que entram no DOM
  requestAnimationFrame(() => requestAnimationFrame(() => {
    track.querySelectorAll(".ring").forEach((c) => { c.style.strokeDashoffset = c.dataset.alvo; });
  }));
}

function aplicarSlide() {
  document.getElementById("car-track").style.transform = `translateX(-${car.idx * 100}%)`;
  document.querySelectorAll("#car-track .slide").forEach((s, i) => {
    const atual = i === car.idx;
    s.setAttribute("aria-hidden", atual ? "false" : "true");
    s.inert = !atual;
  });
  document.querySelectorAll("#car-dots button").forEach((b, i) => {
    b.setAttribute("aria-current", i === car.idx ? "true" : "false");
  });
}

function irPara(i) {
  if (!car.n) return;
  car.idx = (i + car.n) % car.n;
  car.decorrido = 0;
  aplicarSlide();
}

function carrosselPausado() {
  return !car.tocando || car.hover || car.foco || document.hidden;
}

function atualizarBotaoPlay() {
  const btn = document.getElementById("car-play");
  btn.textContent = car.tocando ? "❚❚" : "▶";
  btn.setAttribute("aria-label", car.tocando ? "Pausar apresentação" : "Retomar apresentação");
}

function tickCarrossel(t) {
  if (car.ultimo === null) car.ultimo = t;
  const dt = Math.min(t - car.ultimo, 100); // evita salto ao voltar de aba inativa
  car.ultimo = t;

  const pausado = carrosselPausado();
  if (!pausado && car.n) {
    car.decorrido += dt;
    if (car.decorrido >= car.duracao) irPara(car.idx + 1);
  }
  document.getElementById("car-progress").style.width = `${(car.decorrido / car.duracao) * 100}%`;
  document.getElementById("carrossel").classList.toggle("paused", pausado);
  requestAnimationFrame(tickCarrossel);
}

function configurarCarrossel() {
  const el = document.getElementById("carrossel");
  const viewport = document.getElementById("car-viewport");

  document.getElementById("car-prev").addEventListener("click", () => irPara(car.idx - 1));
  document.getElementById("car-next").addEventListener("click", () => irPara(car.idx + 1));
  document.getElementById("car-play").addEventListener("click", () => {
    car.tocando = !car.tocando;
    atualizarBotaoPlay();
  });
  document.getElementById("car-dots").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) irPara(+b.dataset.i);
  });

  // pausa enquanto o usuário está lendo/interagindo
  el.addEventListener("mouseenter", () => { car.hover = true; });
  el.addEventListener("mouseleave", () => { car.hover = false; });
  el.addEventListener("focusin", () => { car.foco = true; });
  el.addEventListener("focusout", (e) => { if (!el.contains(e.relatedTarget)) car.foco = false; });

  // teclado
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); irPara(car.idx - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); irPara(car.idx + 1); }
  });

  // gesto de arrastar (toque ou mouse)
  viewport.addEventListener("pointerdown", (e) => { car.arrasteX = e.clientX; });
  viewport.addEventListener("pointerup", (e) => {
    if (car.arrasteX === null) return;
    const dx = e.clientX - car.arrasteX;
    car.arrasteX = null;
    if (Math.abs(dx) > 50) irPara(car.idx + (dx < 0 ? 1 : -1));
  });
  viewport.addEventListener("pointercancel", () => { car.arrasteX = null; });

  atualizarBotaoPlay();
  requestAnimationFrame(tickCarrossel);
}

/* ---------- Orquestração ---------- */
function renderTudo() {
  const ag = agregar(selecionarRegioes());
  const local = state.regiao === "todas" ? "Brasil" : `Região ${state.regiao}`;
  setText("subtitulo", `${local} · ${state.data.ano} · população de ${nf.format(ag.populacao)}`);
  renderCarrossel(ag);
  renderKPIs(ag);
  renderGraficos(ag);
  renderTabela();
}

function configurarControles() {
  const select = document.getElementById("regiao");
  state.data.regioes.forEach((r) => select.add(new Option(r.nome, r.nome)));
  select.addEventListener("change", (e) => { state.regiao = e.target.value; renderTudo(); });

  document.getElementById("tema").addEventListener("click", () => {
    const novo = temaAtual() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem("painel-saude-tema", novo); } catch (_) { /* sem storage */ }
    configurarChartJs();
    renderTudo();
  });
}

function mostrarErro(msg) {
  const el = document.getElementById("erro");
  el.hidden = false;
  el.innerHTML = msg;
  document.getElementById("carrossel").hidden = true;
  setText("subtitulo", "Não foi possível carregar os dados");
}

async function init() {
  try {
    const salvo = localStorage.getItem("painel-saude-tema");
    if (salvo) document.documentElement.dataset.theme = salvo;
  } catch (_) { /* sem storage */ }

  if (typeof Chart === "undefined") {
    mostrarErro("A biblioteca <strong>Chart.js</strong> não carregou. Verifique sua conexão com a internet.");
    return;
  }

  try {
    const resp = await fetch("data.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.data = await resp.json();
  } catch (err) {
    mostrarErro(
      `Erro ao ler <code>data.json</code> (${err.message}). Navegadores bloqueiam <code>fetch</code> em arquivos abertos ` +
      `direto do disco — sirva a pasta com um servidor local, por exemplo: <code>python3 -m http.server 8000</code> ` +
      `e acesse <code>http://localhost:8000</code>.`
    );
    return;
  }

  document.title = state.data.titulo;
  setText("titulo", state.data.titulo);
  setText("fonte", `Fonte: ${state.data.fonte}.`);

  configurarChartJs();
  configurarControles();
  configurarOrdenacao();
  configurarCarrossel();
  renderTudo();

  // acompanha mudança de tema do sistema quando o usuário não escolheu um
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) { configurarChartJs(); renderTudo(); }
  });
}

document.addEventListener("DOMContentLoaded", init);
