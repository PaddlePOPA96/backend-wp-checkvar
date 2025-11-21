(() => {
  const state = { matches: [], editingId: null, authed: false, auth: null, user: null };
  const els = {};

  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    bindEvents();
    initAuth();
  });

  function cacheEls() {
    els.tableBody = document.getElementById('tableBody');
    els.statusBox = document.getElementById('statusBox');
    els.form = document.getElementById('matchForm');
    els.formStatus = document.getElementById('formStatus');
    els.formTitle = document.getElementById('formTitle');
    els.submitBtn = document.getElementById('submitBtn');
    els.cancelEdit = document.getElementById('cancelEdit');
    els.filterLeague = document.getElementById('filterLeague');
    els.lastUpdated = document.getElementById('lastUpdated');
    els.refreshBtn = document.getElementById('refreshBtn');
    els.resetFormBtn = document.getElementById('resetFormBtn');
    // Modal
    els.editModal = document.getElementById('editModal');
    els.editForm = document.getElementById('editForm');
    els.editFormStatus = document.getElementById('editFormStatus');
    els.closeEditModal = document.getElementById('closeEditModal');
    els.cancelEditModal = document.getElementById('cancelEditModal');
    // Confirm modal
    els.confirmModal = document.getElementById('confirmModal');
    els.confirmMessage = document.getElementById('confirmMessage');
    els.confirmOk = document.getElementById('confirmOk');
    els.confirmCancel = document.getElementById('confirmCancel');
    // Auth
    els.authOverlay = document.getElementById('authOverlay');
    els.authEmail = document.getElementById('authEmail');
    els.authPassword = document.getElementById('authPassword');
    els.authSubmit = document.getElementById('authSubmit');
    els.authError = document.getElementById('authError');
    els.logoutBtn = document.getElementById('logoutBtn');
    // AI
    els.aiSubmit = document.getElementById('aiSubmit');
    els.aiPrompt = document.getElementById('aiPrompt');
    els.aiStatus = document.getElementById('aiStatus');
  }

  function bindEvents() {
    if (els.refreshBtn) els.refreshBtn.addEventListener('click', loadMatches);
    if (els.filterLeague) {
      const debounced = debounce(loadMatches, 250);
      els.filterLeague.addEventListener('input', debounced);
    }
    if (els.form) {
      els.form.addEventListener('submit', onSubmit);
    }
    if (els.cancelEdit) {
      els.cancelEdit.addEventListener('click', cancelEdit);
    }
    if (els.resetFormBtn) {
      els.resetFormBtn.addEventListener('click', () => {
        els.form.reset();
      });
    }
    if (els.editForm) {
      els.editForm.addEventListener('submit', onSubmitEdit);
    }
    if (els.closeEditModal) els.closeEditModal.addEventListener('click', hideEditModal);
    if (els.cancelEditModal) els.cancelEditModal.addEventListener('click', hideEditModal);
    if (els.authSubmit) els.authSubmit.addEventListener('click', login);
    if (els.logoutBtn) els.logoutBtn.addEventListener('click', logout);
    if (els.aiSubmit) {
      els.aiSubmit.addEventListener('click', (e) => {
        e.preventDefault();
        sendToAgent();
      });
    }
  }

  async function loadMatches() {
    if (!state.authed) {
      setStatus('Login terlebih dahulu', true);
      return;
    }
    setStatus('Memuat data...', false);
    try {
      const params = new URLSearchParams({ all: '1' });
      const league = (els.filterLeague?.value || '').trim();
      if (league) params.set('league', league);
      const res = await fetch('/api/matches?' + params.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error('Gagal memuat data: ' + res.status);
      const data = await res.json();
      state.matches = Array.isArray(data.matches) ? data.matches : [];
      renderTable();
      setStatus(`Memuat ${state.matches.length} data`, false);
      if (els.lastUpdated) {
        els.lastUpdated.textContent = 'last_updated: ' + (data.last_updated || '-');
      }
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Gagal memuat data', true);
      renderEmpty('Gagal memuat data');
    }
  }

  function initAuth() {
    if (typeof firebase === 'undefined') {
      showAuthError('Firebase SDK belum termuat.');
      return;
    }
    if (window.firebaseConfig && firebase?.apps?.length === 0) {
      try {
        firebase.initializeApp(window.firebaseConfig);
      } catch (err) {
        console.error(err);
        showAuthError('Konfigurasi Firebase tidak valid.');
        return;
      }
    } else if (!window.firebaseConfig) {
      showAuthError('Firebase config belum diisi di firebase-config.js');
      return;
    }
    state.auth = firebase.auth();
    state.auth.onAuthStateChanged((user) => {
      state.user = user;
      state.authed = !!user;
      toggleAuthOverlay(!user);
      if (user) {
        setStatus('Login sebagai ' + (user.email || 'user'), false);
        loadMatches();
      } else {
        setStatus('Login untuk melihat data', true);
      }
    });
  }

  async function login() {
    if (!state.auth) {
      showAuthError('Auth belum siap; periksa konfigurasi.');
      return;
    }
    const email = (els.authEmail?.value || '').trim();
    const pass = els.authPassword?.value || '';
    if (!email || !pass) {
      showAuthError('Email dan password wajib diisi.');
      return;
    }
    try {
      showAuthError('');
      await state.auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
      console.error(err);
      showAuthError(err.message || 'Login gagal');
    }
  }

  async function logout() {
    if (!state.auth) return;
    try {
      await state.auth.signOut();
    } catch (err) {
      console.error(err);
    }
  }

  function toggleAuthOverlay(show) {
    if (!els.authOverlay) return;
    if (show) {
      els.authOverlay.classList.remove('hidden');
    } else {
      els.authOverlay.classList.add('hidden');
    }
  }

  function showAuthError(msg) {
    if (els.authError) els.authError.textContent = msg || '';
  }

  function renderTable() {
    if (!els.tableBody) return;
    if (!state.matches.length) {
      renderEmpty('Belum ada data');
      return;
    }
    const sorted = sortByPriority(state.matches);
    els.tableBody.innerHTML = '';
    sorted.forEach((m) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(m.date || '-')}</td>
        <td><span class="pill">${escapeHtml(m.competition || '-')}</span></td>
        <td>${escapeHtml(m.home_team?.name || '-')}</td>
        <td>${escapeHtml(m.away_team?.name || '-')}</td>
        <td class="score">${formatScore(m)}</td>
        <td>
          <div class="actions">
            <button class="btn" data-action="edit">Edit</button>
            <button class="btn danger" data-action="delete">Hapus</button>
          </div>
        </td>
      `;
      tr.querySelector('[data-action="edit"]').addEventListener('click', () => startEdit(m));
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMatch(m));
      els.tableBody.appendChild(tr);
    });
  }

  function renderEmpty(text) {
    if (!els.tableBody) return;
    els.tableBody.innerHTML = `<tr><td colspan="6">${escapeHtml(text)}</td></tr>`;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const formData = new FormData(els.form);
    const payload = {
      date: formData.get('date'),
      competition: formData.get('competition'),
      home_team_name: formData.get('home_team_name'),
      away_team_name: formData.get('away_team_name'),
    };
    const hs = formData.get('home_score');
    const as = formData.get('away_score');
    if (hs !== '') payload.home_score = toNumberOrNull(hs);
    if (as !== '') payload.away_score = toNumberOrNull(as);

    try {
      setFormStatus('Menyimpan...', false);
      let url = '/api/matches';
      let method = 'POST';
      if (state.editingId) {
        url += '/' + encodeURIComponent(state.editingId);
        method = 'PUT';
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Gagal simpan (${res.status})`);
      }
      setFormStatus('Berhasil disimpan', false);
      cancelEdit();
      els.form.reset();
      await loadMatches();
    } catch (err) {
      console.error(err);
      setFormStatus(err.message || 'Gagal menyimpan', true);
    }
  }

  function startEdit(match) {
    state.editingId = match.id;
    confirmAction('Edit data ini?', () => {
      fillEditForm(match);
      showEditModal();
    });
  }

  function cancelEdit() {
    state.editingId = null;
    if (els.formTitle) els.formTitle.textContent = 'Tambah Match';
    if (els.submitBtn) els.submitBtn.textContent = 'Simpan';
    if (els.cancelEdit) els.cancelEdit.classList.add('hidden');
    if (els.form) els.form.reset();
  }

  function fillFormFromMatch(m) {
    if (!els.form) return;
    els.form.elements.date.value = m.date || '';
    els.form.elements.competition.value = m.competition || '';
    els.form.elements.home_team_name.value = m.home_team?.name || '';
    els.form.elements.away_team_name.value = m.away_team?.name || '';
    els.form.elements.home_score.value =
      m.home_team && m.home_team.score != null ? m.home_team.score : '';
    els.form.elements.away_score.value =
      m.away_team && m.away_team.score != null ? m.away_team.score : '';
  }

  async function deleteMatch(match) {
    confirmAction(
      `Hapus match ${match.home_team?.name || ''} vs ${match.away_team?.name || ''}?`,
      async () => {
        try {
          setStatus('Menghapus...', false);
          const res = await fetch('/api/matches/' + encodeURIComponent(match.id), {
            method: 'DELETE',
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `Gagal hapus (${res.status})`);
          }
          setStatus('Berhasil dihapus', false);
          if (state.editingId === match.id) cancelEdit();
          await loadMatches();
        } catch (err) {
          console.error(err);
          setStatus(err.message || 'Gagal menghapus', true);
        }
      }
    );
  }

  function formatScore(m) {
    const hs = m.home_team?.score;
    const as = m.away_team?.score;
    if (hs == null || as == null) return '-';
    return `${hs} - ${as}`;
  }

  function toNumberOrNull(v) {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  function setStatus(text, isError) {
    if (!els.statusBox) return;
    els.statusBox.textContent = text || '';
    els.statusBox.className = 'status' + (isError ? ' error' : '');
  }

  function setFormStatus(text, isError) {
    if (!els.formStatus) return;
    els.formStatus.textContent = text || '';
    els.formStatus.className = 'status' + (isError ? ' error' : '');
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Sorting priority: today first, future next (nearest first), past after (recent first)
  function sortByPriority(list) {
    const todayUTC = getTodayUTC();
    return [...list].sort((a, b) => {
      const da = parseDateUTC(a.date);
      const db = parseDateUTC(b.date);
      const wa = weight(da, todayUTC);
      const wb = weight(db, todayUTC);
      if (wa !== wb) return wa - wb;
      return (da || 0) - (db || 0);
    });
  }

  function weight(d, todayUTC) {
    if (!d) return 1e15;
    const t = d.getTime();
    const today = todayUTC.getTime();
    if (t === today) return 0;
    if (t > today) return t - today + 1; // future; nearer is smaller
    return 1e12 + (today - t); // past; pushed down
  }

  function getTodayUTC() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  function parseDateUTC(dateStr) {
    if (!dateStr) return null;
    const parts = String(dateStr).split('T')[0].split('-').map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    const [y, m, d] = parts;
    return new Date(Date.UTC(y, m - 1, d));
  }

  // Modal helpers
  function showEditModal() {
    if (!els.editModal) return;
    document.body.classList.add('modal-open');
    els.editModal.classList.remove('hidden');
    setFormStatus('', false);
  }

  function hideEditModal() {
    if (!els.editModal) return;
    document.body.classList.remove('modal-open');
    els.editModal.classList.add('hidden');
    state.editingId = null;
  }

  function fillEditForm(m) {
    if (!els.editForm) return;
    els.editForm.elements.date.value = m.date || '';
    els.editForm.elements.competition.value = m.competition || '';
    els.editForm.elements.home_team_name.value = m.home_team?.name || '';
    els.editForm.elements.away_team_name.value = m.away_team?.name || '';
    els.editForm.elements.home_score.value =
      m.home_team && m.home_team.score != null ? m.home_team.score : '';
    els.editForm.elements.away_score.value =
      m.away_team && m.away_team.score != null ? m.away_team.score : '';
  }

  async function onSubmitEdit(e) {
    e.preventDefault();
    if (!state.editingId) {
      hideEditModal();
      return;
    }
    const fd = new FormData(els.editForm);
    const payload = {
      date: fd.get('date'),
      competition: fd.get('competition'),
      home_team_name: fd.get('home_team_name'),
      away_team_name: fd.get('away_team_name'),
    };
    const hs = fd.get('home_score');
    const as = fd.get('away_score');
    if (hs !== '') payload.home_score = toNumberOrNull(hs);
    if (as !== '') payload.away_score = toNumberOrNull(as);

    try {
      setEditFormStatus('Menyimpan...', false);
      const res = await fetch('/api/matches/' + encodeURIComponent(state.editingId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Gagal update (${res.status})`);
      }
      setEditFormStatus('Berhasil diperbarui', false);
      hideEditModal();
      await loadMatches();
    } catch (err) {
      console.error(err);
      setEditFormStatus(err.message || 'Gagal update', true);
    }
  }

  function setEditFormStatus(text, isError) {
    if (!els.editFormStatus) return;
    els.editFormStatus.textContent = text || '';
    els.editFormStatus.className = 'status' + (isError ? ' error' : '');
  }

  function confirmAction(message, onOk) {
    if (!els.confirmModal) {
      if (window.confirm(message)) onOk();
      return;
    }
    els.confirmMessage.textContent = message;
    document.body.classList.add('modal-open');
    els.confirmModal.classList.remove('hidden');

    const cleanup = () => {
      document.body.classList.remove('modal-open');
      els.confirmModal.classList.add('hidden');
      els.confirmOk.onclick = null;
      els.confirmCancel.onclick = null;
    };
    els.confirmOk.onclick = () => {
      cleanup();
      onOk();
    };
    els.confirmCancel.onclick = cleanup;
  }

  // AI agent
  async function sendToAgent() {
    if (!els.aiPrompt || !els.aiStatus) return;
    const prompt = els.aiPrompt.value.trim();
    if (!prompt) {
      els.aiStatus.textContent = 'Tuliskan perintah terlebih dahulu.';
      return;
    }
    els.aiStatus.textContent = 'Memproses perintah...';
    try {
      const res = await fetch('/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail = errBody.detail ? ` (${errBody.detail})` : '';
        throw new Error((errBody.error || 'Gagal memproses permintaan AI') + detail);
      }
      await res.json();
      els.aiStatus.textContent = 'Berhasil disimpan oleh AI ✅. Tampilan diperbarui.';
      els.aiPrompt.value = '';
      await loadMatches();
    } catch (err) {
      console.error(err);
      els.aiStatus.textContent = err.message;
    }
  }
})();
