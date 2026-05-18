// ─── BotPrints Dashboard Client v2 ──────────────────────────────────────────
// Completely defensive — every DOM access wrapped, every value defaulted.
(function() {
  'use strict';

  var currentFilter = 'all';
  var currentView = 'dashboard';
  var allUsers = [];
  var allClearedUsers = [];
  var coordGroups = [];
  var allAppeals = [];
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
        if (res.status === 403) {
          return { _accessDenied: true, users: [], coordGroups: [], summary: null };
        }
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
      // ─── SECURITY: Block non-moderator access at the UI level ─────────
      if (data && data._accessDenied) {
        hideEl('loading');
        hideEl('summary-grid');
        hideEl('ring-alert');
        hideEl('empty-state');
        var grid = getEl('user-grid');
        if (grid) grid.innerHTML = '';
        // Hide mod-only controls
        var header = document.querySelector('.header-right');
        if (header) header.style.display = 'none';
        var filters = document.querySelector('.filters');
        if (filters) filters.style.display = 'none';
        // Show access denied
        var app = getEl('app');
        if (app) {
          var denied = document.createElement('div');
          denied.className = 'access-denied';
          denied.innerHTML =
            '<div class="denied-icon">🔒</div>' +
            '<h2>Moderator Access Only</h2>' +
            '<p>The BotPrints Behavioral Forensics Dashboard is restricted to subreddit moderators.</p>' +
            '<p class="denied-sub">If you are a moderator, please ensure you are logged into an account with moderator privileges for this subreddit.</p>';
          app.appendChild(denied);
        }
        return;
      }
      // ────────────────────────────────────────────────────────────────────

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

      // Fetch pending appeals
      fetch('/api/appeals/pending')
        .then(function(res) { return res.json(); })
        .then(function(aData) {
          allAppeals = (aData && aData.appeals) || [];
          if (currentFilter === 'appeals') renderUsers();
        })
        .catch(function(e) { console.error('Appeals error:', e); });

      // Poll raid status independently
      fetchRaidStatus();

      // Fetch Time Saved Metrics
      fetch('/api/metrics')
        .then(function(res) { return res.json(); })
        .then(function(mData) {
          if (mData && mData.metrics) renderMetrics(mData.metrics);
        })
        .catch(function(e) { console.error('Metrics error:', e); });
    });
  }

  function renderSummary(s) {
    if (!s) return;
    setTxt('s-tracked', s.totalTracked || 0);
    setTxt('s-highrisk', s.highRiskCount || 0);
    setTxt('s-shifted', s.shiftedCount || 0);
    setTxt('s-rings', s.coordGroupCount || 0);
    setTxt('s-health', s.healthScore || 0);
    showEl('summary-grid'); // keep summary grid just in case, but metrics-dashboard is main
  }

  function renderMetrics(m) {
    if (!m) return;
    setTxt('m-hours', m.hoursSaved || '0.0');
    setTxt('m-actioned', m.accounts_actioned || 0);
    setTxt('m-filtered', m.items_filtered || 0);
    setTxt('m-bans', m.bans_issued || 0);
    setTxt('m-rings', m.rings_detected || 0);
    setTxt('m-appeals', m.appeals_sent || 0);
    
    var conversion = 0;
    if (m.appeals_sent && m.appeals_sent > 0) {
      conversion = Math.round((m.appeals_responded / m.appeals_sent) * 100);
    }
    setTxt('m-conversion', conversion + '%');
    
    showEl('metrics-dashboard');
    
    if (m.dailyActivity && m.dailyActivity.length > 0) {
      drawSparkline('sparkline-chart', m.dailyActivity);
    }
  }

  function drawSparkline(canvasId, data) {
    var canvas = getEl(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    
    var maxVal = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].count > maxVal) maxVal = data[i].count;
    }
    if (maxVal === 0) maxVal = 10;
    
    var step = w / Math.max(1, data.length - 1);
    
    ctx.beginPath();
    ctx.strokeStyle = '#18dcff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    
    // We expect 14 days, from oldest to newest. But dailyActivity currently gives 13 down to 0, which means oldest first.
    for (var i = 0; i < data.length; i++) {
      var val = data[i].count;
      var x = i * step;
      var y = h - ((val / maxVal) * (h - 4)) - 2;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    
    ctx.stroke();
    
    // Fill
    var gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(24, 220, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(24, 220, 255, 0)');
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fillStyle = gradient;
    ctx.fill();
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

  // ─── Raid Detection UI ──────────────────────────────────────────────────

  function fetchRaidStatus() {
    fetch('/api/raid-status')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data && data.raid && data.raid.active) {
          renderRaidBanner(data.raid);
        } else {
          hideRaidBanner();
        }
      })
      .catch(function() { hideRaidBanner(); });
  }

  function renderRaidBanner(raid) {
    var container = getEl('raid-banner');
    if (!container) {
      // Create the banner element if it doesn't exist
      container = document.createElement('div');
      container.id = 'raid-banner';
      var app = getEl('app');
      if (app) app.insertBefore(container, app.firstChild);
    }

    var elapsed = Math.round((Date.now() - raid.startedAt) / 60000);
    var cooldownRemaining = Math.max(0, Math.round((raid.cooldownEndsAt - Date.now()) / 60000));
    var participants = raid.participants || [];

    var userList = '';
    for (var i = 0; i < Math.min(participants.length, 10); i++) {
      var p = participants[i];
      userList += '<span class="raid-user">u/' + p.username + ' <span class="raid-score">' + p.score + '</span></span>';
    }
    if (participants.length > 10) {
      userList += '<span class="raid-more">+' + (participants.length - 10) + ' more</span>';
    }

    container.className = 'raid-banner active';
    container.innerHTML =
      '<div class="raid-header">' +
        '<span class="raid-icon">🚨</span>' +
        '<span class="raid-title">ACTIVE RAID DETECTED</span>' +
        '<span class="raid-meta">' + raid.participantCount + ' suspicious accounts · ' + elapsed + ' min ago · cooldown: ' + cooldownRemaining + ' min remaining</span>' +
      '</div>' +
      '<div class="raid-users">' + userList + '</div>' +
      '<div class="raid-actions">' +
        '<button class="raid-btn raid-btn-filter" id="btn-raid-filter">🔽 Filter All Raid Participants</button>' +
        '<button class="raid-btn raid-btn-dismiss" id="btn-raid-dismiss">✕ Dismiss Banner</button>' +
      '</div>';

    // Attach event listeners
    var filterBtn = getEl('btn-raid-filter');
    if (filterBtn) filterBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onFilterAllRaid(filterBtn);
    });

    var dismissBtn = getEl('btn-raid-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onDismissRaid();
    });
  }

  function hideRaidBanner() {
    var container = getEl('raid-banner');
    if (container) container.className = 'raid-banner';
  }

  function onFilterAllRaid(btn) {
    if (!confirm('This will filter ALL future content from every participant in this raid to modqueue. Continue?')) return;
    btn.textContent = 'Filtering...';
    btn.disabled = true;
    fetch('/api/raid-filter-all', { method: 'POST' })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.status === 'ok') {
          btn.textContent = '✓ All Filtered';
          showToast('Filtered ' + (data.filteredCount || 0) + ' raid participant(s). Their future content will go to modqueue.', 'success');
        } else {
          btn.textContent = 'Error'; btn.disabled = false;
          showToast('Failed: ' + data.message, 'error');
        }
      })
      .catch(function() {
        btn.textContent = 'Error'; btn.disabled = false;
        showToast('Failed to filter raid participants (Network error)', 'error');
      });
  }

  function onDismissRaid() {
    fetch('/api/raid-clear', { method: 'POST' })
      .then(function() { hideRaidBanner(); })
      .catch(function() { hideRaidBanner(); });
  }

  function renderUsers() {
    var grid = getEl('user-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (currentFilter === 'appeals') {
      if (!allAppeals.length) { showEl('empty-state'); return; }
      hideEl('empty-state');
      for (var i = 0; i < allAppeals.length; i++) {
        grid.appendChild(createAppealCard(allAppeals[i]));
      }
      return;
    }

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

  function createAppealCard(appeal) {
    var card = document.createElement('div');
    card.className = 'user-card risk-high'; // Red border for attention
    var countdown = appeal.expiresAt ? Math.max(0, Math.round((appeal.expiresAt - Date.now()) / 3600000)) + 'h remaining' : 'No timeout';
    
    card.innerHTML = 
      '<div class="card-header">' +
        '<div>' +
          '<h3 class="card-title">u/' + appeal.username + '</h3>' +
          '<div class="card-subtitle" style="color:#ffa502">Pending Appeal · ' + countdown + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="stat-row"><strong>Sent Reason:</strong> ' + (appeal.removalReason || '') + '</div>' +
        '<div class="card-actions" style="margin-top: 15px;">' +
          '<button class="btn action-safe btn-approve">✓ Approve</button>' +
          '<button class="btn action-remove btn-escalate">Escalate (Ban)</button>' +
          '<button class="btn action-filter btn-extend">Extend 24h</button>' +
        '</div>' +
      '</div>';

    var btnApprove = card.querySelector('.btn-approve');
    if (btnApprove) btnApprove.addEventListener('click', function() {
      btnApprove.disabled = true;
      fetch('/api/appeals/' + encodeURIComponent(appeal.username) + '/approve', { method: 'POST' })
        .then(function() { showToast('Appeal approved.', 'success'); refreshDashboard(); })
        .catch(function() { showToast('Error approving.', 'error'); btnApprove.disabled = false; });
    });

    var btnEscalate = card.querySelector('.btn-escalate');
    if (btnEscalate) btnEscalate.addEventListener('click', function() {
      if (!confirm('This will permanently ban u/' + appeal.username + '. Continue?')) return;
      btnEscalate.disabled = true;
      fetch('/api/appeals/' + encodeURIComponent(appeal.username) + '/escalate', { method: 'POST' })
        .then(function() { showToast('Escalated to ban.', 'success'); refreshDashboard(); })
        .catch(function() { showToast('Error escalating.', 'error'); btnEscalate.disabled = false; });
    });

    var btnExtend = card.querySelector('.btn-extend');
    if (btnExtend) btnExtend.addEventListener('click', function() {
      btnExtend.disabled = true;
      fetch('/api/appeals/' + encodeURIComponent(appeal.username) + '/extend', { method: 'POST' })
        .then(function() { showToast('Timer extended by 24h.', 'success'); refreshDashboard(); })
        .catch(function() { showToast('Error extending.', 'error'); btnExtend.disabled = false; });
    });

    return card;
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

    // ─── Tier 1: Filter → Modqueue ──────────────────────────────────────
    function onFilterUser(u, btn) {
      btn.textContent = 'Filtering...';
      btn.disabled = true;
      fetch('/api/filter/' + encodeURIComponent(u), { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') {
            btn.textContent = '🔽 Filtered';
            showToast('u/' + u + ' content will now be routed to modqueue for review.', 'success');
          } else {
            btn.textContent = 'Error'; btn.disabled = false;
            showToast('Failed to filter u/' + u + ': ' + data.message, 'error');
          }
        })
        .catch(function() {
          btn.textContent = 'Error'; btn.disabled = false;
          showToast('Failed to filter u/' + u + ' (Network error)', 'error');
        });
    }

    // ─── Tier 2: Remove + Appeal ────────────────────────────────────────
    function onRemoveAppeal(u, btn) {
      if (!confirm('TIER 2: This will remove all recent content from u/' + u + ' and send appeal instructions. Continue?')) return;
      btn.textContent = 'Removing...';
      btn.disabled = true;
      fetch('/api/remove-appeal/' + encodeURIComponent(u), { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') {
            btn.textContent = '⚠ Removed';
            showToast('Removed ' + (data.removedCount || 0) + ' item(s) from u/' + u + '. Appeal instructions sent via modmail.', 'success');
          } else {
            btn.textContent = 'Error'; btn.disabled = false;
            showToast('Failed: ' + data.message, 'error');
          }
        })
        .catch(function() {
          btn.textContent = 'Error'; btn.disabled = false;
          showToast('Failed to remove content for u/' + u + ' (Network error)', 'error');
        });
    }

    // ─── Tier 3: Ban + Report ───────────────────────────────────────────
    function onBanReport(u, btn) {
      if (!confirm('⚠ TIER 3 — PERMANENT ACTION ⚠\n\nThis will:\n• Permanently ban u/' + u + '\n• Report all their content as spam\n• Remove all their content\n\nThis cannot be undone from the dashboard.\nContinue?')) return;
      btn.textContent = 'Banning...';
      btn.disabled = true;
      fetch('/api/ban-report/' + encodeURIComponent(u), { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') {
            btn.textContent = '🚫 Banned';
            showToast('u/' + u + ' permanently banned. ' + (data.reportedCount || 0) + ' item(s) reported as spam.', 'success');
            setTimeout(refreshDashboard, 1000);
          } else {
            btn.textContent = 'Error'; btn.disabled = false;
            showToast('Failed: ' + data.message, 'error');
          }
        })
        .catch(function() {
          btn.textContent = 'Error'; btn.disabled = false;
          showToast('Failed to ban u/' + u + ' (Network error)', 'error');
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
      // 3-Tier Enforcement buttons
      html += '<button class="btn-action action-watch" data-user="' + uname + '">' + (user.isWatched ? '👁 Watched' : '👁 Watch') + '</button>' +
        '<button class="btn-action action-filter" data-user="' + uname + '">🔽 Filter</button>' +
        '<button class="btn-action action-remove-appeal" data-user="' + uname + '">⚠ Remove + Appeal</button>' +
        '<button class="btn-action action-ban-report" data-user="' + uname + '">🚫 Ban + Report</button>' +
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

    var filterBtn = card.querySelector('.action-filter');
    if (filterBtn) filterBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onFilterUser(uname, filterBtn);
    });

    var removeAppealBtn = card.querySelector('.action-remove-appeal');
    if (removeAppealBtn) removeAppealBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onRemoveAppeal(uname, removeAppealBtn);
    });

    var banReportBtn = card.querySelector('.action-ban-report');
    if (banReportBtn) banReportBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      onBanReport(uname, banReportBtn);
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

  // ─── View Switching ────────────────────────────────────────────────────────
  function switchView(view) {
    currentView = view;
    var views = ['dashboard', 'settings', 'audit', 'appeals'];
    for (var i = 0; i < views.length; i++) {
      var el = getEl('view-' + views[i]);
      if (el) el.style.display = views[i] === view ? '' : 'none';
    }
    // Update nav tab active state
    var tabs = document.querySelectorAll('.nav-tab');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.toggle('active', tabs[j].getAttribute('data-view') === view);
    }
    // Load data for the target view
    if (view === 'settings') loadSettings();
    if (view === 'audit') loadAuditLog();
    if (view === 'appeals') loadAppeals();
  }

  // ─── Settings Panel ────────────────────────────────────────────────────────

  function loadSettings() {
    fetch('/api/settings')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.settings) return;
        var s = data.settings;
        setSlider('set-low', 'val-low', s.lowRiskCutoff);
        setSlider('set-med', 'val-med', s.mediumRiskCutoff);
        setSlider('set-high', 'val-high', s.highRiskCutoff);
        setSelect('set-low-action', s.lowRiskAction);
        setSelect('set-med-action', s.mediumRiskAction);
        setSelect('set-high-action', s.highRiskAction);
        setTextarea('set-appeal-msg', s.appealMessage);
        setSelect('set-appeal-timeout', s.appealTimeout);
        setCheckbox('set-auto-escalate', s.autoEscalate);
        setCheckbox('set-new-acct', s.newAccountAmplifier);
        setSlider('set-acct-days', 'val-acct-days', s.newAccountThresholdDays);
        setSlider('set-acct-mult', 'val-acct-mult', Math.round(s.newAccountMultiplier * 100), function(v) { return (v / 100).toFixed(1); });
        setSlider('set-hour', 'val-hour', s.dailyAnalysisHour);
        setCheckbox('set-raid-alerts', s.raidAlertsEnabled);
        setCheckbox('set-shared-threat', s.sharedThreatLayer);
        // Update dynamic tier labels
        updateDynamicLabels(s);
      })
      .catch(function(e) { console.error('Failed to load settings:', e); });
  }

  function saveSettings() {
    var statusEl = getEl('save-status');
    if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.className = 'save-status'; }

    var settings = {
      lowRiskCutoff: getSliderVal('set-low'),
      mediumRiskCutoff: getSliderVal('set-med'),
      highRiskCutoff: getSliderVal('set-high'),
      lowRiskAction: getSelectVal('set-low-action'),
      mediumRiskAction: getSelectVal('set-med-action'),
      highRiskAction: getSelectVal('set-high-action'),
      appealMessage: getTextareaVal('set-appeal-msg'),
      appealTimeout: getSelectVal('set-appeal-timeout'),
      autoEscalate: getCheckboxVal('set-auto-escalate'),
      newAccountAmplifier: getCheckboxVal('set-new-acct'),
      newAccountThresholdDays: getSliderVal('set-acct-days'),
      newAccountMultiplier: getSliderVal('set-acct-mult') / 100,
      raidAlertsEnabled: getCheckboxVal('set-raid-alerts'),
      dailyAnalysisHour: getSliderVal('set-hour'),
      sharedThreatLayer: getCheckboxVal('set-shared-threat'),
    };

    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.status === 'ok') {
          if (statusEl) { statusEl.textContent = '✓ Saved'; statusEl.className = 'save-status saved'; }
          showToast('Settings saved successfully.', 'success');
          // Update sliders to reflect server-clamped values
          if (data.settings) {
            setSlider('set-low', 'val-low', data.settings.lowRiskCutoff);
            setSlider('set-med', 'val-med', data.settings.mediumRiskCutoff);
            setSlider('set-high', 'val-high', data.settings.highRiskCutoff);
            updateDynamicLabels(data.settings);
          }
        } else {
          if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.className = 'save-status error'; }
          showToast('Failed to save: ' + (data.message || 'Unknown error'), 'error');
        }
      })
      .catch(function() {
        if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.className = 'save-status error'; }
        showToast('Network error saving settings.', 'error');
      });
  }

  // Settings form helpers
  function setSlider(sliderId, labelId, value, formatter) {
    var el = getEl(sliderId);
    if (el) el.value = value;
    var lbl = getEl(labelId);
    if (lbl) lbl.textContent = formatter ? formatter(value) : value;
  }
  function setSelect(id, value) {
    var el = getEl(id);
    if (el) el.value = value || '';
  }
  function setTextarea(id, value) {
    var el = getEl(id);
    if (el) el.value = value || '';
  }
  function setCheckbox(id, value) {
    var el = getEl(id);
    if (el) el.checked = !!value;
  }
  function getSliderVal(id) {
    var el = getEl(id);
    return el ? parseInt(el.value, 10) : 0;
  }
  function getSelectVal(id) {
    var el = getEl(id);
    return el ? el.value : '';
  }
  function getTextareaVal(id) {
    var el = getEl(id);
    return el ? el.value : '';
  }
  function getCheckboxVal(id) {
    var el = getEl(id);
    return el ? el.checked : false;
  }
  function updateDynamicLabels(s) {
    var dynLow = document.querySelectorAll('.dynamic-low');
    var dynMed = document.querySelectorAll('.dynamic-med');
    var dynHigh = document.querySelectorAll('.dynamic-high');
    for (var i = 0; i < dynLow.length; i++) dynLow[i].textContent = s.lowRiskCutoff;
    for (var j = 0; j < dynMed.length; j++) dynMed[j].textContent = s.mediumRiskCutoff;
    for (var k = 0; k < dynHigh.length; k++) dynHigh[k].textContent = s.highRiskCutoff;
  }

  function bindSliderLive(sliderId, labelId, formatter) {
    var el = getEl(sliderId);
    if (!el) return;
    el.addEventListener('input', function() {
      var lbl = getEl(labelId);
      if (lbl) lbl.textContent = formatter ? formatter(el.value) : el.value;
    });
  }

  // ─── Audit Log Tab ─────────────────────────────────────────────────────────

  function loadAuditLog() {
    var container = getEl('audit-entries');
    if (!container) return;
    container.innerHTML = '<div class="audit-empty">Loading...</div>';

    fetch('/api/audit-log')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var entries = (data && data.entries) || [];
        if (entries.length === 0) {
          container.innerHTML = '<div class="audit-empty">No actions logged yet. Actions will appear here as BotPrints processes users.</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          var date = new Date(e.timestamp);
          var timeStr = date.toLocaleString();
          var actionClass = getAuditActionClass(e.action);
          html += '<div class="audit-entry">' +
            '<div class="audit-time">' + timeStr + '</div>' +
            '<div class="audit-body">' +
              '<span class="audit-action ' + actionClass + '">' + formatAction(e.action) + '</span>' +
              '<span class="audit-user">u/' + (e.username || 'unknown') + '</span>' +
              '<span class="audit-by">by ' + (e.performedBy || 'system') + '</span>' +
            '</div>' +
            '<div class="audit-detail">' + (e.details || '') + '</div>' +
          '</div>';
        }
        container.innerHTML = html;
      })
      .catch(function() {
        container.innerHTML = '<div class="audit-empty">Failed to load audit log.</div>';
      });
  }

  function getAuditActionClass(action) {
    var map = {
      'watch': 'audit-watch',
      'filter': 'audit-filter',
      'remove-appeal': 'audit-remove',
      'ban-report': 'audit-ban',
      'dismiss': 'audit-dismiss',
    };
    return map[action] || 'audit-default';
  }

  function formatAction(action) {
    var map = {
      'watch': '👁️ Watch',
      'filter': '🔽 Filter',
      'remove-appeal': '🗑️ Remove + Appeal',
      'ban-report': '🚫 Ban + Report',
      'dismiss': '✓ Dismissed',
    };
    return map[action] || action;
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

      // Filter tabs (dashboard sub-filters)
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

      // Primary nav tabs (Dashboard / Settings / Audit)
      var navTabs = document.querySelectorAll('.nav-tab');
      for (var n = 0; n < navTabs.length; n++) {
        (function(tab) {
          tab.addEventListener('click', function() {
            var view = tab.getAttribute('data-view') || 'dashboard';
            switchView(view);
          });
        })(navTabs[n]);
      }

      // Settings: live slider value display
      bindSliderLive('set-low', 'val-low');
      bindSliderLive('set-med', 'val-med');
      bindSliderLive('set-high', 'val-high');
      bindSliderLive('set-acct-days', 'val-acct-days');
      bindSliderLive('set-acct-mult', 'val-acct-mult', function(v) { return (v / 100).toFixed(1); });
      bindSliderLive('set-hour', 'val-hour');

      // Settings: save button
      var saveBtn = getEl('btn-save-settings');
      if (saveBtn) saveBtn.addEventListener('click', function() { saveSettings(); });

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
  // ─── Appeals Workflow Engine ───────────────────────────────────────────────

  function loadAppeals() {
    var container = getEl('appeals-entries');
    if (!container) return;
    
    container.innerHTML = '<div class="audit-empty">Loading pending appeals...</div>';
    
    fetch('/api/appeals/pending')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.appeals || data.appeals.length === 0) {
          container.innerHTML = '<div class="audit-empty">No pending appeals. Everything is quiet.</div>';
          updateAppealsBadge(0);
          return;
        }
        updateAppealsBadge(data.appeals.length);
        renderAppeals(data.appeals, container);
      })
      .catch(function(err) {
        container.innerHTML = '<div class="audit-empty" style="color:var(--accent-red)">Error loading appeals.</div>';
      });
  }

  function renderAppeals(appeals, container) {
    container.innerHTML = '';
    for (var i = 0; i < appeals.length; i++) {
      var a = appeals[i];
      var div = document.createElement('div');
      div.className = 'appeal-item';
      
      var now = Date.now();
      var isExpired = a.expiresAt && now > a.expiresAt;
      var timerText = 'No Timeout (Manual Review Only)';
      if (a.expiresAt) {
        var diffHours = Math.max(0, Math.floor((a.expiresAt - now) / (1000 * 60 * 60)));
        timerText = isExpired ? 'Timer Expired' : diffHours + ' hours remaining';
      }

      div.innerHTML = 
        '<div class="appeal-info">' +
          '<div class="appeal-user">u/' + escapeHTML(a.username) + '</div>' +
          '<div class="appeal-timer ' + (isExpired ? 'expired' : '') + '">' + timerText + '</div>' +
          '<div class="appeal-reason">' + escapeHTML(a.removalReason || '') + '</div>' +
        '</div>' +
        '<div class="appeal-actions">' +
          '<button class="btn btn-approve" data-user="' + escapeHTML(a.username) + '">Approve</button>' +
          '<button class="btn btn-extend" data-user="' + escapeHTML(a.username) + '">Extend Timer</button>' +
          '<button class="btn btn-escalate" data-user="' + escapeHTML(a.username) + '">Escalate (Ban)</button>' +
        '</div>';
        
      container.appendChild(div);
    }
    
    // Bind buttons
    var approveBtns = container.querySelectorAll('.btn-approve');
    var extendBtns = container.querySelectorAll('.btn-extend');
    var escalateBtns = container.querySelectorAll('.btn-escalate');
    
    for (var j = 0; j < approveBtns.length; j++) {
      approveBtns[j].addEventListener('click', function(e) {
        var user = e.target.getAttribute('data-user');
        e.target.disabled = true;
        e.target.textContent = 'Approving...';
        fetch('/api/appeals/' + user + '/approve', { method: 'POST' })
          .then(function() { loadAppeals(); fetchDashboard(); });
      });
    }
    for (var k = 0; k < extendBtns.length; k++) {
      extendBtns[k].addEventListener('click', function(e) {
        var user = e.target.getAttribute('data-user');
        e.target.disabled = true;
        e.target.textContent = 'Extending...';
        fetch('/api/appeals/' + user + '/extend', { method: 'POST' })
          .then(function() { loadAppeals(); });
      });
    }
    for (var l = 0; l < escalateBtns.length; l++) {
      escalateBtns[l].addEventListener('click', function(e) {
        if (!confirm('Escalate appeal for u/' + e.target.getAttribute('data-user') + '? This will ban the user.')) return;
        var user = e.target.getAttribute('data-user');
        e.target.disabled = true;
        e.target.textContent = 'Escalating...';
        fetch('/api/appeals/' + user + '/escalate', { method: 'POST' })
          .then(function() { loadAppeals(); fetchDashboard(); });
      });
    }
  }

  function updateAppealsBadge(count) {
    var badge = getEl('appeals-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  }

  // Poll for pending appeals count initially
  fetch('/api/appeals/pending')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.appeals) updateAppealsBadge(data.appeals.length);
    }).catch(function(){});

})();
