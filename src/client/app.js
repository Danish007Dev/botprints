// ─── BotPrints Dashboard Client v2 ──────────────────────────────────────────
// Completely defensive — every DOM access wrapped, every value defaulted.
(function() {
  'use strict';

  var currentFilter = 'all';
  var allUsers = [];
  var allClearedUsers = [];
  var coordGroups = [];
  var isDemoLoaded = false;

  // Ultra-safe DOM helpers
  function getEl(id) {
    try { return document.getElementById(id); } catch(e) { return null; }
  }
  function showEl(id) {
    var el = getEl(id);
    if (el) el.style.display = '';
  }
  function hideEl(id) {
    var el = getEl(id);
    if (el) el.style.display = 'none';
  }
  function setTxt(id, txt) {
    var el = getEl(id);
    if (el) el.textContent = String(txt);
  }

  // Toast UI
  function showToast(msg, type) {
    var t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'info');
    t.textContent = msg;
    t.style.position = 'fixed';
    t.style.bottom = '20px';
    t.style.left = '50%';
    t.style.transform = 'translateX(-50%)';
    t.style.background = type === 'error' ? '#ff4757' : '#2ed573';
    t.style.color = '#fff';
    t.style.padding = '10px 20px';
    t.style.borderRadius = '20px';
    t.style.zIndex = '9999';
    t.style.fontWeight = 'bold';
    t.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
    document.body.appendChild(t);
    setTimeout(function() { document.body.removeChild(t); }, 4000);
  }

  // ─── API ────────────────────────────────────────────────────────────────────
  function fetchDashboard() {
    return fetch('/api/dashboard')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function(e) {
        console.error('BotPrints fetch error:', e);
        return { users: [], coordGroups: [], summary: null };
      });
  }

  function toggleDemoData() {
    var btn = getEl('btn-demo');
    if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }
    var endpoint = isDemoLoaded ? '/api/unload-demo' : '/api/load-demo';
    return fetch(endpoint, { method: 'POST' })
      .then(function() { return refreshDashboard(); })
      .catch(function(e) { console.error('Demo error:', e); })
      .then(function() {
        if (btn) btn.disabled = false;
      });
  }

  // Make markSafeUser globally accessible
  window.markSafeUser = function(username) {
    return fetch('/api/dismiss/' + encodeURIComponent(username), { method: 'POST' })
      .then(function() { return refreshDashboard(); })
      .catch(function(e) { console.error('Mark safe error:', e); });
  };

  function refreshDashboard() {
    showEl('loading');
    hideEl('empty-state');
    hideEl('summary-grid');
    hideEl('ring-alert');

    var grid = getEl('user-grid');
    if (grid) grid.innerHTML = '';

    return fetchDashboard().then(function(data) {
      allUsers = (data && data.users) || [];
      allClearedUsers = (data && data.clearedUsers) || [];
      coordGroups = (data && data.coordGroups) || [];
      isDemoLoaded = (data && data.isDemoLoaded) || false;
      hideEl('loading');
      
      var btn = getEl('btn-demo');
      if (btn) {
        if (isDemoLoaded) {
          btn.textContent = 'Remove Demo Data';
          btn.classList.add('action-safe');
        } else {
          btn.textContent = 'Load Demo Data';
          btn.classList.remove('action-safe');
        }
      }

      if (data && data.summary && data.summary.totalTracked > 0) {
        renderSummary(data.summary);
      }
      if (coordGroups.length > 0) {
        renderRingAlerts(coordGroups);
      }
      renderUsers();
    });
  }

  function renderSummary(s) {
    if (!s) return;
    setTxt('s-tracked', s.totalTracked || 0);
    setTxt('s-highrisk', s.highRiskCount || 0);
    setTxt('s-shifted', s.shiftedCount || 0);
    setTxt('s-rings', s.coordGroupCount || 0);
    setTxt('s-health', s.healthScore || 0);
    showEl('summary-grid');
  }

  function renderRingAlerts(groups) {
    var el = getEl('ring-alert');
    if (!el || !groups || !groups.length) return;
    var html = '';
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var members = '';
      if (g.members) {
        for (var j = 0; j < g.members.length; j++) {
          members += '<span class="ring-member">u/' + g.members[j] + '</span>';
        }
      }
      html += '<div class="ring-box">' +
        '<div class="ring-header">' +
          '<span class="ring-icon">🔗</span>' +
          '<span class="ring-title">Coordinated Ring Detected: ' + (g.id || '?') + '</span>' +
        '</div>' +
        '<div class="ring-members">' + members + '</div>' +
        '<div class="ring-meta">' + (g.sharedWindows || 0) + ' shared time windows · ' +
          Math.round((g.avgCorrelation || 0) * 100) + '% temporal correlation</div>' +
      '</div>';
    }
    el.innerHTML = html;
    showEl('ring-alert');
  }

  function renderUsers() {
    var grid = getEl('user-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var filtered = allUsers;
    if (currentFilter === 'high') {
      filtered = allUsers.filter(function(u) { return u.score >= 70; });
    } else if (currentFilter === 'shifted') {
      filtered = allUsers.filter(function(u) { return u.shift && u.shift.shifted; });
    } else if (currentFilter === 'ring') {
      filtered = allUsers.filter(function(u) { return u.coordGroup; });
    } else if (currentFilter === 'safe') {
      filtered = allClearedUsers;
    }

    if (!filtered.length) { showEl('empty-state'); return; }
    hideEl('empty-state');

    filtered.sort(function(a, b) { return b.score - a.score; });
    for (var i = 0; i < filtered.length; i++) {
      grid.appendChild(createUserCard(filtered[i]));
    }
  }

  function riskClass(s) { return s >= 70 ? 'high' : s >= 40 ? 'medium' : 'low'; }
  function sigColor(v, max) {
    if (max <= 0) return '#2ed573';
    var r = v / max;
    return r >= 0.7 ? '#ff4757' : r >= 0.4 ? '#ffa502' : '#2ed573';
  }

  function createRadarSVG(b) {
    if (!b) b = {};
    var vals = [b.temporal || 0, b.circadian || 0, b.engagement || 0, b.editRate || 0, b.burstSilence || 0];
    var maxes = [25, 20, 20, 15, 20];
    var labels = ['Time', 'Day', 'Act', 'Edit', 'Spk'];
    var cx = 55, cy = 55, radius = 40, n = 5;

    var angles = [];
    for (var i = 0; i < n; i++) angles.push((Math.PI * 2 * i) / n - Math.PI / 2);

    var svg = '<svg viewBox="0 0 110 110" width="100" height="100">';

    // Grid circles
    var gridLevels = [0.25, 0.5, 0.75, 1];
    for (var g = 0; g < gridLevels.length; g++) {
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (radius * gridLevels[g]) +
        '" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>';
    }
    // Axes
    for (var a = 0; a < angles.length; a++) {
      svg += '<line x1="' + cx + '" y1="' + cy +
        '" x2="' + (cx + radius * Math.cos(angles[a])) +
        '" y2="' + (cy + radius * Math.sin(angles[a])) +
        '" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>';
    }
    // Data polygon
    var pts = [];
    for (var d = 0; d < n; d++) {
      var ratio = maxes[d] > 0 ? Math.min(vals[d] / maxes[d], 1) : 0;
      pts.push((cx + radius * ratio * Math.cos(angles[d])) + ',' +
        (cy + radius * ratio * Math.sin(angles[d])));
    }
    var total = 0, totalMax = 0;
    for (var s = 0; s < n; s++) { total += vals[s]; totalMax += maxes[s]; }
    var pct = totalMax > 0 ? total / totalMax : 0;
    var fill = pct > 0.7 ? 'rgba(255,71,87,0.25)' : pct > 0.4 ? 'rgba(255,165,2,0.2)' : 'rgba(46,213,115,0.15)';
    var stroke = pct > 0.7 ? '#ff4757' : pct > 0.4 ? '#ffa502' : '#2ed573';
    svg += '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    // Labels
    for (var l = 0; l < labels.length; l++) {
      var lx = cx + (radius + 13) * Math.cos(angles[l]);
      var ly = cy + (radius + 13) * Math.sin(angles[l]);
      svg += '<text x="' + lx + '" y="' + ly +
        '" text-anchor="middle" dominant-baseline="central" fill="#8b929a" font-size="6.5">' +
        labels[l] + '</text>';
    }
    svg += '</svg>';
    return svg;
  }

  function sigHTML(label, value, max) {
    var c = sigColor(value, max);
    var w = max > 0 ? ((value / max) * 100) : 0;
    return '<div class="signal">' +
      '<div class="signal-value" style="color:' + c + '">' + value + '</div>' +
      '<div class="signal-label">' + label + '</div>' +
      '<div class="signal-bar"><div class="signal-bar-fill" style="width:' + w + '%;background:' + c + '"></div></div>' +
    '</div>';
  }

  function createUserCard(user) {
    if (!user) return document.createElement('div');
    var risk = riskClass(user.score || 0);
    var card = document.createElement('div');
    var ringClass = user.coordGroup ? ' in-ring' : '';
    card.className = 'user-card risk-' + risk + ringClass;
    card.onclick = function() { card.classList.toggle('expanded'); };

    var profile = user.profile || {};
    var days = Math.max(1, Math.round((Date.now() - (profile.firstSeen || Date.now())) / 86400000));
    var b = user.breakdown || {};
    var uname = user.username || 'unknown';

    var badges = '';
    if (user.shift && user.shift.shifted) badges += '<span class="badge badge-shifted">⚡ Behavior Changed</span>';
    if (user.coordGroup) badges += '<span class="badge badge-ring">🔗 Coordinated Group</span>';
    if (!badges) badges = '<span class="badge badge-stable">✓ Normal Behavior</span>';

    // Action functions are now internal to this scope since we attach them directly
    function onWatchUser(u, btn) {
      btn.textContent = 'Watching...';
      btn.disabled = true;
      fetch('/api/watch/' + encodeURIComponent(u), { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') { 
            btn.textContent = '👁 Watched'; 
            showToast('Watching u/' + u + '. You will receive a Modmail when they post.', 'success');
          } else { 
            btn.textContent = 'Error'; btn.disabled = false; 
            showToast('Failed to watch u/' + u + ': ' + data.message, 'error');
          }
        })
        .catch(function(err) { 
          btn.textContent = 'Error'; btn.disabled = false; 
          showToast('Failed to watch u/' + u + ' (Network error)', 'error');
        });
    }

    function onRestrictUser(u, btn) {
      btn.textContent = 'Restricting...';
      btn.disabled = true;
      fetch('/api/restrict/' + encodeURIComponent(u), { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') { 
            btn.textContent = '⚠ Restricted'; 
            showToast('Restricted u/' + u + '. They have been muted.', 'success');
          } else { 
            btn.textContent = 'Error'; btn.disabled = false; 
            showToast('Failed to restrict u/' + u + ': ' + data.message, 'error');
          }
        })
        .catch(function() { 
          btn.textContent = 'Error'; btn.disabled = false; 
          showToast('Failed to restrict u/' + u + ' (Network error)', 'error');
        });
    }

    function onMarkSafeUser(u) {
      fetch('/api/dismiss/' + encodeURIComponent(u), { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') {
            showToast('Marked u/' + u + ' as safe', 'success');
            setTimeout(refreshDashboard, 500);
          } else {
            showToast('Failed to mark u/' + u + ' as safe', 'error');
          }
        })
        .catch(function() { showToast('Error marking u/' + u + ' safe', 'error'); });
    }

    function onUndismissUser(u) {
      fetch('/api/undismiss/' + encodeURIComponent(u), { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') {
            showToast('Re-analyzing u/' + u, 'success');
            setTimeout(refreshDashboard, 500);
          } else {
            showToast('Failed to re-analyze u/' + u, 'error');
          }
        })
        .catch(function() { showToast('Error re-analyzing u/' + u, 'error'); });
    }

    var html =
      '<div class="card-header">' +
        '<div class="user-info">' +
          '<div class="avatar">' + uname[0].toUpperCase() + '</div>' +
          '<div>' +
            '<div class="username">u/' + uname + '</div>' +
            '<div class="user-meta">' + (profile.posts || 0) + ' posts, ' + (profile.comments || 0) + ' comments, ' + (profile.edits || 0) + ' edits, active ' + days + ' days</div>' +
            '<div class="user-badges">' + badges + '</div>' +
          '</div>' +
        '</div>' +
        '<div><div class="score-badge ' + risk + '">' + (user.score || 0) + '</div><div class="score-label">Risk</div></div>' +
      '</div>' +
      '<div class="signals">' +
        sigHTML('Timing', b.temporal || 0, 25) +
        sigHTML('Daily Pattern', b.circadian || 0, 20) +
        sigHTML('Activity', b.engagement || 0, 20) +
        sigHTML('Edits', b.editRate || 0, 15) +
        sigHTML('Spikes', b.burstSilence || 0, 20) +
      '</div>' +
      '<div class="card-details"><div class="details-inner">' +
        '<div class="radar-row">' + createRadarSVG(b) + '</div>' +
        '<div class="card-actions">';
        
    if (user.isCleared) {
      html += '<button class="btn-action action-undismiss" data-user="' + uname + '">↺ Re-Analyze</button>';
    } else {
      html += '<button class="btn-action action-watch" data-user="' + uname + '">' + (user.isWatched ? '👁 Watched' : '👁 Watch') + '</button>' +
        '<button class="btn-action action-restrict" data-user="' + uname + '">⚠ Restrict</button>' +
        '<button class="btn-action action-safe" data-user="' + uname + '">✓ Mark Safe</button>';
    }
    html += '</div></div></div>';
    card.innerHTML = html;

    // Attach event listeners safely to comply with CSP
    var watchBtn = card.querySelector('.action-watch');
    if (watchBtn) watchBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onWatchUser(uname, watchBtn);
    });

    var restrictBtn = card.querySelector('.action-restrict');
    if (restrictBtn) restrictBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onRestrictUser(uname, restrictBtn);
    });

    var safeBtn = card.querySelector('.action-safe');
    if (safeBtn) safeBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onMarkSafeUser(uname);
    });

    var undismissBtn = card.querySelector('.action-undismiss');
    if (undismissBtn) undismissBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onUndismissUser(uname);
    });

    return card;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    try {
      refreshDashboard();

      var demoBtn = getEl('btn-demo');
      if (demoBtn) demoBtn.addEventListener('click', function() { toggleDemoData(); });

      var refreshBtn = getEl('btn-refresh');
      if (refreshBtn) refreshBtn.addEventListener('click', function() { refreshDashboard(); });

      var helpBtn = getEl('btn-help');
      if (helpBtn) helpBtn.addEventListener('click', function() { showEl('help-modal'); });

      var closeHelpBtn = getEl('btn-close-help');
      if (closeHelpBtn) closeHelpBtn.addEventListener('click', function() { hideEl('help-modal'); });

      var tabs = document.querySelectorAll('.filter-tab');
      for (var i = 0; i < tabs.length; i++) {
        (function(tab) {
          tab.addEventListener('click', function() {
            var allTabs = document.querySelectorAll('.filter-tab');
            for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove('active');
            tab.classList.add('active');
            currentFilter = tab.getAttribute('data-filter') || 'all';
            renderUsers();
          });
        })(tabs[i]);
      }
    } catch (e) {
      console.error('BotPrints init error:', e);
    }
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
