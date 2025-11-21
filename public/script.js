// public/script.js yang Diperbarui
document.addEventListener('DOMContentLoaded', () => {
  fetchMatchData();

  const aiSubmit = document.getElementById('aiSubmit');
  if (aiSubmit) {
    aiSubmit.addEventListener('click', (e) => {
      e.preventDefault();
      sendToAgent();
    });
  }
});

async function fetchMatchData() {
  try {
    const league = 'Premier League';
    let response = await fetch(
      '/api/matches?league=' + encodeURIComponent(league)
    );
    let data = await parseJSONSafe(response);

    // Jika filter league kosong atau tidak ada hasil, fallback ambil semua data
    if (
      (!Array.isArray(data.today_matches) || data.today_matches.length === 0) &&
      (!Array.isArray(data.last_matches) || data.last_matches.length === 0) &&
      (!Array.isArray(data.next_matches) || data.next_matches.length === 0)
    ) {
      response = await fetch('/api/matches');
      data = await parseJSONSafe(response);
    }

    displayMatches(data.today_matches, 'today-matches', 'today');
    displayMatches(data.last_matches, 'last-matches', 'last');
    displayMatches(data.next_matches, 'next-matches', 'next');
  } catch (err) {
    console.error(err);
    ['today-matches', 'last-matches', 'next-matches'].forEach((id) => {
      const ref = document.getElementById(id);
      if (ref) ref.textContent = 'Gagal memuat data pertandingan';
    });
  }
}

async function parseJSONSafe(res) {
  const text = await res.text();
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    return JSON.parse(text);
  }
  throw new Error('Response bukan JSON, kemungkinan diblokir aksesnya.');
}

// Fungsi displayMatches sekarang menerima tipe (today/last/next)
function displayMatches(matches, containerId, type) {
  const resultsContainer = document.getElementById(containerId);
  if (!resultsContainer) return;

  resultsContainer.innerHTML = '';
  if (!Array.isArray(matches) || matches.length === 0) {
    resultsContainer.innerHTML =
      '<div class="empty-state">Belum ada data untuk ditampilkan.</div>';
    return;
  }

  matches.forEach((match) => {
    const card = document.createElement('div');
    card.className = `match-card ${type}`;

    // Meta info
    const meta = document.createElement('div');
    meta.className = 'match-meta';
    const comp = document.createElement('span');
    comp.className = 'badge badge-comp';
    comp.textContent = match.competition || 'Unknown';
    const date = document.createElement('span');
    date.className = 'badge badge-date';
    if (type === 'today') {
      date.textContent = 'TODAY';
      date.classList.add('badge-today');
    } else {
      date.textContent = formatDate(match.date);
    }
    meta.appendChild(comp);
    meta.appendChild(date);

    // Middle row: logos + center status
    const matchupRow = document.createElement('div');
    matchupRow.className = 'matchup-row';

    const homeTeamDiv = createTeamBlock(match.home_team, 'home');
    const awayTeamDiv = createTeamBlock(match.away_team, 'away');

    const scoreBoxDiv = document.createElement('div');
    scoreBoxDiv.className = 'scoreboard';

    if (type === 'last') {
      scoreBoxDiv.innerHTML = `
        <div class="score-main">
          <span>${match.home_team.score ?? '-'}</span>
          <span class="separator">-</span>
          <span>${match.away_team.score ?? '-'}</span>
        </div>
        <div class="score-sub">Full Time</div>
      `;
    } else if (type === 'today') {
      scoreBoxDiv.innerHTML = `
        <div class="score-main score-today">
          <span>${match.home_team.score ?? '-'}</span>
          <span class="separator">-</span>
          <span>${match.away_team.score ?? '-'}</span>
        </div>`;
    } else {
      scoreBoxDiv.innerHTML = `
        <div class="score-main upcoming">VS</div>
        <div class="score-sub">Belum mulai</div>
      `;
    }

    matchupRow.appendChild(homeTeamDiv);
    matchupRow.appendChild(scoreBoxDiv);
    matchupRow.appendChild(awayTeamDiv);

    card.appendChild(meta);
    card.appendChild(matchupRow);

    resultsContainer.appendChild(card);
  });
}

function createTeamBlock(team = {}, type) {
  const div = document.createElement('div');
  div.className = `team-block ${type}`;

  const logoFrame = document.createElement('div');
  logoFrame.className = 'logo-frame';
  const logo = document.createElement('img');
  logo.src = team.logo_url || '';
  logo.alt = team.name || '';
  logo.onerror = () => {
    logo.style.display = 'none';
  };
  logoFrame.appendChild(logo);

  const nameSpan = document.createElement('div');
  nameSpan.className = 'team-name';
  nameSpan.textContent = team.name || '-';

  div.appendChild(logoFrame);
  div.appendChild(nameSpan);

  return div;
}

function formatDate(dateString) {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '-';
  const options = { day: '2-digit', month: 'short', year: 'numeric' };
  return d.toLocaleDateString('id-ID', options);
}

async function sendToAgent() {
  const promptBox = document.getElementById('aiPrompt');
  const statusBox = document.getElementById('aiStatus');
  if (!promptBox || !statusBox) return;

  const prompt = promptBox.value.trim();
  if (!prompt) {
    statusBox.textContent = 'Tuliskan perintah terlebih dahulu.';
    return;
  }

  statusBox.textContent = 'Memproses perintah...';
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

    // Ini adalah bagian yang diubah/dikonfirmasi:
    await res.json();
    await fetchMatchData(); // <-- **Tambahkan 'await' di sini**
    statusBox.textContent = 'Berhasil disimpan oleh AI ✅. Tampilan diperbarui.';
    promptBox.value = '';
    
  } catch (err) {
    console.error(err);
    statusBox.textContent = err.message;
  }
}
