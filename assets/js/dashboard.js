Chart.register(ChartDataLabels);
Chart.defaults.font = { family: 'Inter, sans-serif', size: 11 };
Chart.defaults.color = '#6B7280';

const GRID = 'rgba(0,0,0,0.05)';
const TICK = '#9CA3AF';

const fmt = {
  big:  n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n||0),
  pct:  n => (+n).toFixed(2)+'%',
  date: s => new Date(s+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}),
  dateShort: s => { const d = new Date(s+'T00:00:00'); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; },
};

let charts = {};
let topPostsData = {};
let storiesTopData = {};

async function loadMetas() {
  try {
    const r = await fetch(`data/metas.json?t=${Date.now()}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

function renderMetas(metas) {
  const el = document.getElementById('metasList');
  const badge = document.getElementById('metaAlertaBadge');
  if (!el || !metas.length) return;

  const colorClass = pct => pct >= 95 ? 'c-green' : pct >= 80 ? 'c-yellow' : pct >= 50 ? 'c-orange' : 'c-red';

  const comDados = metas.filter(m => m.realizado > 0 && m.meta > 0);
  const sorted = [...comDados].sort((a, b) =>
    (a.realizado / a.meta) - (b.realizado / b.meta)
  );
  const critico = sorted[0];
  const pctCritico = critico.meta > 0 ? Math.round(critico.realizado / critico.meta * 100) : 0;

  if (badge) {
    badge.innerHTML = `<span class="meta-alerta">⚠️ Mais crítico: ${critico.indicador} — ${pctCritico}% da meta</span>`;
  }

  el.innerHTML = metas.map(m => {
    const pct  = m.meta > 0 ? Math.round(m.realizado / m.meta * 100) : 0;
    const cls  = colorClass(pct);
    const isCritico = m.indicador === critico.indicador;
    const barW = Math.min(pct, 100);
    const nf   = n => n > 0 ? n.toLocaleString('pt-BR') : '—';
    return `
      <div class="meta-row ${isCritico ? 'critico' : ''}">
        <div class="meta-name">${isCritico ? '🔴 ' : ''}${m.indicador}</div>
        <div class="meta-bar-wrap">
          <div class="meta-bar-bg">
            <div class="meta-bar-fill ${cls}" style="width:${barW}%"></div>
          </div>
          <span class="meta-pct ${cls}">${pct}%</span>
        </div>
        <div class="meta-values">
          <strong>${nf(m.realizado)}</strong> de ${nf(m.meta)}
        </div>
        <div class="meta-dia-badge">meta/dia<br><span>${nf(m.meta_dia)}</span></div>
      </div>
    `;
  }).join('');
}

async function loadData(account) {
  const r = await fetch(`data/${account}.json?t=${Date.now()}`);
  return r.json();
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function kill(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── KPIs ──────────────────────────────────────────────────────────────
const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function mtdArrow(cur, prev) {
  if (!prev || !cur) return '';
  const pct = Math.round((cur - prev) / Math.max(prev, 1) * 100);
  const cls   = pct >= 0 ? 'kpi-delta-up' : 'kpi-delta-dn';
  const arrow = pct >= 0 ? '▲' : '▼';
  return ` <span class="${cls}">${arrow}${Math.abs(pct)}% vs mês ant.</span>`;
}

function renderKPIs(d) {
  const s = d.summary;
  const followers = d.account.followers || 0;
  const mtd = computeMTD(d.daily || [], d.posts || []);
  const curMon  = MONTHS_PT[mtd.curMonth  - 1];
  const prevMon = MONTHS_PT[mtd.prevMonth - 1];
  const n = Math.max(mtd.cur.posts, 1);
  const engRate = mtd.cur.reach > 0
    ? (mtd.cur.engagement / mtd.cur.reach * 100).toFixed(2)
    : s.avg_engagement_rate;

  set('kpiFollowers', fmt.big(followers));
  document.getElementById('kpiFollowersSub').innerHTML =
    `+${fmt.big(mtd.cur.follows)} ganhos em ${curMon}${mtdArrow(mtd.cur.follows, mtd.prev.follows)}`;

  set('kpiReach', fmt.big(mtd.cur.reach));
  document.getElementById('kpiReachSub').innerHTML =
    `média/post: ${fmt.big(Math.round(mtd.cur.reach / n))}${mtdArrow(mtd.cur.reach, mtd.prev.reach)}`;

  set('kpiViews', fmt.big(mtd.cur.views));
  document.getElementById('kpiViewsSub').innerHTML =
    `${mtd.cur.posts} posts em ${curMon}${mtdArrow(mtd.cur.views, mtd.prev.views)}`;

  set('kpiEngagement', fmt.big(mtd.cur.engagement));
  document.getElementById('kpiEngSub').innerHTML =
    `média: ${fmt.big(Math.round(mtd.cur.engagement / n))}/post${mtdArrow(mtd.cur.engagement, mtd.prev.engagement)}`;

  set('kpiEngRate', fmt.pct(engRate));

  set('kpiShares', fmt.big(mtd.cur.shares));
  document.getElementById('kpiSharesSub').innerHTML =
    `${fmt.big(Math.round(mtd.cur.shares / n))}/post${mtdArrow(mtd.cur.shares, mtd.prev.shares)}`;

  set('kpiSaves', fmt.big(mtd.cur.saves));
  document.getElementById('kpiSavesSub').innerHTML =
    `${fmt.big(Math.round(mtd.cur.saves / n))}/post${mtdArrow(mtd.cur.saves, mtd.prev.saves)}`;

  set('accountName',   `@${d.account.username}`);
  set('accountPeriod', `${fmt.big(followers)} seguidores · ${curMon} ${new Date().getFullYear()} · Instagram`);
  set('lastUpdate',    d.account.updated_at);
  set('postCount',     `${s.total_posts} posts publicados no período total`);
}

// ── CHART: ALCANCE POR DIA ────────────────────────────────────────────
function renderChartDaily(d) {
  kill('daily');
  const ctx   = document.getElementById('chartDaily').getContext('2d');
  const daily = d.daily || [];

  charts.daily = new Chart(ctx, {
    type: 'line',
    data: {
      labels: daily.map(d => fmt.dateShort(d.date)),
      datasets: [
        {
          label: 'Alcance',
          data: daily.map(d => d.reach),
          borderColor: '#C8191A',
          backgroundColor: 'rgba(200,25,26,0.06)',
          fill: true, tension: 0.35,
          pointRadius: 2, pointHoverRadius: 5,
          pointBackgroundColor: '#C8191A',
          borderWidth: 2,
          yAxisID: 'y',
        },
        {
          label: 'Views',
          data: daily.map(d => d.views),
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37,99,235,0.03)',
          fill: true, tension: 0.35,
          pointRadius: 2, pointHoverRadius: 5,
          pointBackgroundColor: '#2563EB',
          borderWidth: 2,
          borderDash: [4, 3],
          yAxisID: 'y',
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#6B7280', font:{size:11}, padding:16, boxWidth:10, usePointStyle:true } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt.big(c.raw)}` } },
      },
      scales: {
        x: { grid: { color: GRID }, ticks: { color: TICK, maxTicksLimit: 20, maxRotation: 0 } },
        y: { grid: { color: GRID }, ticks: { color: TICK, callback: v => fmt.big(v) } },
      },
    },
  });
}

// ── CHART: TAXA DE ENGAJAMENTO POR DIA ───────────────────────────────
function renderChartDailyEng(d) {
  kill('dailyEng');
  const ctx   = document.getElementById('chartDailyEng').getContext('2d');
  const daily = d.daily || [];

  charts.dailyEng = new Chart(ctx, {
    type: 'line',
    data: {
      labels: daily.map(d => fmt.dateShort(d.date)),
      datasets: [{
        label: 'Taxa de Engaj. (%)',
        data: daily.map(d => d.eng_rate || 0),
        borderColor: '#16A34A',
        backgroundColor: 'rgba(22,163,74,0.07)',
        fill: true, tension: 0.35,
        pointRadius: 3, pointHoverRadius: 6,
        pointBackgroundColor: '#16A34A',
        borderWidth: 2,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: { callbacks: { label: c => ` Taxa: ${(+c.raw).toFixed(2)}%` } },
      },
      scales: {
        x: { grid: { color: GRID }, ticks: { color: TICK, maxTicksLimit: 20, maxRotation: 0 } },
        y: { grid: { color: GRID }, ticks: { color: '#16A34A', callback: v => v.toFixed(1)+'%' } },
      },
    },
  });
}

// ── CHART: SEGUIDORES ─────────────────────────────────────────────────
async function renderChartFollowers(account) {
  kill('followers');
  const el = document.getElementById('chartFollowers');
  const card = document.getElementById('followersChartCard');
  if (!el) return;

  let data = [];
  try {
    const r = await fetch(`data/followers_${account}.json?t=${Date.now()}`);
    if (r.ok) data = await r.json();
  } catch {}

  if (!data.length) { if (card) card.style.display = 'none'; return; }
  if (card) card.style.display = '';

  const avgChange = Math.round(data.reduce((s, d) => s + d.change, 0) / data.length);
  const badge = document.getElementById('followersAvgBadge');
  if (badge) {
    const color = avgChange >= 0 ? '#16A34A' : '#DC2626';
    const arrow = avgChange >= 0 ? '▲' : '▼';
    badge.innerHTML = `<span style="font-size:13px;font-weight:800;color:${color}">${arrow} ${avgChange >= 0 ? '+' : ''}${avgChange}/dia em média</span>`;
  }

  const ctx = el.getContext('2d');
  charts.followers = new Chart(ctx, {
    data: {
      labels: data.map(d => fmt.dateShort(d.date)),
      datasets: [
        {
          type: 'line',
          label: 'Total de Seguidores',
          data: data.map(d => d.followers),
          borderColor: '#F5820D',
          backgroundColor: 'rgba(245,130,13,0.07)',
          fill: true, tension: 0.35,
          pointRadius: 3, pointHoverRadius: 6,
          pointBackgroundColor: '#F5820D',
          borderWidth: 2,
          yAxisID: 'y',
        },
        {
          type: 'bar',
          label: 'Variação diária',
          data: data.map(d => d.change),
          backgroundColor: data.map(d => d.change >= 0 ? 'rgba(22,163,74,0.6)' : 'rgba(220,38,38,0.55)'),
          borderRadius: 3,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#6B7280', font:{size:11}, padding:16, boxWidth:10, usePointStyle:true } },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: c => c.datasetIndex === 0
              ? ` Total: ${c.raw.toLocaleString('pt-BR')}`
              : ` Variação: ${c.raw >= 0 ? '+' : ''}${c.raw}`,
          }
        },
      },
      scales: {
        x:  { grid: { color: GRID }, ticks: { color: TICK } },
        y:  { grid: { color: GRID }, ticks: { color: TICK, callback: v => fmt.big(v) }, position: 'left' },
        y2: { grid: { display: false }, ticks: { color: TICK, callback: v => (v >= 0 ? '+' : '') + v }, position: 'right' },
      },
    },
  });
}

// ── MTD COMPARISON ────────────────────────────────────────────────────
function computeMTD(daily, posts) {
  const today    = new Date();
  const dom      = today.getDate();
  const curMonth = today.getMonth() + 1;
  const curYear  = today.getFullYear();

  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear  = curMonth === 1 ? curYear - 1 : curYear;

  const pad = n => String(n).padStart(2, '0');
  const curPfx  = `${curYear}-${pad(curMonth)}-`;
  const prevPfx = `${prevYear}-${pad(prevMonth)}-`;

  const sumD = (arr, key) => arr.reduce((a, d) => a + (d[key] || 0), 0);
  const sumP = (arr, key) => arr.reduce((a, p) => a + (p[key] || 0), 0);

  const curDays   = daily.filter(d => d.date.startsWith(curPfx)  && +d.date.split('-')[2] <= dom);
  const prevDays  = daily.filter(d => d.date.startsWith(prevPfx) && +d.date.split('-')[2] <= dom);
  const curPosts  = (posts || []).filter(p => p.date && p.date.startsWith(curPfx)  && +p.date.split('-')[2] <= dom);
  const prevPosts = (posts || []).filter(p => p.date && p.date.startsWith(prevPfx) && +p.date.split('-')[2] <= dom);

  return {
    cur: {
      reach:      sumD(curDays,  'reach'),
      engagement: sumD(curDays,  'engagement'),
      follows:    sumD(curDays,  'follows'),
      posts:      sumD(curDays,  'posts'),
      views:      sumP(curPosts, 'views'),
      shares:     sumP(curPosts, 'shares'),
      saves:      sumP(curPosts, 'saves'),
    },
    prev: {
      reach:      sumD(prevDays,  'reach'),
      engagement: sumD(prevDays,  'engagement'),
      follows:    sumD(prevDays,  'follows'),
      posts:      sumD(prevDays,  'posts'),
      views:      sumP(prevPosts, 'views'),
      shares:     sumP(prevPosts, 'shares'),
      saves:      sumP(prevPosts, 'saves'),
    },
    dom,
    curMonth,
    prevMonth,
  };
}

function renderMTD(daily, posts) {
  const el = document.getElementById('mtdBanner');
  if (!el || !daily.length) return;

  const { cur, prev, dom } = computeMTD(daily, posts);
  if (!prev.reach) { el.style.display = 'none'; return; }

  const diff   = r => Math.round((cur[r] - prev[r]) / Math.max(prev[r], 1) * 100);
  const arrow  = pct => pct >= 0 ? `<span style="color:#16A34A">▲ ${pct}%</span>` : `<span style="color:#DC2626">▼ ${Math.abs(pct)}%</span>`;

  el.innerHTML = `
    <div class="mtd-label">MTD (1–${dom} do mês) vs mesmo período mês anterior</div>
    <div class="mtd-stats">
      <div class="mtd-stat">
        <span class="mtd-val">${fmt.big(cur.reach)}</span>
        <span class="mtd-name">Alcance</span>
        <span class="mtd-diff">${arrow(diff('reach'))}</span>
      </div>
      <div class="mtd-stat">
        <span class="mtd-val">${fmt.big(cur.engagement)}</span>
        <span class="mtd-name">Engajamento</span>
        <span class="mtd-diff">${arrow(diff('engagement'))}</span>
      </div>
      <div class="mtd-stat">
        <span class="mtd-val">${cur.posts}</span>
        <span class="mtd-name">Posts</span>
        <span class="mtd-diff">${arrow(diff('posts'))}</span>
      </div>
    </div>
  `;
  el.style.display = 'block';
}

// ── CHART: MENSAL ─────────────────────────────────────────────────────
function renderChartMonthly(d) {
  kill('monthly');
  const ctx = document.getElementById('chartMonthly').getContext('2d');
  charts.monthly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.monthly.map(m => m.month),
      datasets: [
        { label: 'Alcance', data: d.monthly.map(m => m.reach), backgroundColor: 'rgba(245,130,13,0.8)', borderRadius: 5, yAxisID: 'y' },
        { label: 'Views', data: d.monthly.map(m => m.views), type: 'line', borderColor: '#2563EB', backgroundColor: 'transparent', tension: 0.4, pointRadius: 4, pointBackgroundColor: '#2563EB', borderWidth: 2, yAxisID: 'y1' },
      ],
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { color: '#6B7280', font:{size:10}, padding:12, boxWidth:10 } }, datalabels: { display: false } },
      scales: {
        x:  { grid: { color: GRID }, ticks: { color: TICK } },
        y:  { grid: { color: GRID }, ticks: { color: TICK, callback: v => fmt.big(v) } },
        y1: { display: false },
      },
    },
  });
}

// ── CHART: ENGAJAMENTO STACKED ────────────────────────────────────────
function renderChartEngagement(d) {
  kill('engagement');
  const ctx = document.getElementById('chartEngagement').getContext('2d');
  charts.engagement = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.monthly.map(m => m.month),
      datasets: [
        { label: 'Curtidas',          data: d.monthly.map(m => m.likes),    backgroundColor: 'rgba(245,130,13,0.75)', borderRadius: 3, stack: 'e' },
        { label: 'Comentários',       data: d.monthly.map(m => m.comments), backgroundColor: 'rgba(124,58,237,0.7)', borderRadius: 3, stack: 'e' },
        { label: 'Compartilhamentos', data: d.monthly.map(m => m.shares),   backgroundColor: 'rgba(37,99,235,0.7)',  borderRadius: 3, stack: 'e' },
        { label: 'Salvamentos',       data: d.monthly.map(m => m.saves),    backgroundColor: 'rgba(22,163,74,0.7)',  borderRadius: 3, stack: 'e' },
      ],
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { color: '#6B7280', font:{size:10}, padding:10, boxWidth:10 } }, datalabels: { display: false } },
      scales: {
        x:   { grid: { color: GRID }, ticks: { color: TICK }, stacked: true },
        y:   { grid: { color: GRID }, ticks: { color: TICK, callback: v => fmt.big(v) }, stacked: true },
      },
    },
  });
}

// ── CHART: FORMATOS (HTML bars, igual ao benchmark) ───────────────────
function renderChartFormats(posts) {
  const el = document.getElementById('chartFormats');
  if (!el) return;
  const c = { REEL: 0, CAROUSEL: 0, IMAGE: 0 };
  posts.forEach(p => { if (c[p.type] !== undefined) c[p.type]++; });
  const total = c.REEL + c.CAROUSEL + c.IMAGE || 1;

  const types = [
    { key: 'REEL',     label: 'Reels',     cls: 'reels',     count: c.REEL },
    { key: 'CAROUSEL', label: 'Carrossel', cls: 'carrossel', count: c.CAROUSEL },
    { key: 'IMAGE',    label: 'Imagem',    cls: 'estatico',  count: c.IMAGE },
  ].filter(t => t.count > 0).map(t => ({ ...t, pct: Math.round(t.count / total * 100) }));

  const bars = types.map(t =>
    `<div class="benchmark-mix-seg ${t.cls}" style="width:${t.pct}%"></div>`
  ).join('');
  const legend = types.map(t => `
    <div class="benchmark-mix-item">
      <div class="benchmark-mix-dot mix-dot-${t.cls}"></div>
      <span>${t.label}</span>
      <strong>${t.pct}%</strong>
      <span style="color:var(--text-4)">(${t.count} posts)</span>
    </div>`).join('');

  el.innerHTML = `
    <div class="benchmark-mix">
      <div class="benchmark-mix-bars">${bars}</div>
      <div class="benchmark-mix-legend">${legend}</div>
    </div>`;
}

// ── CHART: POSTS POR MÊS ─────────────────────────────────────────────
function renderChartPosts(d) {
  kill('posts');
  const ctx = document.getElementById('chartPosts').getContext('2d');
  charts.posts = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.monthly.map(m => m.month),
      datasets: [{ data: d.monthly.map(m => m.posts), backgroundColor: 'rgba(13,148,136,0.75)', borderRadius: 5 }],
    },
    options: {
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: {
        x: { grid: { color: GRID }, ticks: { color: TICK } },
        y: { grid: { color: GRID }, ticks: { color: TICK, precision: 0 } },
      },
    },
  });
}

// ── CHART: ALCANCE POR FORMATO ────────────────────────────────────────
function renderChartFormatReach(posts) {
  kill('formatReach');
  const ctx = document.getElementById('chartFormatReach').getContext('2d');
  const g = { REEL: [], CAROUSEL: [], IMAGE: [] };
  posts.forEach(p => { if (g[p.type]) g[p.type].push(p.reach); });
  const avg = t => g[t].length ? Math.round(g[t].reduce((a,b)=>a+b,0)/g[t].length) : 0;
  charts.formatReach = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Reels', 'Carrossel', 'Imagem'],
      datasets: [{
        data: [avg('REEL'), avg('CAROUSEL'), avg('IMAGE')],
        backgroundColor: ['rgba(37,99,235,0.75)', 'rgba(124,58,237,0.75)', 'rgba(13,148,136,0.75)'],
        borderRadius: 7,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'end', color: '#6B7280', font: { size: 11, weight: 'bold' }, formatter: v => fmt.big(v) },
      },
      scales: {
        x: { grid: { color: GRID }, ticks: { color: TICK, callback: v => fmt.big(v) } },
        y: { grid: { display: false }, ticks: { color: TICK } },
      },
    },
  });
}

// ── TOP POSTS ─────────────────────────────────────────────────────────
const METRIC_LABEL = {
  by_reach:            { key: 'reach',           pct: false },
  by_views:            { key: 'views',            pct: false },
  by_engagement_rate:  { key: 'engagement_rate',  pct: true  },
  by_shares:           { key: 'shares',           pct: false },
  by_saves:            { key: 'saves',            pct: false },
  by_follows:          { key: 'follows',          pct: false },
};
const RANK_CLS = ['rank-1','rank-2','rank-3','rank-n','rank-n'];

function embedUrl(shortcode, type) {
  const base = type === 'REEL'
    ? `https://www.instagram.com/reel/${shortcode}/embed/`
    : `https://www.instagram.com/p/${shortcode}/embed/`;
  return base;
}

function renderTopPosts(key) {
  const posts = topPostsData[key] || [];
  const meta  = METRIC_LABEL[key];
  const emoji = { REEL:'▶️', CAROUSEL:'⊞', IMAGE:'🖼️' };

  document.getElementById('topPostsGrid').innerHTML = posts.map((p, i) => {
    const val = meta.pct ? fmt.pct(p[meta.key]) : fmt.big(p[meta.key]);
    const cap = p.caption ? (p.caption.length > 90 ? p.caption.slice(0,90)+'…' : p.caption) : '(sem legenda)';
    const sc  = p.shortcode;
    const embedHtml = sc
      ? `<iframe class="top-post-embed" src="${embedUrl(sc, p.type)}" scrolling="no" allowtransparency="true"></iframe>`
      : `<div class="top-post-embed-placeholder">${emoji[p.type]||'📷'}</div>`;

    return `
      <div class="top-post-card">
        ${embedHtml}
        <div class="top-post-body">
          <div class="top-post-header">
            <span class="top-post-rank ${RANK_CLS[i]}">${i+1}</span>
            <span class="badge ${p.type==='REEL'?'b-reel':p.type==='CAROUSEL'?'b-carousel':'b-image'}">${p.type==='REEL'?'Reel':p.type==='CAROUSEL'?'Carrossel':'Imagem'}</span>
          </div>
          <div class="top-post-caption">${cap}</div>
          <div class="top-post-metric">${val}</div>
          <div class="top-post-footer">
            <span class="top-post-date">${p.date ? fmt.date(p.date) : ''}</span>
            <a class="top-post-link" href="${p.permalink}" target="_blank" rel="noopener">↗ Abrir</a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}


// ── INSIGHTS LIST ─────────────────────────────────────────────────────
const TYPE_TAG = { top: 'Destaque', action: 'Ação', alert: 'Alerta' };

function insightRow(i) {
  const sc = i.shortcode || (i.permalink
    ? (i.permalink.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/) || [])[1]
    : null);
  const embedSrc = sc ? `https://www.instagram.com/p/${sc}/embed/` : null;
  const previewHtml = embedSrc
    ? `<iframe class="insight-row-preview" src="${embedSrc}" scrolling="no" allowtransparency="true"></iframe>`
    : '';
  return `
    <div class="insight-row ${i.type}">
      <div class="insight-row-icon">${i.icon}</div>
      <div class="insight-row-body">
        <div class="insight-row-title">${i.title}</div>
        <div class="insight-row-text">${i.body}</div>
        ${i.permalink ? `<a class="insight-row-link" href="${i.permalink}" target="_blank" rel="noopener">↗ Ver post${i.metric ? ' · ' + i.metric : ''}</a>` : ''}
      </div>
      ${previewHtml}
      <span class="insight-row-tag">${TYPE_TAG[i.type] || ''}</span>
    </div>
  `;
}

function renderList(containerId, insights) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="insight-list">${insights.map(insightRow).join('')}</div>`;
}
function renderDailyInsights(insights) { renderList('dailyInsightsList', insights); }
function renderCopyInsights(insights)  { renderList('copyInsightsList',  insights); }

// ── COPIES QUE FUNCIONAM ──────────────────────────────────────────────
function classifyHook(caption) {
  if (!caption) return { type: 'Outro', color: 'gray' };
  const first = caption.trim().split(/[.!?\n]/)[0].trim();
  const lower = first.toLowerCase();

  if (first.length > 0 && /^\d/.test(first)) return { type: 'Dado / Número', color: 'orange' };
  if (/\?$/.test(first) || /^(você|o que|por que|como|quem|quanto|quando|será que|já)/i.test(lower))
    return { type: 'Pergunta',      color: 'purple' };
  if (/^(não|nunca|pare|evite|cuidado|atenção|alerta)/i.test(lower))
    return { type: 'Alerta / Negação', color: 'pink' };
  if (/^(aprenda|descubra|veja|confira|saiba|entenda|conheça)/i.test(lower))
    return { type: 'Ensinamento',    color: 'teal' };
  if (/^(imagine|pense|se você|e se)/i.test(lower))
    return { type: 'Cenário',        color: 'blue' };
  return { type: 'Afirmação', color: 'green' };
}

function renderCTAAnalysis(posts) {
  const el = document.getElementById('ctaAnalysis');
  if (!el || !posts || !posts.length) return;

  // Sort by engagement rate desc, fallback to reach — pick top 8 "copies que funcionam"
  const top = [...posts]
    .filter(p => p.caption && p.caption.trim().length > 10)
    .sort((a, b) => ((+b.engagement_rate || 0) - (+a.engagement_rate || 0)) || (b.reach - a.reach))
    .slice(0, 8);

  if (!top.length) { el.innerHTML = '<p style="color:var(--text-3);padding:16px">Sem copies para analisar.</p>'; return; }

  // Calculate avg engagement for the set vs overall
  const overallAvgEng = posts.reduce((s,p) => s + (+p.engagement_rate||0), 0) / posts.length;

  // Identify hook types in the top copies
  const hookCount = {};
  top.forEach(p => {
    const h = classifyHook(p.caption);
    hookCount[h.type] = (hookCount[h.type] || 0) + 1;
  });
  const dominantHook = Object.entries(hookCount).sort((a,b) => b[1]-a[1])[0];

  const colorMap = { blue:'var(--blue)', purple:'var(--purple)', orange:'var(--orange)', teal:'var(--teal)', green:'var(--green)', pink:'var(--pink)', gray:'var(--text-4)' };

  const cards = top.map((p, i) => {
    const hook = classifyHook(p.caption);
    const firstLine = p.caption.trim().split('\n')[0];
    const cap = p.caption.length > 220 ? p.caption.slice(0, 220) + '…' : p.caption;
    const igUrl = p.shortcode ? `https://www.instagram.com/p/${p.shortcode}/` : null;
    const hookColor = colorMap[hook.color] || 'var(--text-3)';
    const typeEmoji = { REEL: '▶️', CAROUSEL: '📋', IMAGE: '🖼️' }[p.type] || '📄';

    return `
      <div class="copy-card">
        <div class="copy-rank">#${i + 1}</div>
        <div class="copy-body">
          <div class="copy-meta">
            <span class="copy-hook-tag" style="color:${hookColor};border-color:${hookColor}">${hook.type}</span>
            <span class="copy-type">${typeEmoji} ${p.type === 'REEL' ? 'Reel' : p.type === 'CAROUSEL' ? 'Carrossel' : 'Imagem'}</span>
            <span class="copy-date">${fmt.date(p.date)}</span>
          </div>
          <div class="copy-hook-line">${firstLine}</div>
          <div class="copy-full">${cap.replace(firstLine, '').trim()}</div>
          <div class="copy-stats">
            <span class="copy-stat-main">📈 ${(+p.engagement_rate).toFixed(2)}% eng.</span>
            <span>👁️ ${fmt.big(p.reach)}</span>
            <span>💬 ${fmt.big(p.comments || 0)}</span>
            <span>🔖 ${fmt.big(p.saves || 0)}</span>
            <span>🔁 ${fmt.big(p.shares || 0)}</span>
            ${igUrl ? `<a class="copy-link" href="${igUrl}" target="_blank" rel="noopener">↗ Ver</a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  const insightHtml = dominantHook ? `
    <div class="cta-insight-banner">
      💡 <strong>${dominantHook[1]} das ${top.length} melhores copies</strong> usam hook do tipo <strong>${dominantHook[0]}</strong>.
      Engajamento médio do top: <strong>${(top.reduce((s,p)=>s+(+p.engagement_rate||0),0)/top.length).toFixed(2)}%</strong>
      (vs média geral ${overallAvgEng.toFixed(2)}%).
    </div>` : '';

  el.innerHTML = `
    ${insightHtml}
    <div class="copy-grid">${cards}</div>
    <div class="cta-footer">Ordenado por taxa de engajamento · ${posts.length} posts analisados no período</div>`;
}

// ── STORIES ───────────────────────────────────────────────────────────
function renderStoriesKPIs(d) {
  const ss = d.stories_summary || {};
  set('kpiStoriesReach',    fmt.big(ss.total_reach || 0));
  set('kpiStoriesReachSub', `média: ${fmt.big(ss.avg_reach || 0)} por story`);
  set('kpiStoriesViews',    fmt.big(ss.total_views || 0));
  set('kpiStoriesViewsSub', `média: ${fmt.big(ss.avg_views || 0)} por story`);
  set('kpiStoriesReplies',  fmt.big(ss.total_replies || 0));
  set('kpiStoriesVisits',   fmt.big(ss.total_profile_visits || 0));
  set('kpiStoriesClicks',   fmt.big(ss.total_link_clicks || 0));
  set('kpiStoriesCount',    fmt.big(ss.total_stories || 0));
  set('kpiStoriesAvg',      `${fmt.big(ss.avg_reach || 0)} alcance médio`);
}

function renderChartStoriesDaily(d) {
  kill('storiesDaily');
  const el = document.getElementById('chartStoriesDaily');
  if (!el) return;
  const ctx   = el.getContext('2d');
  const daily = d.stories_daily || [];

  charts.storiesDaily = new Chart(ctx, {
    type: 'line',
    data: {
      labels: daily.map(d => fmt.dateShort(d.date)),
      datasets: [
        {
          label: 'Alcance',
          data: daily.map(d => d.reach),
          borderColor: '#F5820D',
          backgroundColor: 'rgba(245,130,13,0.07)',
          fill: true, tension: 0.35,
          pointRadius: 2, pointHoverRadius: 5,
          pointBackgroundColor: '#F5820D',
          borderWidth: 2,
        },
        {
          label: 'Impressões',
          data: daily.map(d => d.views),
          borderColor: '#7C3AED',
          backgroundColor: 'rgba(124,58,237,0.04)',
          fill: true, tension: 0.35,
          pointRadius: 2, pointHoverRadius: 5,
          pointBackgroundColor: '#7C3AED',
          borderWidth: 2,
          borderDash: [4,3],
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#6B7280', font:{size:11}, padding:16, boxWidth:10, usePointStyle:true } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt.big(c.raw)}` } },
      },
      scales: {
        x: { grid: { color: GRID }, ticks: { color: TICK, maxTicksLimit: 20, maxRotation: 0 } },
        y: { grid: { color: GRID }, ticks: { color: TICK, callback: v => fmt.big(v) } },
      },
    },
  });
}

const STORIES_METRIC_LABEL = {
  by_reach:   { key: 'reach',         label: 'Alcance' },
  by_views:   { key: 'views',         label: 'Impressões' },
  by_replies: { key: 'replies',       label: 'Respostas' },
  by_clicks:  { key: 'link_clicks',   label: 'Cliques' },
};

function renderTopStories(key) {
  const stories = storiesTopData[key] || [];
  const meta    = STORIES_METRIC_LABEL[key] || { key: 'reach', label: 'Alcance' };
  const el = document.getElementById('storiesTopList');
  if (!el) return;
  el.innerHTML = `<div class="stories-top-list">${stories.map((s, i) => {
    const cap = s.caption ? (s.caption.length > 80 ? s.caption.slice(0,80)+'…' : s.caption) : '(story sem legenda)';
    const val = fmt.big(s[meta.key] || 0);
    const rankCls = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
    return `
      <div class="story-row">
        <span class="story-rank ${rankCls}">${i+1}</span>
        <span class="story-date">${s.date ? fmt.date(s.date) : '—'}</span>
        <span class="story-caption">${cap}</span>
        <span class="story-metric">${val}</span>
        ${s.permalink ? `<a class="story-link" href="${s.permalink}" target="_blank" rel="noopener">↗ Ver</a>` : ''}
      </div>
    `;
  }).join('')}</div>`;
}

// ── BENCHMARK ─────────────────────────────────────────────────────────
function benchmarkMixHtml(mix) {
  if (!mix) return '';
  const order = ['reels','carrossel','estatico','stories'];
  const labels = { reels: 'Reels', carrossel: 'Carrossel', estatico: 'Estático', stories: 'Stories' };
  const bars = order.filter(k => mix[k] > 0).map(k =>
    `<div class="benchmark-mix-seg ${k}" style="width:${mix[k]}%"></div>`
  ).join('');
  const legend = order.filter(k => mix[k] > 0).map(k =>
    `<div class="benchmark-mix-item"><div class="benchmark-mix-dot mix-dot-${k}"></div>${labels[k]} ${mix[k]}%</div>`
  ).join('');
  return `
    <div class="benchmark-mix">
      <div class="benchmark-mix-label">Mix de conteúdo</div>
      <div class="benchmark-mix-bars">${bars}</div>
      <div class="benchmark-mix-legend">${legend}</div>
    </div>`;
}

async function renderBenchmark() {
  renderBenchmarkExtras();
  const el = document.getElementById('benchmarkGrid');
  if (!el) return;
  let accounts = [];
  try {
    const r = await fetch(`data/benchmark.json?t=${Date.now()}`);
    if (r.ok) accounts = await r.json();
  } catch {}
  if (!accounts.length) { el.innerHTML = '<p style="color:var(--text-3)">Nenhum canal configurado.</p>'; return; }

  el.innerHTML = accounts.map(a => {
    const initials = (a.name || a.handle).split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
    const avatarHtml = `<div class="benchmark-avatar-wrap">
      ${a.username ? `<img class="benchmark-avatar" src="https://unavatar.io/instagram/${a.username}" alt="${initials}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
      <div class="benchmark-avatar-fallback" style="${a.username ? 'display:none' : ''}">${initials}</div>
    </div>`;

    const topics = (a.top_topics || []).map(t => `<span class="benchmark-topic">${t}</span>`).join('');

    return `
    <div class="benchmark-card">
      <div class="benchmark-head">
        ${avatarHtml}
        <div class="benchmark-head-info">
          <span class="benchmark-handle">${a.handle}</span>
          <span class="benchmark-name">${a.name}</span>
        </div>
        <div style="text-align:right">
          <div class="benchmark-followers-big">${a.followers}</div>
          <span class="benchmark-followers-label">seguidores</span>
        </div>
      </div>

      <div class="benchmark-focus">${a.focus}</div>

      ${benchmarkMixHtml(a.content_mix)}

      ${topics ? `<div class="benchmark-topics">${topics}</div>` : ''}

      <div class="benchmark-insight">
        <div class="benchmark-insight-label">💡 Diferencial</div>
        ${a.differentiator || ''}
      </div>

      <div class="benchmark-action">
        <div class="benchmark-action-label">🎯 Ação pra Suno</div>
        ${a.action_for_suno || ''}
      </div>

      <div class="benchmark-footer">
        <span class="benchmark-freq">📅 ${a.posting_freq || ''}</span>
        <a class="benchmark-link" href="${a.url}" target="_blank" rel="noopener">↗ Ver perfil</a>
      </div>
    </div>`;
  }).join('');
}

// ── GESTÃO À VISTA ────────────────────────────────────────────────────
function gestaoKpisHtml(d) {
  const s = d.summary;
  const mtd = computeMTD(d.daily || [], d.posts || []);
  const curMon  = MONTHS_PT[mtd.curMonth  - 1];
  const prevMon = MONTHS_PT[mtd.prevMonth - 1];

  const delta = (cur, prev) => {
    if (!prev || !cur) return '';
    const pct = Math.round((cur - prev) / Math.max(prev, 1) * 100);
    const cls = pct >= 0 ? 'gestao-delta-up' : 'gestao-delta-dn';
    const arrow = pct >= 0 ? '▲' : '▼';
    return ` <span class="${cls}">${arrow} ${Math.abs(pct)}% vs ${prevMon}</span>`;
  };

  const n = Math.max(mtd.cur.posts, 1);
  const engRate = mtd.cur.reach > 0
    ? (mtd.cur.engagement / mtd.cur.reach * 100).toFixed(2)
    : s.avg_engagement_rate;

  const kpis = [
    { label: `Alcance ${curMon}`,     value: fmt.big(mtd.cur.reach),      sub: `~${fmt.big(Math.round(mtd.cur.reach/n))}/post${delta(mtd.cur.reach, mtd.prev.reach)}` },
    { label: `Views ${curMon}`,       value: fmt.big(mtd.cur.views),      sub: `${mtd.cur.posts} posts${delta(mtd.cur.views, mtd.prev.views)}` },
    { label: 'Engajamento',           value: fmt.big(mtd.cur.engagement), sub: `${fmt.pct(engRate)}${delta(mtd.cur.engagement, mtd.prev.engagement)}` },
    { label: 'Shares',                value: fmt.big(mtd.cur.shares),     sub: `${fmt.big(Math.round(mtd.cur.shares/n))}/post${delta(mtd.cur.shares, mtd.prev.shares)}` },
    { label: 'Saves',                 value: fmt.big(mtd.cur.saves),      sub: `${fmt.big(Math.round(mtd.cur.saves/n))}/post${delta(mtd.cur.saves, mtd.prev.saves)}` },
    { label: `Seg. ganhos ${curMon}`, value: fmt.big(mtd.cur.follows),    sub: `vs ${prevMon}: ${fmt.big(mtd.prev.follows || 0)}${delta(mtd.cur.follows, mtd.prev.follows)}` },
  ];
  return kpis.map(k => `
    <div class="gestao-kpi">
      <div class="gestao-kpi-label">${k.label}</div>
      <div class="gestao-kpi-value">${k.value}</div>
      <div class="gestao-kpi-sub">${k.sub}${k.mtdDelta ? ' · ' + k.mtdDelta : ''}</div>
    </div>
  `).join('');
}

function gestaoMetasHtml(metas) {
  const colorClass = pct => pct >= 95 ? 'c-green' : pct >= 80 ? 'c-yellow' : pct >= 50 ? 'c-orange' : 'c-red';
  const nf = n => n > 0 ? n.toLocaleString('pt-BR') : '—';
  return metas.map(m => {
    const semDados = m.realizado === 0 && m.meta > 0;
    const pct  = m.meta > 0 && !semDados ? Math.round(m.realizado / m.meta * 100) : 0;
    const cls  = semDados ? '' : colorClass(pct);
    const barW = semDados ? 0 : Math.min(pct, 100);
    return `
      <div class="meta-row">
        <div class="meta-name">${m.indicador}</div>
        <div class="meta-bar-wrap">
          <div class="meta-bar-bg">
            <div class="meta-bar-fill ${cls}" style="width:${barW}%"></div>
          </div>
          <span class="meta-pct ${cls}">${semDados ? 'S/D' : pct + '%'}</span>
        </div>
        <div class="meta-values"><strong>${nf(m.realizado)}</strong> de ${nf(m.meta)}</div>
        <div class="meta-dia-badge">meta/dia<br><span>${nf(m.meta_dia)}</span></div>
      </div>
    `;
  }).join('');
}

function gestaoTopPostsMiniHtml(data) {
  const posts = (data.top_posts && data.top_posts.by_reach) ? data.top_posts.by_reach.slice(0, 3) : [];
  if (!posts.length) return '';
  return `
    <div class="gestao-mini-posts-title">Top posts do período</div>
    <div class="gestao-mini-posts">
      ${posts.map((p, i) => {
        const sc = p.shortcode;
        const embedSrc = sc
          ? (p.type === 'REEL'
              ? `https://www.instagram.com/reel/${sc}/embed/`
              : `https://www.instagram.com/p/${sc}/embed/`)
          : null;
        const mediaHtml = embedSrc
          ? `<iframe class="gestao-mini-embed" src="${embedSrc}" scrolling="no" allowtransparency="true"></iframe>`
          : `<div class="gestao-mini-placeholder">${p.type === 'REEL' ? '▶️' : p.type === 'CAROUSEL' ? '📋' : '🖼️'}</div>`;
        const cap = p.caption ? (p.caption.length > 55 ? p.caption.slice(0, 55) + '…' : p.caption) : '(sem legenda)';
        return `
          <div class="gestao-mini-post">
            ${mediaHtml}
            <div class="gestao-mini-body">
              <div class="gestao-mini-cap">${cap}</div>
              <div class="gestao-mini-metrics">
                <span>👁️ ${fmt.big(p.reach)}</span>
                <span>💬 ${fmt.pct(p.engagement_rate)}</span>
                <span>🔖 ${fmt.big(p.saves)}</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

const GESTAO_ACCOUNTS = [
  { username: 'suno',            label: '@suno',            name: 'Suno Investimentos' },
  { username: 'tiagogreis',      label: '@tiagogreis',      name: 'Tiago Reis' },
  { username: 'sunonoticias',    label: '@sunonoticias',    name: 'Suno Notícias' },
  { username: 'sunoasset',       label: '@sunoasset',       name: 'Suno Asset' },
  { username: 'fiis.com.br',     label: '@fiis.com.br',     name: 'FIIS.com.br' },
  { username: 'fundsexplorer',   label: '@fundsexplorer',   name: 'Funds Explorer' },
  { username: 'status.invest',   label: '@status.invest',   name: 'Status Invest' },
  { username: 'professorbaroni', label: '@professorbaroni', name: 'Professor Baroni' },
];

function gestaoAccountCardHtml(d, label) {
  const mtd = computeMTD(d.daily || [], d.posts || []);
  const curMon  = MONTHS_PT[mtd.curMonth  - 1];
  const prevMon = MONTHS_PT[mtd.prevMonth - 1];
  const avatarUrl = `https://unavatar.io/instagram/${d.account.username}`;

  const delta = (cur, prev) => {
    if (!cur) return '';
    const pct = prev ? Math.round((cur - prev) / Math.max(prev, 1) * 100) : null;
    if (pct === null) return '';
    const cls = pct >= 0 ? 'gestao-delta-up' : 'gestao-delta-dn';
    return `<span class="${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
  };

  const n = Math.max(mtd.cur.posts, 1);
  const engRate = mtd.cur.reach > 0
    ? (mtd.cur.engagement / mtd.cur.reach * 100).toFixed(1)
    : '0.0';

  return `
    <div class="gestao-tv-card">
      <div class="gestao-tv-header">
        <div class="gestao-tv-avatar-wrap">
          <img class="gestao-tv-avatar" src="${avatarUrl}" alt="${label}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="gestao-tv-avatar-fb" style="display:none">
            <svg width="22" height="22" viewBox="0 0 24 24"><defs><linearGradient id="igTV" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#f09433"/><stop offset="50%" stop-color="#dc2743"/><stop offset="100%" stop-color="#bc1888"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="5" fill="url(#igTV)"/><circle cx="12" cy="12" r="4.5" stroke="white" stroke-width="1.8" fill="none"/><circle cx="17" cy="7" r="1.2" fill="white"/></svg>
          </div>
        </div>
        <div class="gestao-tv-info">
          <div class="gestao-tv-handle">${label}</div>
          <div class="gestao-tv-followers">${fmt.big(d.account.followers)} seg.</div>
        </div>
        <div class="gestao-tv-month">${curMon}</div>
      </div>
      <div class="gestao-tv-kpis">
        <div class="gestao-tv-kpi">
          <div class="gestao-tv-kpi-val">${fmt.big(mtd.cur.reach)}</div>
          <div class="gestao-tv-kpi-lbl">Alcance ${delta(mtd.cur.reach, mtd.prev.reach)}</div>
        </div>
        <div class="gestao-tv-kpi">
          <div class="gestao-tv-kpi-val">${fmt.big(mtd.cur.engagement)}</div>
          <div class="gestao-tv-kpi-lbl">Engaj. ${engRate}% ${delta(mtd.cur.engagement, mtd.prev.engagement)}</div>
        </div>
        <div class="gestao-tv-kpi">
          <div class="gestao-tv-kpi-val">${fmt.big(mtd.cur.follows)}</div>
          <div class="gestao-tv-kpi-lbl">Seg. ganhos ${delta(mtd.cur.follows, mtd.prev.follows)}</div>
        </div>
        <div class="gestao-tv-kpi">
          <div class="gestao-tv-kpi-val">${mtd.cur.posts}</div>
          <div class="gestao-tv-kpi-lbl">Posts ${delta(mtd.cur.posts, mtd.prev.posts)}</div>
        </div>
      </div>
    </div>`;
}

function crossAccountTopPosts(allAccountData, filter) {
  const all = [];
  allAccountData.forEach(({ data, label }) => {
    (data.posts || []).filter(filter).forEach(p => {
      all.push({ ...p, _account: label });
    });
  });
  return all.sort((a, b) => b.reach - a.reach).slice(0, 4);
}

// Pega o MELHOR post de CADA canal (um por canal). Mantém a ordem do GESTAO_ACCOUNTS.
function topPostPerChannel(allAccountData, filter) {
  return allAccountData.map(({ data, label }) => {
    const posts = (data.posts || []).filter(filter);
    if (!posts.length) return null;
    const best = posts.reduce((a, b) => (b.reach > a.reach ? b : a));
    return { ...best, _account: label };
  }).filter(Boolean);
}

function topPostsRowHtml(posts) {
  if (!posts.length) return '<p style="color:var(--text-3);padding:16px">Nenhum post encontrado.</p>';
  return posts.map(p => {
    const sc = p.shortcode;
    const embedSrc = sc
      ? (p.type === 'REEL'
          ? `https://www.instagram.com/reel/${sc}/embed/`
          : `https://www.instagram.com/p/${sc}/embed/`)
      : null;
    const cap = (p.caption || '').slice(0, 60) + ((p.caption || '').length > 60 ? '…' : '');
    return `
      <div class="gestao-top-post-card">
        ${embedSrc
          ? `<iframe class="gestao-top-post-embed" src="${embedSrc}" scrolling="no" allowtransparency="true" loading="lazy"></iframe>`
          : `<div class="gestao-top-post-placeholder">${p.type === 'REEL' ? '▶️' : p.type === 'CAROUSEL' ? '📋' : '🖼️'}</div>`}
        <div class="gestao-top-post-info">
          <div class="gestao-top-post-account">${p._account || ''}</div>
          <div class="gestao-top-post-cap">${cap || '(sem legenda)'}</div>
          <div class="gestao-top-post-metrics">
            <span>👁️ ${fmt.big(p.reach)}</span>
            <span>💬 ${fmt.pct(p.engagement_rate)}</span>
            <span>🔖 ${fmt.big(p.saves)}</span>
            <span>🔁 ${fmt.big(p.shares)}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

function benchmarkWeekInsightsHtml(allAccountData) {
  const today = new Date();
  const cutoff7 = new Date(today); cutoff7.setDate(today.getDate() - 7);
  const cutoffStr = cutoff7.toISOString().slice(0, 10);
  const curPfx = today.toISOString().slice(0, 7);

  const allPosts = [];
  allAccountData.forEach(({ data, label }) => {
    (data.posts || []).forEach(p => allPosts.push({ ...p, _account: label }));
  });

  const weekPosts = allPosts.filter(p => p.date >= cutoffStr);
  const monthPosts = allPosts.filter(p => (p.date || '').startsWith(curPfx));

  const insights = [];

  if (weekPosts.length) {
    const byType = {};
    weekPosts.forEach(p => { byType[p.type] = (byType[p.type] || []); byType[p.type].push(p.reach); });
    const avgByType = Object.entries(byType).map(([t, v]) => [t, v.reduce((a,b)=>a+b,0)/v.length]);
    avgByType.sort((a,b) => b[1]-a[1]);
    if (avgByType.length) {
      const typeNames = { REEL:'Reel', CAROUSEL:'Carrossel', IMAGE:'Imagem' };
      insights.push({ icon:'🏆', title:`${typeNames[avgByType[0][0]]||avgByType[0][0]} foi o formato mais eficiente esta semana`, body:`Alcance médio de ${fmt.big(Math.round(avgByType[0][1]))} por post — o melhor entre todos os formatos publicados nos seus canais nesta semana.` });
    }

    const topWeek = weekPosts.sort((a,b)=>b.reach-a.reach)[0];
    if (topWeek) insights.push({ icon:'⭐', title:`Post de destaque da semana em ${topWeek._account}`, body:`"${(topWeek.caption||'').slice(0,80)}…" — ${fmt.big(topWeek.reach)} de alcance, ${topWeek.engagement_rate?.toFixed(2)}% de engajamento. Estude o tema e replique.` });

    const totalReach = weekPosts.reduce((a,p)=>a+p.reach,0);
    const totalPosts = weekPosts.length;
    insights.push({ icon:'📊', title:`${totalPosts} posts publicados esta semana em todos os canais`, body:`Total de ${fmt.big(totalReach)} de alcance — média de ${fmt.big(Math.round(totalReach/Math.max(totalPosts,1)))} por post. ${totalPosts >= 15 ? 'Ótima frequência coletiva!' : 'Considere aumentar a frequência nos canais com menos posts.'}` });
  }

  if (monthPosts.length) {
    const topSave = monthPosts.sort((a,b)=>b.saves-a.saves)[0];
    if (topSave) insights.push({ icon:'🔖', title:`Post mais salvo do mês em ${topSave._account}`, body:`"${(topSave.caption||'').slice(0,80)}…" — ${fmt.big(topSave.saves)} salvamentos. Conteúdo de referência: produza mais desse tema em todos os canais.` });

    const topShare = monthPosts.sort((a,b)=>b.shares-a.shares)[0];
    if (topShare) insights.push({ icon:'🔁', title:`Post mais compartilhado do mês em ${topShare._account}`, body:`"${(topShare.caption||'').slice(0,80)}…" — ${fmt.big(topShare.shares)} compartilhamentos. Compartilhamento orgânico é o principal motor de crescimento — replique o tema.` });
  }

  if (!insights.length) return '<p style="color:var(--text-3);padding:16px">Nenhum dado suficiente para gerar insights.</p>';

  const colors = { '🏆':'blue','⭐':'orange','📊':'teal','🔖':'purple','🔁':'green' };
  return insights.map(ins => {
    const col = colors[ins.icon] || 'blue';
    return `
      <div class="bm-insight-card bm-insight-${col}">
        <div class="bm-insight-icon">${ins.icon}</div>
        <div class="bm-insight-body">
          <div class="bm-insight-title">${ins.title}</div>
          <div class="bm-insight-text">${ins.body}</div>
        </div>
      </div>`;
  }).join('');
}

async function renderGestao() {
  const container = document.getElementById('gestaoAllAccounts');
  if (container) container.innerHTML = '<div style="padding:32px;color:var(--text-3);text-align:center">Carregando dados…</div>';

  const [metas, ...accountDatas] = await Promise.all([
    loadMetas(),
    ...GESTAO_ACCOUNTS.map(a => loadData(a.username).catch(() => null))
  ]);

  const today = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  set('gestaoDate', `Atualizado em ${today}`);

  const metasEl = document.getElementById('gestaoMetasList');
  if (metasEl) metasEl.innerHTML = gestaoMetasHtml(metas);

  if (!container) return;
  const pairs = GESTAO_ACCOUNTS.map((a, i) => ({ ...a, data: accountDatas[i] })).filter(a => a.data);

  // 4-column TV grid
  container.innerHTML = `<div class="gestao-tv-grid">${pairs.map(a => gestaoAccountCardHtml(a.data, a.label)).join('')}</div>`;

  // Cross-account top posts
  const now = new Date();
  const cutoff7 = new Date(now); cutoff7.setDate(now.getDate() - 7);
  const cutoffStr = cutoff7.toISOString().slice(0, 10);
  const curPfx = now.toISOString().slice(0, 7);

  // Top post da semana/mês de CADA canal (um por canal) — pra cada time ver seu melhor
  const weekPosts  = topPostPerChannel(pairs, p => p.date >= cutoffStr);
  const monthPosts = topPostPerChannel(pairs, p => (p.date || '').startsWith(curPfx));

  const weekEl  = document.getElementById('gestaoTopWeek');
  const monthEl = document.getElementById('gestaoTopMonth');
  const weekSec  = document.getElementById('gestaoTopWeekSection');
  const monthSec = document.getElementById('gestaoTopMonthSection');

  if (weekEl && weekPosts.length)  { weekEl.innerHTML  = topPostsRowHtml(weekPosts);  if (weekSec)  weekSec.style.display  = ''; }
  if (monthEl && monthPosts.length){ monthEl.innerHTML = topPostsRowHtml(monthPosts); if (monthSec) monthSec.style.display = ''; }
}

// ── MODO TV (fullscreen + layout gigante pra TV widescreen) ───────────
let _tvRefreshTimer = null;

function toggleTvMode() {
  const isOn = document.body.classList.toggle('tv-mode');
  const label = document.getElementById('tvBtnLabel');

  if (isOn) {
    // pede fullscreen (requer ação do usuário — o clique serve)
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    if (label) label.textContent = 'Sair do Modo TV';
    // auto-refresh a cada 5 min pra TV ficar com dado fresco
    clearInterval(_tvRefreshTimer);
    _tvRefreshTimer = setInterval(() => { renderGestao(); }, 5 * 60 * 1000);
  } else {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (label) label.textContent = 'Modo TV';
    clearInterval(_tvRefreshTimer);
    _tvRefreshTimer = null;
  }
}

// Se o usuário sair do fullscreen via Esc, sincroniza o estado
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('tv-mode')) {
    document.body.classList.remove('tv-mode');
    const label = document.getElementById('tvBtnLabel');
    if (label) label.textContent = 'Modo TV';
    clearInterval(_tvRefreshTimer);
    _tvRefreshTimer = null;
  }
});

async function renderBenchmarkExtras() {
  // Load benchmark channels (NOT our own channels)
  let benchmarkAccounts = [];
  try {
    const r = await fetch(`data/benchmark.json?t=${Date.now()}`);
    if (r.ok) benchmarkAccounts = await r.json();
  } catch {}

  // Build highlight posts from benchmark top_posts shortcodes — with fallback chain per channel
  const weekEl = document.getElementById('benchmarkTopWeek');
  if (weekEl && benchmarkAccounts.length) {
    const highlightCards = benchmarkAccounts
      .filter(a => a.top_posts && a.top_posts.length)
      .map((a, i) => {
        const shortcodesJson = JSON.stringify(a.top_posts);
        const firstSc = a.top_posts[0];
        const embedSrc = `https://www.instagram.com/p/${firstSc}/embed/`;
        const cardId = `bmHi${i}`;
        return `
          <div class="gestao-top-post-card" id="${cardId}" data-shortcodes='${shortcodesJson}' data-idx="0" data-handle="${a.handle}">
            <iframe class="gestao-top-post-embed" src="${embedSrc}"
              scrolling="no" allowtransparency="true" loading="lazy"
              onload="tryValidateBenchmarkEmbed('${cardId}')"
              onerror="tryNextBenchmarkPost('${cardId}')"></iframe>
            <div class="gestao-top-post-info">
              <div class="gestao-top-post-account">${a.handle}</div>
              <div class="gestao-top-post-cap" style="font-size:11px;color:var(--text-3)">${a.name}</div>
              <div class="gestao-top-post-metrics" style="margin-top:4px">
                <a href="${a.url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue);font-weight:600;text-decoration:none">↗ Ver perfil</a>
              </div>
            </div>
          </div>`;
      }).join('');
    weekEl.innerHTML = highlightCards || '<p style="color:var(--text-3);padding:16px">Nenhum destaque disponível.</p>';
  }

  // Build insights from benchmark differentiator + action_for_suno
  const insEl = document.getElementById('benchmarkWeekInsights');
  if (insEl && benchmarkAccounts.length) {
    const colors = ['blue','orange','teal','purple','green'];
    const icons  = ['💡','🎯','📊','🔍','⚡'];
    insEl.innerHTML = benchmarkAccounts.slice(0, 5).map((a, i) => `
      <div class="bm-insight-card bm-insight-${colors[i % colors.length]}">
        <div class="bm-insight-icon">${icons[i % icons.length]}</div>
        <div class="bm-insight-body">
          <div class="bm-insight-title">${a.handle} — Ação pra Suno</div>
          <div class="bm-insight-text">${a.action_for_suno || a.differentiator || ''}</div>
        </div>
      </div>`).join('');
  }
}


// ── MAIN RENDER ───────────────────────────────────────────────────────
async function render(account) {
  const data = await loadData(account);
  topPostsData   = data.top_posts || {};
  storiesTopData = data.stories_top || {};

  renderKPIs(data);
  renderMTD(data.daily || [], data.posts || []);
  renderDailyInsights(data.daily_insights || []);
  renderChartDaily(data);
  renderChartDailyEng(data);
  renderChartMonthly(data);
  renderChartEngagement(data);
  renderChartFormats(data.posts);
  renderChartPosts(data);
  renderChartFormatReach(data.posts);
  renderTopPosts('by_reach');
  renderCopyInsights(data.copy_insights || []);

  renderChartFollowers(account);

  renderStoriesKPIs(data);
  renderChartStoriesDaily(data);
  renderTopStories('by_reach');

  document.querySelectorAll('.tab[data-key]').forEach(t => t.classList.remove('active'));
  const firstTab = document.querySelector('.tab[data-key="by_reach"]');
  if (firstTab) firstTab.classList.add('active');
  document.querySelectorAll('.tab[data-skey]').forEach(t => t.classList.remove('active'));
  const firstSTab = document.querySelector('.tab[data-skey="by_reach"]');
  if (firstSTab) firstSTab.classList.add('active');
}

// ── DAILY ─────────────────────────────────────────────────────────────

const DAILY_TERRITORY = {
  'suno':            { name: 'Suno Investimentos',  territory: 'educação financeira, FIIs, ações, macroeconomia, finanças pessoais',                color: '#C8191A' },
  'tiagogreis':      { name: 'Tiago Reis',          territory: 'macroeconomia, cenário político-econômico, value investing, filosofia de investimentos', color: '#2563EB' },
  'sunonoticias':    { name: 'Suno Notícias',       territory: 'notícias de mercado, economia do dia, atualidades financeiras',                     color: '#DC2626' },
  'sunoasset':       { name: 'Suno Asset',          territory: 'gestão de fundos, FIIs Suno Asset, portfólio, análise fundamentalista',             color: '#7C3AED' },
  'fiis.com.br':     { name: 'FIIS.com.br',         territory: 'fundos imobiliários, dividendos, mercado imobiliário, proventos',                   color: '#16A34A' },
  'fundsexplorer':   { name: 'Funds Explorer',      territory: 'ferramentas para FIIs, comparativos de fundos, rankings de dividendos',             color: '#0D9488' },
  'status.invest':   { name: 'Status Invest',       territory: 'análise de ações, indicadores fundamentalistas, screener, valuation',               color: '#DB2777' },
  'professorbaroni': { name: 'Professor Baroni',    territory: 'educação em FIIs, renda passiva, como investir em fundos imobiliários',             color: '#4F46E5' },
};

const DAILY_CONTENT_SUGGESTION = {
  'suno':            'Explore um tema educativo de alta viralização: "X erros que todo investidor comete" ou análise de um ativo em destaque no dia.',
  'tiagogreis':      'Tiago brilha em análises com opinião forte. Um vídeo ou carrossel sobre cenário atual (Selic, dólar, PIB) tende a gerar muito compartilhamento.',
  'sunonoticias':    'Canal de notícias precisa publicar no ritmo do mercado. Monitore portais e seja o primeiro a comentar as movimentações do dia.',
  'sunoasset':       'Destaque um fundo da carteira: performance recente, dividendos pagos ou perspectiva setorial. Conteúdo de portfólio gera autoridade.',
  'fiis.com.br':     'FII em destaque: queda ou alta relevante, relatório de gestão publicado recentemente ou notícia do setor imobiliário são ótimas pautas.',
  'fundsexplorer':   'Compare 2–3 FIIs em métrica relevante (P/VP, DY, vacância). Conteúdo comparativo tem altíssima taxa de salvamento.',
  'status.invest':   'Ação ou FII com indicador chamativo (P/L baixo, DY alto, insider buying). Ferramenta de análise em formato visual performa muito bem.',
  'professorbaroni': '"Como escolher um FII", "o que é vacância" ou análise didática de um fundo. Tom educativo para iniciantes é o diferencial do canal.',
};

function dailyFindRefDate(pairs) {
  const dateCount = {};
  pairs.forEach(({ data }) => {
    const dates = new Set((data.posts || []).map(p => p.date).filter(Boolean));
    dates.forEach(d => { dateCount[d] = (dateCount[d] || 0) + 1; });
  });
  const sorted = Object.keys(dateCount).sort().reverse();
  return sorted.find(d => dateCount[d] >= 2) || sorted[0] || null;
}

// Average reach per post in the 7 days before refDate
function dailyWeekAvg(data, refDate) {
  const refObj = new Date(refDate + 'T00:00:00');
  const weekAgo = new Date(refObj); weekAgo.setDate(refObj.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);
  const weekPosts = (data.posts || []).filter(p => p.date >= weekAgoStr && p.date < refDate);
  if (!weekPosts.length) return null;
  return Math.round(weekPosts.reduce((s, p) => s + p.reach, 0) / weekPosts.length);
}

// Per-post insight: 1-line automatic analysis
function dailyPostInsight(p) {
  const eng  = p.engagement_rate || 0;
  const saves  = p.saves  || 0;
  const shares = p.shares || 0;
  const reach  = p.reach  || 0;
  if (eng >= 6)                        return { icon: '🔥', text: `Taxa de engajamento excelente (${eng.toFixed(1)}%). Replique o tema e o formato imediatamente.` };
  if (shares >= 300)                   return { icon: '🔁', text: `${shares} compartilhamentos — conteúdo viral. Aprofunde o tema com um carrossel ou vídeo.` };
  if (saves >= 150)                    return { icon: '🔖', text: `${saves} salvamentos — conteúdo de referência. Produza mais sobre esse assunto.` };
  if (eng >= 3)                        return { icon: '✅', text: `Bom engajamento (${eng.toFixed(1)}%), acima do benchmark de 3%. Monitore salvar e compartilhar.` };
  if (eng < 1 && reach > 8000)        return { icon: '⚠️', text: `Alto alcance mas engajamento muito baixo (${eng.toFixed(1)}%). CTA fraco ou público fora do perfil. Responda os comentários.` };
  if (reach > 50000)                   return { icon: '👁️', text: `Grande alcance (${fmt.big(reach)}). Monitore o engajamento — ainda pode crescer nas próximas horas.` };
  if (p.type === 'REEL' && reach < 3000) return { icon: '📉', text: 'Reel abaixo da média. Revise o gancho nos primeiros 3 segundos e a qualidade do thumbnail.' };
  if (p.type === 'CAROUSEL' && eng >= 2) return { icon: '📋', text: 'Carrossel com bom engajamento. Inclua CTA de "salva esse post" no último slide dos próximos.' };
  if (saves > 0 && shares > 0)         return { icon: '📊', text: `${saves} saves e ${shares} shares. Conteúdo com potencial — acompanhe nas próximas 24h.` };
  return                                      { icon: '📊', text: `Desempenho moderado. Compare o tema e horário com os top posts do canal para calibrar a próxima publicação.` };
}

// Per-channel action plan based on data + territory
function dailyChannelPlan(username, dayPosts, weekAvg) {
  const suggestions = [];
  if (!dayPosts.length) {
    suggestions.push({ icon: '📣', text: `Prioridade: publicar hoje. Sem post ontem, o alcance orgânico cai — ritmo consistente é essencial para o algoritmo.` });
    suggestions.push({ icon: '💡', text: DAILY_CONTENT_SUGGESTION[username] || 'Produza conteúdo alinhado ao território do canal.' });
    return suggestions;
  }
  const totalReach = dayPosts.reduce((s, p) => s + p.reach, 0);
  const avgEngRate = dayPosts.reduce((s, p) => s + p.engagement_rate, 0) / dayPosts.length;
  const best = [...dayPosts].sort((a, b) => b.reach - a.reach)[0];

  if (weekAvg !== null && totalReach / Math.max(dayPosts.length, 1) < weekAvg * 0.7) {
    suggestions.push({ icon: '📉', text: `Alcance médio/post ontem (${fmt.big(Math.round(totalReach / dayPosts.length))}) abaixo da média dos últimos 7 dias (${fmt.big(weekAvg)}/post). Considere impulsionar o melhor post ou publicar em horário de pico.` });
  } else if (weekAvg !== null && totalReach / Math.max(dayPosts.length, 1) > weekAvg * 1.3) {
    suggestions.push({ icon: '📈', text: `Alcance acima da média da semana (+${Math.round((totalReach/dayPosts.length - weekAvg)/weekAvg*100)}%). Analise o que funcionou e replique o tema hoje.` });
  }
  if (avgEngRate < 1.5) {
    suggestions.push({ icon: '💬', text: `Engajamento médio baixo (${avgEngRate.toFixed(1)}%). Responda os comentários dos posts de ontem agora — isso aquece a audiência para o próximo.` });
  }
  if (best.type === 'CAROUSEL' && best.engagement_rate >= 2) {
    suggestions.push({ icon: '📋', text: `Carrossel foi o melhor formato ontem. Planeje um novo carrossel educativo para hoje.` });
  } else if (best.type === 'REEL' && best.reach > 5000) {
    suggestions.push({ icon: '▶️', text: `Reel em destaque ontem. O algoritmo está favorecendo vídeos curtos no canal — mantenha a frequência.` });
  }
  suggestions.push({ icon: '💡', text: DAILY_CONTENT_SUGGESTION[username] || 'Produza conteúdo alinhado ao território do canal.' });
  return suggestions;
}

// ── Render: Metas ─────────────────────────────────────────────────────
function renderDailyMetas(metas) {
  const el = document.getElementById('dailyMetasPanel');
  if (!el || !metas.length) return;
  el.innerHTML = gestaoMetasHtml(metas);
}

// ── Render: Resultados por Canal ──────────────────────────────────────
function renderDailyChannels(pairs, refDate) {
  const el = document.getElementById('dailyChannels');
  if (!el) return;

  const html = pairs.map(({ data, label, username }) => {
    const terr  = DAILY_TERRITORY[username] || {};
    const color = terr.color || '#6B7280';
    const dayPosts = (data.posts || []).filter(p => p.date === refDate);
    const weekAvg  = dailyWeekAvg(data, refDate);

    if (!dayPosts.length) {
      return `<div class="daily-ch-card daily-ch-no-post">
        <div class="daily-ch-card-head" style="border-left:3px solid ${color}">
          <div class="daily-ch-card-label">${label}</div>
          <div class="daily-ch-card-name">${terr.name || ''}</div>
          <div class="daily-badge daily-badge-gray" style="margin-top:6px">Sem post ontem</div>
        </div>
      </div>`;
    }

    const totalReach   = dayPosts.reduce((s, p) => s + p.reach, 0);
    const totalViews   = dayPosts.reduce((s, p) => s + p.views, 0);
    const totalEng     = dayPosts.reduce((s, p) => s + p.engagement, 0);
    const totalFollows = dayPosts.reduce((s, p) => s + (p.follows || 0), 0);
    const avgEngRate   = (dayPosts.reduce((s, p) => s + p.engagement_rate, 0) / dayPosts.length).toFixed(1);

    let weekCmp = '';
    if (weekAvg !== null) {
      const refAvg = Math.round(totalReach / dayPosts.length);
      const pct = Math.round((refAvg - weekAvg) / Math.max(weekAvg, 1) * 100);
      const cls = pct >= 0 ? 'daily-delta-up' : 'daily-delta-dn';
      weekCmp = `<div class="daily-week-cmp"><span class="${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span> vs média dos últimos 7 dias (${fmt.big(weekAvg)}/post)</div>`;
    }

    const engCls = parseFloat(avgEngRate) >= 3 ? 'daily-badge-green' : parseFloat(avgEngRate) >= 1.5 ? 'daily-badge-yellow' : 'daily-badge-red';

    const postRows = [...dayPosts].sort((a, b) => b.reach - a.reach).map(p => {
      const typeIcon = { REEL: '▶️', CAROUSEL: '📋', IMAGE: '🖼️' }[p.type] || '📄';
      const cap = (p.caption || '').slice(0, 65) + ((p.caption || '').length > 65 ? '…' : '');
      const timeStr = (p.datetime || '').match(/(\d{2}:\d{2})/)?.[1] || '';
      const ins = dailyPostInsight(p);
      return `<div class="daily-post-row">
        <span class="daily-post-type-icon">${typeIcon}</span>
        <div class="daily-post-row-info">
          <div class="daily-post-row-cap">${cap || '(sem legenda)'}</div>
          <div class="daily-post-row-meta">
            ${timeStr ? `<span>🕐 ${timeStr}</span>` : ''}
            <span>👁️ ${fmt.big(p.reach)}</span>
            <span>💬 ${p.engagement_rate.toFixed(1)}%</span>
            <span>🔖 ${fmt.big(p.saves)}</span>
            <span>🔁 ${fmt.big(p.shares)}</span>
            ${p.follows > 0 ? `<span>👥 +${p.follows}</span>` : ''}
          </div>
          <div class="daily-post-row-insight">${ins.icon} ${ins.text}</div>
        </div>
        ${p.permalink ? `<a class="daily-post-link" href="${p.permalink}" target="_blank" rel="noopener">↗</a>` : ''}
      </div>`;
    }).join('');

    const refDateFmt = fmt.dateShort(refDate);
    return `<div class="daily-ch-card">
      <div class="daily-ch-card-head" style="border-left:3px solid ${color}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div>
            <div class="daily-ch-card-label">${label}</div>
            <div class="daily-ch-card-name">${terr.name || ''}</div>
            <div class="daily-ch-date-tag">📅 Ontem · ${refDateFmt}</div>
          </div>
          <span class="daily-badge ${engCls}" title="Taxa de engajamento dos posts de ontem (${refDateFmt})">${avgEngRate}% eng.</span>
        </div>
        <div class="daily-ch-card-kpis">
          <div class="daily-ch-kpi"><span class="daily-ch-kpi-val">${fmt.big(totalReach)}</span><span class="daily-ch-kpi-lbl">Alcance</span></div>
          <div class="daily-ch-kpi"><span class="daily-ch-kpi-val">${fmt.big(totalViews)}</span><span class="daily-ch-kpi-lbl">Views</span></div>
          <div class="daily-ch-kpi"><span class="daily-ch-kpi-val">${fmt.big(totalEng)}</span><span class="daily-ch-kpi-lbl">Engaj.</span></div>
          <div class="daily-ch-kpi"><span class="daily-ch-kpi-val">${dayPosts.length}</span><span class="daily-ch-kpi-lbl">Post${dayPosts.length > 1 ? 's' : ''}</span></div>
          ${totalFollows > 0 ? `<div class="daily-ch-kpi"><span class="daily-ch-kpi-val">+${totalFollows}</span><span class="daily-ch-kpi-lbl">Seg.</span></div>` : ''}
        </div>
        ${weekCmp}
      </div>
      <div class="daily-ch-posts-list">${postRows}</div>
    </div>`;
  }).join('');

  el.innerHTML = html;
}

// ── Render: Melhor + Pior por Canal ──────────────────────────────────
function renderDailyContent(pairs, refDate) {
  const el = document.getElementById('dailyContent');
  if (!el) return;

  const sections = pairs.map(({ data, label, username }) => {
    const terr  = DAILY_TERRITORY[username] || {};
    const color = terr.color || '#6B7280';
    const dayPosts = (data.posts || []).filter(p => p.date === refDate);
    if (!dayPosts.length) return '';

    const sorted = [...dayPosts].sort((a, b) => b.reach - a.reach);
    const best  = sorted[0];

    // If only 1 post today, pick the worst from the last 7 days as reference
    let worst = null;
    let worstLabel = '📉 Menor alcance';
    if (sorted.length > 1) {
      worst = sorted[sorted.length - 1];
    } else {
      const refObj = new Date(refDate + 'T00:00:00');
      const weekAgo = new Date(refObj); weekAgo.setDate(refObj.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);
      const recentPosts = (data.posts || []).filter(p => p.date >= weekAgoStr && p.date < refDate);
      if (recentPosts.length) {
        worst = recentPosts.sort((a, b) => a.reach - b.reach)[0];
        worstLabel = '📉 Pior dos últimos 7 dias';
      }
    }

    const postCard = (p, tag, customLabel) => {
      const sc = p.shortcode;
      const embedSrc = sc
        ? (p.type === 'REEL' ? `https://www.instagram.com/reel/${sc}/embed/` : `https://www.instagram.com/p/${sc}/embed/`)
        : null;
      const cap = (p.caption || '').slice(0, 80) + ((p.caption || '').length > 80 ? '…' : '');
      const typeIcon = { REEL: '▶️', CAROUSEL: '📋', IMAGE: '🖼️' }[p.type] || '📄';
      const insight = dailyPostInsight(p);
      const tagText = tag === 'best' ? '🏆 Melhor' : (customLabel || worstLabel);
      return `<div class="daily-post-card">
        <div class="daily-post-tag ${tag === 'best' ? 'daily-post-tag-best' : 'daily-post-tag-worst'}">${tagText}</div>
        <div class="daily-post-media">
          ${embedSrc
            ? `<iframe class="daily-post-embed" src="${embedSrc}" scrolling="no" allowtransparency="true" loading="lazy"></iframe>`
            : `<div class="daily-post-placeholder">${typeIcon}</div>`}
        </div>
        <div class="daily-post-info">
          <div class="daily-post-metrics">
            <span>👁️ ${fmt.big(p.reach)}</span>
            <span>💬 ${fmt.pct(p.engagement_rate)}</span>
            <span>🔖 ${fmt.big(p.saves)}</span>
            <span>🔁 ${fmt.big(p.shares)}</span>
          </div>
          <div class="daily-post-cap">${cap || '(sem legenda)'}</div>
          <div class="daily-post-insight">${insight.icon} ${insight.text}</div>
          ${p.permalink ? `<a class="daily-post-link" href="${p.permalink}" target="_blank" rel="noopener">↗ Ver post</a>` : ''}
        </div>
      </div>`;
    };

    return `<div class="daily-content-channel">
      <div class="daily-content-ch-title" style="border-left:3px solid ${color}">${label}</div>
      <div class="daily-posts-row">
        ${postCard(best, 'best')}
        ${worst ? postCard(worst, 'worst', worstLabel) : ''}
      </div>
    </div>`;
  }).filter(Boolean).join('');

  el.innerHTML = sections || '<p class="daily-empty">Nenhum post publicado nesta data.</p>';
}

// ── Render: Plano por Canal ───────────────────────────────────────────
function renderDailyActionPlan(pairs, refDate, metas) {
  const el = document.getElementById('dailyActionPlan');
  if (!el) return;

  const sections = pairs.map(({ data, label, username }) => {
    const terr  = DAILY_TERRITORY[username] || {};
    const color = terr.color || '#6B7280';
    const dayPosts = (data.posts || []).filter(p => p.date === refDate);
    const weekAvg  = dailyWeekAvg(data, refDate);
    const plan = dailyChannelPlan(username, dayPosts, weekAvg);

    return `<div class="daily-plan-channel">
      <div class="daily-plan-ch-title" style="border-left:3px solid ${color}">
        <div>
          <strong>${label}</strong>
          <span class="daily-plan-territory">${terr.territory || ''}</span>
        </div>
        ${dayPosts.length === 0
          ? '<span class="daily-badge daily-badge-red">⚠️ Sem post</span>'
          : `<span class="daily-badge daily-badge-gray">${dayPosts.length} post${dayPosts.length > 1 ? 's' : ''} ontem</span>`}
      </div>
      <div class="daily-plan-items">
        ${plan.map(a => `<div class="daily-plan-item"><span class="daily-plan-icon">${a.icon}</span><span>${a.text}</span></div>`).join('')}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = sections;
}

// ── Archive ───────────────────────────────────────────────────────────
async function loadDailyArchive() {
  try {
    const r = await fetch(`dailies/index.json?t=${Date.now()}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

function renderDailyArchiveBar(archive, activeDate) {
  const container = document.getElementById('dailyArchiveItems');
  if (!container) return;
  if (!archive || !archive.length) {
    container.textContent = 'Nenhuma daily arquivada ainda. A primeira será salva na próxima reunião.';
    return;
  }
  const bar = document.getElementById('dailyArchiveBar');
  if (bar) bar.innerHTML = `<span class="daily-archive-label">📁 Arquivo</span>` +
    archive.map(entry => {
      const d = new Date(entry.date + 'T00:00:00');
      const lbl = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      const isActive = entry.date === activeDate;
      return `<button class="daily-archive-chip ${isActive ? 'active' : ''}" onclick="renderDaily('${entry.date}')">${lbl}</button>`;
    }).join('');
}

async function renderDaily(overrideDate) {
  const view = document.getElementById('dailyView');
  if (!view) return;

  set('dailySubtitle', 'Carregando dados…');

  const [metas, archive, ...accountDatas] = await Promise.all([
    loadMetas(),
    loadDailyArchive(),
    ...GESTAO_ACCOUNTS.map(a => loadData(a.username).catch(() => null))
  ]);
  const pairs = GESTAO_ACCOUNTS.map((a, i) => ({ ...a, data: accountDatas[i] })).filter(a => a.data);

  const refDate = overrideDate || dailyFindRefDate(pairs);
  if (!refDate) { set('dailySubtitle', 'Sem dados disponíveis'); return; }

  const todayFull = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const refObj    = new Date(refDate + 'T00:00:00');
  const refFmt    = refObj.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const refFmtCap = refFmt.charAt(0).toUpperCase() + refFmt.slice(1);
  const refShort  = refObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  set('dailyTitle',    `☀️ Daily · ${refFmtCap}`);
  set('dailySubtitle', `Reunião de ${todayFull} · resultados de ${refFmtCap.toLowerCase()}`);

  // Dynamic section titles with actual date
  set('dailySectionMetas',    `🎯 Metas do Período · onde estamos em relação aos indicadores`);
  set('dailySectionChannels', `📡 Resultados de ontem (${refShort}) · métricas por canal`);
  set('dailySectionContent',  `🏆 Destaques de ontem (${refShort}) · melhor e pior post por canal`);
  set('dailySectionPlan',     `🎯 Plano de Ação de Hoje · o que cada canal precisa fazer`);

  renderDailyArchiveBar(archive, refDate);
  renderDailyMetas(metas);
  renderDailyChannels(pairs, refDate);
  renderDailyContent(pairs, refDate);
  renderDailyActionPlan(pairs, refDate, metas);
}

// ── EVENTS ────────────────────────────────────────────────────────────
function showView(name) {
  ['dashboardView', 'gestaoView', 'benchmarkView', 'dailyView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === name ? '' : 'none';
  });
  const topbar = document.getElementById('mainTopbar');
  if (topbar) topbar.style.display = name === 'dashboardView' ? '' : 'none';
}

document.querySelectorAll('.nav-item[data-account]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    showView('dashboardView');
    render(el.dataset.account);
  });
});

document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    if (el.dataset.view === 'gestao') {
      showView('gestaoView');
      renderGestao();
    } else if (el.dataset.view === 'benchmark') {
      showView('benchmarkView');
      renderBenchmark();
    } else if (el.dataset.view === 'daily') {
      showView('dailyView');
      renderDaily();
    }
  });
});

document.getElementById('topPostsTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab[data-key]');
  if (!btn) return;
  document.querySelectorAll('#topPostsTabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderTopPosts(btn.dataset.key);
});

document.getElementById('storiesTopTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab[data-skey]');
  if (!btn) return;
  document.querySelectorAll('#storiesTopTabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderTopStories(btn.dataset.skey);
});

// ── BENCHMARK EMBED FALLBACK ──────────────────────────────────────────
// Instagram embed iframes can't be inspected cross-origin. We use a timing heuristic:
// If the iframe's initial "Post not found" page is smaller / loads instantly, we try next.
// The function is triggered by onerror (most reliable) or via a timeout check.
window.tryNextBenchmarkPost = function(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const shortcodes = JSON.parse(card.dataset.shortcodes || '[]');
  let idx = parseInt(card.dataset.idx || '0', 10) + 1;
  if (idx >= shortcodes.length) {
    // No more alternates — show graceful fallback
    const handle = card.dataset.handle || '';
    card.innerHTML = `
      <div class="gestao-top-post-placeholder" style="flex-direction:column;gap:8px;padding:20px">
        <span style="font-size:24px">🔗</span>
        <span style="font-size:11px;color:var(--text-3);text-align:center">Highlights indisponíveis</span>
        <span style="font-size:10px;color:var(--text-4);text-align:center">${handle}</span>
      </div>`;
    return;
  }
  card.dataset.idx = String(idx);
  const nextSc = shortcodes[idx];
  const iframe = card.querySelector('iframe');
  if (iframe) iframe.src = `https://www.instagram.com/p/${nextSc}/embed/`;
};

window.tryValidateBenchmarkEmbed = function(cardId) {
  // This runs on successful iframe load. Instagram still loads a page for deleted posts
  // (showing "Post not found"), so this is mostly a no-op — the visual layer handles it.
  // If we had a detection method, we'd swap here too.
};

// ── EXPORT ────────────────────────────────────────────────────────────
function toggleExportMenu() {
  const menu = document.getElementById('exportMenu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const closeOnClick = e => {
      if (!document.getElementById('exportWrap')?.contains(e.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeOnClick);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnClick), 50);
  }
}

async function exportPDF() {
  document.getElementById('exportMenu').style.display = 'none';

  // Determine the active view to export
  const views = ['dashboardView', 'gestaoView', 'benchmarkView', 'dailyView'];
  const activeView = views.map(id => document.getElementById(id)).find(el => el && el.style.display !== 'none') || document.getElementById('dashboardView');
  if (!activeView) { alert('Nenhuma view para exportar.'); return; }

  // Show loading
  const btn = document.querySelector('.export-btn');
  const origText = btn.innerHTML;
  btn.innerHTML = '⏳ Gerando PDF...';
  btn.disabled = true;

  try {
    // Hide iframes temporarily (they cause CORS/rendering issues with html2canvas)
    const iframes = activeView.querySelectorAll('iframe');
    const iframeStates = [];
    iframes.forEach(f => {
      iframeStates.push({ el: f, display: f.style.display });
      f.style.display = 'none';
    });

    // Wait a tick for layout to settle
    await new Promise(r => setTimeout(r, 200));

    const canvas = await html2canvas(activeView, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#F4F5F7',
      logging: false,
      windowWidth: activeView.scrollWidth,
      windowHeight: activeView.scrollHeight,
    });

    // Restore iframes
    iframeStates.forEach(s => { s.el.style.display = s.display; });

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgW = canvas.width;
    const imgH = canvas.height;
    const ratio = pdfW / imgW;
    const scaledH = imgH * ratio;

    // Split across pages if taller than one page
    let heightLeft = scaledH;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, pdfW, scaledH, undefined, 'FAST');
    heightLeft -= pdfH;
    while (heightLeft > 0) {
      position = heightLeft - scaledH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, pdfW, scaledH, undefined, 'FAST');
      heightLeft -= pdfH;
    }

    const account = document.querySelector('.nav-item.active[data-account]')?.dataset?.account || 'dashboard';
    pdf.save(`suno_${account}_${new Date().toISOString().slice(0,10)}.pdf`);
  } catch (e) {
    console.error('PDF export error:', e);
    alert('Erro ao gerar PDF. Tente novamente ou use a opção de impressão do navegador.');
  } finally {
    btn.innerHTML = origText;
    btn.disabled = false;
  }
}

function exportCSV() {
  document.getElementById('exportMenu').style.display = 'none';
  const account = document.querySelector('.nav-item.active[data-account]')?.dataset?.account || 'suno';
  fetch(`data/${account}.json?t=${Date.now()}`)
    .then(r => r.json())
    .then(d => {
      const posts = d.posts || [];
      if (!posts.length) { alert('Sem posts para exportar.'); return; }
      const cols = ['date','type','reach','views','engagement','engagement_rate','likes','comments','shares','saves','follows','caption'];
      const header = cols.join(',');
      const rows = posts.map(p =>
        cols.map(c => {
          const v = p[c] ?? '';
          return typeof v === 'string' && v.includes(',') ? `"${v.replace(/"/g,'""')}"` : v;
        }).join(',')
      );
      const csv = [header, ...rows].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `suno_${account}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    })
    .catch(() => alert('Erro ao carregar dados para exportação.'));
}

function exportJSON() {
  document.getElementById('exportMenu').style.display = 'none';
  const account = document.querySelector('.nav-item.active[data-account]')?.dataset?.account || 'suno';
  fetch(`data/${account}.json?t=${Date.now()}`)
    .then(r => r.json())
    .then(d => {
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `suno_${account}_${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    })
    .catch(() => alert('Erro ao carregar dados para exportação.'));
}


render('suno');
