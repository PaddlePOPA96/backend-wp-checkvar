(() => {
  const state = { matches: [], editingId: null };
  const els = {};

  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    bindEvents();
    loadMatches();
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
  }

  async function loadMatches() {
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

  function renderTable() {
    if (!els.tableBody) return;
    if (!state.matches.length) {
      renderEmpty('Belum ada data');
      return;
    }
    els.tableBody.innerHTML = '';
    state.matches.forEach((m) => {
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
    if (els.formTitle) els.formTitle.textContent = 'Edit Match';
    if (els.submitBtn) els.submitBtn.textContent = 'Update';
    if (els.cancelEdit) els.cancelEdit.classList.remove('hidden');
    fillFormFromMatch(match);
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
    const ok = window.confirm(`Hapus match ${match.home_team?.name} vs ${match.away_team?.name}?`);
    if (!ok) return;
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
})();
