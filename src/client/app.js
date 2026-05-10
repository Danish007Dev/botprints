// ─── BotPrints Dashboard Client ─────────────────────────────────────────────
let currentFilter = 'all';
let allUsers = [];

async function fetchDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch dashboard:', err);
    return { users: [], totalTracked: 0, lastUpdated: 0 };
  }
}

async function loadDemoData() {
  const btn = document.getElementById('btn-demo');
  btn.textContent = 'Loading...';
  btn.disabled = true;
  try {
    await fetch('/api/load-demo', { method: 'POST' });
    await refreshDashboard();
  } catch (err) {
    console.error('Failed to load demo:', err);
  }
  btn.textContent = 'Load Demo Data';
  btn.disabled = false;
}

async function dismissUser(username) {
  try {
    await fetch(`/api/dismiss/${encodeURIComponent(username)}`, { method: 'POST' });
    await refreshDashboard();
  } catch (err) {
    console.error('Failed to dismiss:', err);
  }
}

async function refreshDashboard() {
  const loading = document.getElementById('loading');
  const grid = document.getElementById('user-grid');
  const empty = document.getElementById('empty-state');
  loading.style.display = 'block';
  grid.innerHTML = '';
  empty.style.display = 'none';

  const data = await fetchDashboard();
  allUsers = data.users || [];
  document.getElementById('tracked-count').textContent = `${data.totalTracked} tracked`;
  loading.style.display = 'none';
  renderUsers();
}

function renderUsers() {
  const grid = document.getElementById('user-grid');
  const empty = document.getElementById('empty-state');
  grid.innerHTML = '';

  let filtered = allUsers;
  if (currentFilter === 'high') filtered = allUsers.filter(u => u.score >= 70);
  if (currentFilter === 'shifted') filtered = allUsers.filter(u => u.shift?.shifted);

  if (filtered.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  filtered.sort((a, b) => b.score - a.score);
  filtered.forEach(u => grid.appendChild(createUserCard(u)));
}

function riskClass(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function createRadarSVG(breakdown) {
  const { temporal, circadian, engagement, editRate } = breakdown;
  const maxes = [30, 25, 25, 20];
  const vals = [temporal, circadian, engagement, editRate];
  const labels = ['TMP', 'CRC', 'ENG', 'EDT'];
  const cx = 55, cy = 55, r = 40;
  const angles = vals.map((_, i) => (Math.PI * 2 * i) / vals.length - Math.PI / 2);

  // Outer polygon
  const outerPts = angles.map(a => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`).join(' ');
  // Data polygon
  const dataPts = vals.map((v, i) => {
    const ratio = Math.min(v / maxes[i], 1);
    const a = angles[i];
    return `${cx + r * ratio * Math.cos(a)},${cy + r * ratio * Math.sin(a)}`;
  }).join(' ');
  // Grid circles
  const grids = [0.25, 0.5, 0.75, 1].map(s =>
    `<circle cx="${cx}" cy="${cy}" r="${r * s}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>`
  ).join('');
  // Axes
  const axes = angles.map(a =>
    `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(a)}" y2="${cy + r * Math.sin(a)}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>`
  ).join('');
  // Labels
  const lbls = labels.map((l, i) => {
    const a = angles[i];
    const lx = cx + (r + 12) * Math.cos(a);
    const ly = cy + (r + 12) * Math.sin(a);
    return `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" fill="#9aa0a6" font-size="7" font-family="Inter,sans-serif">${l}</text>`;
  }).join('');

  const total = vals.reduce((a, b) => a + b, 0);
  const totalMax = maxes.reduce((a, b) => a + b, 0);
  const fillColor = total / totalMax > 0.7 ? 'rgba(255,68,68,0.3)' : total / totalMax > 0.4 ? 'rgba(255,171,0,0.25)' : 'rgba(0,200,83,0.2)';
  const strokeColor = total / totalMax > 0.7 ? '#ff4444' : total / totalMax > 0.4 ? '#ffab00' : '#00c853';

  return `<svg viewBox="0 0 110 110" width="100" height="100">
    ${grids}${axes}
    <polygon points="${outerPts}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <polygon points="${dataPts}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"/>
    ${lbls}
  </svg>`;
}

function createUserCard(user) {
  const risk = riskClass(user.score);
  const card = document.createElement('div');
  card.className = `user-card risk-${risk}`;
  card.onclick = () => card.classList.toggle('expanded');

  const daysActive = Math.max(1, Math.round((Date.now() - user.profile.firstSeen) / 86400000));
  const b = user.breakdown;

  card.innerHTML = `
    <div class="card-header">
      <div class="user-info">
        <div class="avatar">${user.username[0].toUpperCase()}</div>
        <div>
          <div class="username">u/${user.username}</div>
          <div class="user-meta">${user.profile.posts}P · ${user.profile.comments}C · ${daysActive}d active</div>
        </div>
      </div>
      <div>
        <div class="score-badge ${risk}">${user.score}</div>
        <div class="score-label">RISK</div>
      </div>
    </div>
    <div class="signals">
      <div class="signal">
        <div class="signal-value" style="color:${signalColor(b.temporal, 30)}">${b.temporal}</div>
        <div class="signal-label">Temporal</div>
        <div class="signal-bar"><div class="signal-bar-fill" style="width:${(b.temporal / 30) * 100}%;background:${signalColor(b.temporal, 30)}"></div></div>
      </div>
      <div class="signal">
        <div class="signal-value" style="color:${signalColor(b.circadian, 25)}">${b.circadian}</div>
        <div class="signal-label">Circadian</div>
        <div class="signal-bar"><div class="signal-bar-fill" style="width:${(b.circadian / 25) * 100}%;background:${signalColor(b.circadian, 25)}"></div></div>
      </div>
      <div class="signal">
        <div class="signal-value" style="color:${signalColor(b.engagement, 25)}">${b.engagement}</div>
        <div class="signal-label">Engage</div>
        <div class="signal-bar"><div class="signal-bar-fill" style="width:${(b.engagement / 25) * 100}%;background:${signalColor(b.engagement, 25)}"></div></div>
      </div>
      <div class="signal">
        <div class="signal-value" style="color:${signalColor(b.editRate, 20)}">${b.editRate}</div>
        <div class="signal-label">Edit Rate</div>
        <div class="signal-bar"><div class="signal-bar-fill" style="width:${(b.editRate / 20) * 100}%;background:${signalColor(b.editRate, 20)}"></div></div>
      </div>
    </div>
    <div class="card-details">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="radar-container">${createRadarSVG(b)}</div>
        <div>
          <span class="shift-badge ${user.shift?.shifted ? 'shifted' : 'stable'}">
            ${user.shift?.shifted ? `⚡ Shift z=${user.shift.magnitude}` : '✓ Stable'}
          </span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn-action" onclick="event.stopPropagation()">👁 Watch</button>
        <button class="btn-action" onclick="event.stopPropagation()">⚠ Restrict</button>
        <button class="btn-action dismiss" onclick="event.stopPropagation();dismissUser('${user.username}')">✕ Dismiss</button>
      </div>
    </div>
  `;
  return card;
}

function signalColor(value, max) {
  const ratio = value / max;
  if (ratio >= 0.7) return '#ff4444';
  if (ratio >= 0.4) return '#ffab00';
  return '#00c853';
}

// ─── Event Listeners ────────────────────────────────────────────────────────
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
