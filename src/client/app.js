// ─── BotPrints Dashboard Client ─────────────────────────────────────────────
let currentFilter = 'all';
let allUsers = [];
let coordGroups = [];

async function fetchDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    return await res.json();
  } catch { return { users: [], coordGroups: [], summary: null }; }
}

async function loadDemoData() {
  const btn = document.getElementById('btn-demo');
  btn.textContent = 'Loading...'; btn.disabled = true;
  try { await fetch('/api/load-demo', { method: 'POST' }); await refreshDashboard(); }
  catch (e) { console.error(e); }
  btn.textContent = 'Load Demo Data'; btn.disabled = false;
}

async function dismissUser(username) {
  try { await fetch(`/api/dismiss/${encodeURIComponent(username)}`, { method: 'POST' }); await refreshDashboard(); }
  catch (e) { console.error(e); }
}

async function refreshDashboard() {
  show('loading'); hide('user-grid-content'); hide('empty-state'); hide('summary-grid'); hide('ring-alert');
  document.getElementById('user-grid').innerHTML = '';
  const data = await fetchDashboard();
  allUsers = data.users || [];
  coordGroups = data.coordGroups || [];
  hide('loading');
  if (data.summary) renderSummary(data.summary);
  if (coordGroups.length > 0) renderRingAlerts(coordGroups);
  renderUsers();
}

function renderSummary(s) {
  document.getElementById('s-tracked').textContent = s.totalTracked;
  document.getElementById('s-highrisk').textContent = s.highRiskCount;
  document.getElementById('s-shifted').textContent = s.shiftedCount;
  document.getElementById('s-rings').textContent = s.coordGroupCount;
  document.getElementById('s-health').textContent = s.healthScore;
  show('summary-grid');
}

function renderRingAlerts(groups) {
  const el = document.getElementById('ring-alert');
  el.innerHTML = groups.map(g => `
    <div class="ring-box">
      <div class="ring-header">
        <span class="ring-icon">🔗</span>
        <span class="ring-title">Coordinated Ring Detected: ${g.id}</span>
      </div>
      <div class="ring-members">
        ${g.members.map(m => `<span class="ring-member">u/${m}</span>`).join('')}
      </div>
      <div class="ring-meta">${g.sharedWindows} shared time windows · ${Math.round(g.avgCorrelation * 100)}% temporal correlation</div>
    </div>
  `).join('');
  show('ring-alert');
}

function renderUsers() {
  const grid = document.getElementById('user-grid');
  const empty = document.getElementById('empty-state');
  grid.innerHTML = '';
  let filtered = allUsers;
  if (currentFilter === 'high') filtered = allUsers.filter(u => u.score >= 70);
  if (currentFilter === 'shifted') filtered = allUsers.filter(u => u.shift?.shifted);
  if (currentFilter === 'ring') filtered = allUsers.filter(u => u.coordGroup);
  if (!filtered.length) { show('empty-state'); return; }
  hide('empty-state');
  filtered.sort((a, b) => b.score - a.score);
  filtered.forEach(u => grid.appendChild(createUserCard(u)));
}

function riskClass(s) { return s >= 70 ? 'high' : s >= 40 ? 'medium' : 'low'; }

function signalColor(v, max) {
  const r = v / max;
  return r >= 0.7 ? '#ff4757' : r >= 0.4 ? '#ffa502' : '#2ed573';
}

function createRadarSVG(b) {
  const vals = [b.temporal, b.circadian, b.engagement, b.editRate, b.burstSilence];
  const maxes = [25, 20, 20, 15, 20];
  const labels = ['TMP', 'CRC', 'ENG', 'EDT', 'BST'];
  const cx = 55, cy = 55, r = 40;
  const n = vals.length;
  const angles = vals.map((_, i) => (Math.PI * 2 * i) / n - Math.PI / 2);
  const grids = [0.25, 0.5, 0.75, 1].map(s =>
    `<circle cx="${cx}" cy="${cy}" r="${r*s}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>`).join('');
  const axes = angles.map(a =>
    `<line x1="${cx}" y1="${cy}" x2="${cx+r*Math.cos(a)}" y2="${cy+r*Math.sin(a)}" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>`).join('');
  const dataPts = vals.map((v,i) => {
    const ratio = Math.min(v/maxes[i], 1);
    return `${cx+r*ratio*Math.cos(angles[i])},${cy+r*ratio*Math.sin(angles[i])}`;
  }).join(' ');
  const total = vals.reduce((a,b)=>a+b,0);
  const totalMax = maxes.reduce((a,b)=>a+b,0);
  const pct = total/totalMax;
  const fill = pct > 0.7 ? 'rgba(255,71,87,0.25)' : pct > 0.4 ? 'rgba(255,165,2,0.2)' : 'rgba(46,213,115,0.15)';
  const stroke = pct > 0.7 ? '#ff4757' : pct > 0.4 ? '#ffa502' : '#2ed573';
  const lbls = labels.map((l,i) => {
    const lx = cx+(r+13)*Math.cos(angles[i]), ly = cy+(r+13)*Math.sin(angles[i]);
    return `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" fill="#8b929a" font-size="6.5" font-family="Inter,sans-serif">${l}</text>`;
  }).join('');
  return `<svg viewBox="0 0 110 110" width="100" height="100">${grids}${axes}
    <polygon points="${dataPts}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${lbls}</svg>`;
}

function createUserCard(user) {
  const risk = riskClass(user.score);
  const card = document.createElement('div');
  const ringClass = user.coordGroup ? ' in-ring' : '';
  card.className = `user-card risk-${risk}${ringClass}`;
  card.onclick = () => card.classList.toggle('expanded');
  const days = Math.max(1, Math.round((Date.now() - user.profile.firstSeen) / 86400000));
  const b = user.breakdown;

  const badges = [];
  if (user.shift?.shifted) badges.push(`<span class="badge badge-shifted">⚡ Shift z=${user.shift.magnitude}</span>`);
  if (user.coordGroup) badges.push(`<span class="badge badge-ring">🔗 ${user.coordGroup}</span>`);
  if (!badges.length) badges.push(`<span class="badge badge-stable">✓ Stable</span>`);

  card.innerHTML = `
    <div class="card-header">
      <div class="user-info">
        <div class="avatar">${user.username[0].toUpperCase()}</div>
        <div>
          <div class="username">u/${user.username}</div>
          <div class="user-meta">${user.profile.posts}P · ${user.profile.comments}C · ${user.profile.edits}E · ${days}d</div>
          <div class="user-badges">${badges.join('')}</div>
        </div>
      </div>
      <div><div class="score-badge ${risk}">${user.score}</div><div class="score-label">Risk</div></div>
    </div>
    <div class="signals">
      ${sig('Temporal', b.temporal, 25)}${sig('Circadian', b.circadian, 20)}${sig('Engage', b.engagement, 20)}${sig('Edit', b.editRate, 15)}${sig('Burst', b.burstSilence, 20)}
    </div>
    <div class="card-details"><div class="details-inner">
      <div class="radar-row">${createRadarSVG(b)}</div>
      <div class="card-actions">
        <button class="btn-action" onclick="event.stopPropagation()">👁 Watch</button>
        <button class="btn-action" onclick="event.stopPropagation()">⚠ Restrict</button>
        <button class="btn-action dismiss" onclick="event.stopPropagation();dismissUser('${user.username}')">✕ Dismiss</button>
      </div>
    </div></div>`;
  return card;
}

function sig(label, value, max) {
  const c = signalColor(value, max);
  return `<div class="signal"><div class="signal-value" style="color:${c}">${value}</div>
    <div class="signal-label">${label}</div>
    <div class="signal-bar"><div class="signal-bar-fill" style="width:${(value/max)*100}%;background:${c}"></div></div></div>`;
}

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

document.addEventListener('DOMContentLoaded', () => {
  refreshDashboard();
  document.getElementById('btn-demo').addEventListener('click', loadDemoData);
  document.getElementById('btn-refresh').addEventListener('click', refreshDashboard);
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderUsers();
    });
  });
});
