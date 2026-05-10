// ─── BotPrints Dashboard Client ─────────────────────────────────────────────
let currentFilter = 'all';
let allUsers = [];
let coordGroups = [];

// Null-safe DOM helpers
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.style.display = ''; }
function hide(id) { const el = $(id); if (el) el.style.display = 'none'; }
function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

async function fetchDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('API returned ' + res.status);
    return await res.json();
  } catch (e) {
    console.error('BotPrints fetch error:', e);
    return { users: [], coordGroups: [], summary: null };
  }
}

async function loadDemoData() {
  const btn = $('btn-demo');
  if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }
  try {
    await fetch('/api/load-demo', { method: 'POST' });
    await refreshDashboard();
  } catch (e) { console.error('Demo load error:', e); }
  if (btn) { btn.textContent = 'Load Demo Data'; btn.disabled = false; }
}

async function dismissUser(username) {
  try {
    await fetch('/api/dismiss/' + encodeURIComponent(username), { method: 'POST' });
    await refreshDashboard();
  } catch (e) { console.error('Dismiss error:', e); }
}

async function refreshDashboard() {
  show('loading');
  hide('empty-state');
  hide('summary-grid');
  hide('ring-alert');
  const grid = $('user-grid');
  if (grid) grid.innerHTML = '';

  const data = await fetchDashboard();
  allUsers = data.users || [];
  coordGroups = data.coordGroups || [];

  hide('loading');

  if (data.summary && data.summary.totalTracked > 0) {
    renderSummary(data.summary);
  }
  if (coordGroups.length > 0) {
    renderRingAlerts(coordGroups);
  }
  renderUsers();
}

function renderSummary(s) {
  setText('s-tracked', s.totalTracked);
  setText('s-highrisk', s.highRiskCount);
  setText('s-shifted', s.shiftedCount);
  setText('s-rings', s.coordGroupCount);
  setText('s-health', s.healthScore);
  show('summary-grid');
}

function renderRingAlerts(groups) {
  const el = $('ring-alert');
  if (!el) return;
  el.innerHTML = groups.map(function(g) {
    var members = g.members.map(function(m) {
      return '<span class="ring-member">u/' + m + '</span>';
    }).join('');
    return '<div class="ring-box">' +
      '<div class="ring-header">' +
        '<span class="ring-icon">🔗</span>' +
        '<span class="ring-title">Coordinated Ring Detected: ' + g.id + '</span>' +
      '</div>' +
      '<div class="ring-members">' + members + '</div>' +
      '<div class="ring-meta">' + g.sharedWindows + ' shared time windows · ' +
        Math.round(g.avgCorrelation * 100) + '% temporal correlation</div>' +
    '</div>';
  }).join('');
  show('ring-alert');
}

function renderUsers() {
  var grid = $('user-grid');
  if (!grid) return;
  grid.innerHTML = '';

  var filtered = allUsers;
  if (currentFilter === 'high') filtered = allUsers.filter(function(u) { return u.score >= 70; });
  if (currentFilter === 'shifted') filtered = allUsers.filter(function(u) { return u.shift && u.shift.shifted; });
  if (currentFilter === 'ring') filtered = allUsers.filter(function(u) { return u.coordGroup; });

  if (!filtered.length) { show('empty-state'); return; }
  hide('empty-state');

  filtered.sort(function(a, b) { return b.score - a.score; });
  filtered.forEach(function(u) { grid.appendChild(createUserCard(u)); });
}

function riskClass(s) { return s >= 70 ? 'high' : s >= 40 ? 'medium' : 'low'; }

function signalColor(v, max) {
  var r = v / max;
  return r >= 0.7 ? '#ff4757' : r >= 0.4 ? '#ffa502' : '#2ed573';
}

function createRadarSVG(b) {
  var vals = [b.temporal || 0, b.circadian || 0, b.engagement || 0, b.editRate || 0, b.burstSilence || 0];
  var maxes = [25, 20, 20, 15, 20];
  var labels = ['TMP', 'CRC', 'ENG', 'EDT', 'BST'];
  var cx = 55, cy = 55, r = 40, n = 5;
  var angles = [];
  for (var i = 0; i < n; i++) angles.push((Math.PI * 2 * i) / n - Math.PI / 2);

  var svg = '<svg viewBox="0 0 110 110" width="100" height="100">';
  // Grid circles
  [0.25, 0.5, 0.75, 1].forEach(function(s) {
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r*s) + '" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>';
  });
  // Axes
  angles.forEach(function(a) {
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx+r*Math.cos(a)) + '" y2="' + (cy+r*Math.sin(a)) + '" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>';
  });
  // Data polygon
  var pts = [];
  for (var j = 0; j < n; j++) {
    var ratio = Math.min(vals[j] / maxes[j], 1);
    pts.push((cx + r * ratio * Math.cos(angles[j])) + ',' + (cy + r * ratio * Math.sin(angles[j])));
  }
  var total = vals.reduce(function(a, b) { return a + b; }, 0);
  var totalMax = maxes.reduce(function(a, b) { return a + b; }, 0);
  var pct = total / totalMax;
  var fill = pct > 0.7 ? 'rgba(255,71,87,0.25)' : pct > 0.4 ? 'rgba(255,165,2,0.2)' : 'rgba(46,213,115,0.15)';
  var stroke = pct > 0.7 ? '#ff4757' : pct > 0.4 ? '#ffa502' : '#2ed573';
  svg += '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
  // Labels
  labels.forEach(function(l, idx) {
    var lx = cx + (r + 13) * Math.cos(angles[idx]);
    var ly = cy + (r + 13) * Math.sin(angles[idx]);
    svg += '<text x="' + lx + '" y="' + ly + '" text-anchor="middle" dominant-baseline="central" fill="#8b929a" font-size="6.5" font-family="Inter,sans-serif">' + l + '</text>';
  });
  svg += '</svg>';
  return svg;
}

function createUserCard(user) {
  var risk = riskClass(user.score);
  var card = document.createElement('div');
  var ringClass = user.coordGroup ? ' in-ring' : '';
  card.className = 'user-card risk-' + risk + ringClass;
  card.onclick = function() { card.classList.toggle('expanded'); };

  var days = Math.max(1, Math.round((Date.now() - (user.profile.firstSeen || Date.now())) / 86400000));
  var b = user.breakdown || {};
  var p = user.profile || {};

  var badgesHTML = '';
  if (user.shift && user.shift.shifted) badgesHTML += '<span class="badge badge-shifted">⚡ Shift z=' + user.shift.magnitude + '</span>';
  if (user.coordGroup) badgesHTML += '<span class="badge badge-ring">🔗 ' + user.coordGroup + '</span>';
  if (!badgesHTML) badgesHTML = '<span class="badge badge-stable">✓ Stable</span>';

  card.innerHTML =
    '<div class="card-header">' +
      '<div class="user-info">' +
        '<div class="avatar">' + (user.username || '?')[0].toUpperCase() + '</div>' +
        '<div>' +
          '<div class="username">u/' + user.username + '</div>' +
          '<div class="user-meta">' + (p.posts||0) + 'P · ' + (p.comments||0) + 'C · ' + (p.edits||0) + 'E · ' + days + 'd</div>' +
          '<div class="user-badges">' + badgesHTML + '</div>' +
        '</div>' +
      '</div>' +
      '<div><div class="score-badge ' + risk + '">' + user.score + '</div><div class="score-label">Risk</div></div>' +
    '</div>' +
    '<div class="signals">' +
      sigHTML('Temporal', b.temporal||0, 25) +
      sigHTML('Circadian', b.circadian||0, 20) +
      sigHTML('Engage', b.engagement||0, 20) +
      sigHTML('Edit', b.editRate||0, 15) +
      sigHTML('Burst', b.burstSilence||0, 20) +
    '</div>' +
    '<div class="card-details"><div class="details-inner">' +
      '<div class="radar-row">' + createRadarSVG(b) + '</div>' +
      '<div class="card-actions">' +
        '<button class="btn-action" onclick="event.stopPropagation()">👁 Watch</button>' +
        '<button class="btn-action" onclick="event.stopPropagation()">⚠ Restrict</button>' +
        '<button class="btn-action dismiss" onclick="event.stopPropagation();dismissUser(\'' + user.username + '\')">✕ Dismiss</button>' +
      '</div>' +
    '</div></div>';
  return card;
}

function sigHTML(label, value, max) {
  var c = signalColor(value, max);
  var w = max > 0 ? ((value / max) * 100) : 0;
  return '<div class="signal">' +
    '<div class="signal-value" style="color:' + c + '">' + value + '</div>' +
    '<div class="signal-label">' + label + '</div>' +
    '<div class="signal-bar"><div class="signal-bar-fill" style="width:' + w + '%;background:' + c + '"></div></div>' +
  '</div>';
}

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  refreshDashboard();

  var demoBtn = $('btn-demo');
  if (demoBtn) demoBtn.addEventListener('click', loadDemoData);

  var refreshBtn = $('btn-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshDashboard);

  document.querySelectorAll('.filter-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      currentFilter = tab.getAttribute('data-filter');
      renderUsers();
    });
  });
});
