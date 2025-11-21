// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initFirestoreFromEnv } = require('./firebase');

const app = express();
const port = process.env.PORT || 3000;

const MATCHES_FILE = path.join(__dirname, 'matches.json');
const LOGO_ROOT = path.join(__dirname, 'logo');
// Vercel serverless filesystem is read-only; skip local writes there.
const IS_READ_ONLY_FS = !!process.env.VERCEL;

const norm = (s = '') => s.toLowerCase().replace(/\s+/g, '');
const sanitize = (s = '') => s.toLowerCase().replace(/[^a-z0-9]/g, '');
let lastLoadedMtimeMs = 0;
const generateId =
  crypto.randomUUID ||
  (() => 'm-' + Date.now() + '-' + Math.random().toString(16).slice(2));
let firestore = null;
let useFirestore = false;
const FIRESTORE_DOC_PATH = 'matches/data';

function initFirestore() {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!projectId || !clientEmail || !privateKey) return;
    privateKey = privateKey.replace(/\\n/g, '\n');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    }
    firestore = admin.firestore();
    useFirestore = true;
    console.log('Firestore diinisialisasi.');
  } catch (err) {
    useFirestore = false;
    console.warn('Firestore tidak aktif:', err.message);
  }
}

const TEAM_ALIASES = {
  arsenal: 'Arsenal FC',
  arsenalfc: 'Arsenal FC',
  chelsea: 'Chelsea FC',
  chelseafc: 'Chelsea FC',
  liverpool: 'Liverpool FC',
  liverpoolfc: 'Liverpool FC',
  mancity: 'Manchester City',
  manchestercity: 'Manchester City',
  manc: 'Manchester City',
  manutd: 'Manchester United',
  manunited: 'Manchester United',
  manchesterunited: 'Manchester United',
  spurs: 'Tottenham Hotspur',
  tottenham: 'Tottenham Hotspur',
  tottenhamhotspur: 'Tottenham Hotspur',
  brighton: 'Brighton & Hove Albion',
  brightonhovealbion: 'Brighton & Hove Albion',
  nottinghamforest: 'Nottingham Forest',
  nottsforest: 'Nottingham Forest',
  nforest: 'Nottingham Forest',
  westham: 'West Ham United',
  westhamunited: 'West Ham United',
  wolves: 'Wolverhampton Wanderers',
  wolverhampton: 'Wolverhampton Wanderers',
};

function aliasTeamName(teamName = '') {
  const key = sanitize(teamName);
  return TEAM_ALIASES[key] || teamName;
}

function canonicalizeCompetition(comp) {
  if (!comp || typeof comp !== 'string' || !comp.trim()) {
    return 'Premier League';
  }
  const s = sanitize(comp);
  if (s.includes('premierleague') || s === 'epl') {
    return 'Premier League';
  }
  if (s.includes('unknown') || s.includes('namaliga')) {
    return 'Premier League';
  }
  return comp;
}

// ======================================
// 1. LOAD DATA MATCH
// ======================================
let matchData = { last_updated: null, matches: [] };

function ensureMatchStructure(data) {
  if (!data || typeof data !== 'object') {
    return { last_updated: null, matches: [] };
  }
  return {
    last_updated: data.last_updated || null,
    matches: Array.isArray(data.matches) ? data.matches : [],
  };
}

function loadMatchesFromFile() {
  try {
    const stat = fs.statSync(MATCHES_FILE);
    lastLoadedMtimeMs = stat.mtimeMs;
    const raw = fs.readFileSync(MATCHES_FILE, 'utf8');
    matchData = ensureMatchStructure(JSON.parse(raw));
    matchData.matches = (matchData.matches || []).map(ensureMatchConsistency);
    console.log('matches.json berhasil dimuat (file).');
  } catch (err) {
    console.error('Gagal load matches.json, pakai default kosong:', err.message);
    matchData = { last_updated: null, matches: [] };
  }
}

function loadMatches() {
  if (useFirestore && firestore) {
    console.log('Memuat data dari Firestore...');
    return firestore
      .doc(FIRESTORE_DOC_PATH)
      .get()
      .then((snapshot) => {
        if (snapshot.exists) {
          matchData = ensureMatchStructure(snapshot.data());
          matchData.matches = (matchData.matches || []).map(ensureMatchConsistency);
          console.log('matches.json berhasil dimuat (Firestore).');
          return;
        }
        console.log('Dokumen Firestore belum ada, fallback ke file lokal.');
        loadMatchesFromFile();
      })
      .catch((err) => {
        console.warn('Gagal load Firestore, fallback ke file:', err.message);
        loadMatchesFromFile();
      });
  }
  loadMatchesFromFile();
  return Promise.resolve();
}

function saveMatches(cb) {
  matchData.last_updated = new Date().toISOString();
  const finish = (err) => {
    if (err) console.error('Gagal menyimpan data:', err.message);
    if (cb) cb(err || null);
  };

  const writeFile = () => {
    if (IS_READ_ONLY_FS) {
      // Di Vercel tidak bisa menulis ke disk; cukup log dan selesai.
      console.log('Skip menulis matches.json (read-only filesystem).');
      return finish(null);
    }
    fs.writeFile(MATCHES_FILE, JSON.stringify(matchData, null, 2), 'utf8', (err) => {
      if (err) return finish(err);
      try {
        const stat = fs.statSync(MATCHES_FILE);
        lastLoadedMtimeMs = stat.mtimeMs;
      } catch (_) {}
      console.log('matches.json tersimpan.');
      return finish(null);
    });
  };

  if (useFirestore && firestore) {
    firestore
      .doc(FIRESTORE_DOC_PATH)
      .set(matchData, { merge: true })
      .then(() => {
        console.log('Data tersimpan ke Firestore.');
        writeFile();
      })
      .catch((err) => {
        console.error('Gagal simpan ke Firestore:', err.message);
        writeFile();
      });
  } else {
    writeFile();
  }
}

const saveMatchesAsync = () =>
  new Promise((resolve, reject) => {
    saveMatches((err) => {
      if (err) return reject(err);
      resolve();
    });
  });

// ======================================
// 2. MIDDLEWARE
// ======================================
app.use(express.urlencoded({ extended: true })); // buat form HTML
app.use(express.json()); // kalau mau POST JSON

// Serve file statis untuk frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Serve logo
app.use('/logo', express.static(path.join(__dirname, 'logo')));

// Proteksi akses /api/*: blok navigasi langsung, izinkan fetch same-origin, atau pakai secret
const API_SECRET = process.env['SECRET-MY'] || process.env.SECRET_MY || '';
const KOSONG_PATH = path.join(__dirname, 'public', 'kosong.html');
app.use('/api', (req, res, next) => {
  const provided =
    req.headers['x-secret'] ||
    req.headers['x-api-secret'] ||
    req.query.secret ||
    '';
  const mode = (req.headers['sec-fetch-mode'] || '').toLowerCase();
  const site = (req.headers['sec-fetch-site'] || '').toLowerCase();
  const accept = (req.headers.accept || '').toLowerCase();
  const isNavigation = mode === 'navigate' || accept.includes('text/html');
  const isSameSiteFetch = mode === 'cors' && (site === 'same-origin' || site === 'same-site');

  if (String(provided) === String(API_SECRET)) return next();
  if (isNavigation) return res.sendFile(KOSONG_PATH); // blok buka langsung di browser
  if (!API_SECRET) return next(); // kalau belum diset, biarkan lewat
  if (isSameSiteFetch) return next(); // izinkan fetch dari halaman sendiri
  return res.sendFile(KOSONG_PATH); // lainnya diblok
});

// ======================================
// 3. LOGIC TANGGAL (PAST vs NEXT)
// ======================================
// Hitung jarak Levenshtein sederhana untuk pencocokan fuzzy
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

// Cari logo berdasarkan nama klub dan liga, dengan fallback fuzzy
function findLogoPath(teamName, competition) {
  try {
    const resolvedName = aliasTeamName(teamName);
    const leagues = fs
      .readdirSync(LOGO_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const candidates = competition
      ? leagues.filter((l) => norm(l).includes(norm(competition)))
      : leagues;

    const target = sanitize(resolvedName);
    let bestMatch = { path: '', dist: Number.MAX_SAFE_INTEGER };

    const leagueList = candidates.length ? candidates : leagues;
    for (const league of leagueList) {
      const files = fs.readdirSync(path.join(LOGO_ROOT, league));
      for (const f of files) {
        const nameNoExt = f.replace(/\.png$/i, '');
        const sani = sanitize(nameNoExt);
        if (sani === target) {
          return path.join('logo', league, f).replace(/\\/g, '/');
        }
        const dist = levenshtein(sani, target);
        if (dist < bestMatch.dist) {
          bestMatch = { path: path.join('logo', league, f).replace(/\\/g, '/'), dist };
        }
      }
    }
    // Terima hasil fuzzy jika cukup dekat (typo kecil)
    if (bestMatch.path && bestMatch.dist <= 3) {
      return bestMatch.path;
    }
    return '';
  } catch (e) {
    console.error('Gagal mencari logo:', e.message);
    return '';
  }
}

function ensureMatchLogos(match = {}) {
  const result = { ...match };
  result.competition = canonicalizeCompetition(result.competition);
  if (result.home_team && !result.home_team.logo_url) {
    const nameForLogo = aliasTeamName(result.home_team.name);
    result.home_team = {
      ...result.home_team,
      logo_url: findLogoPath(nameForLogo, result.competition) || '',
    };
  }
  if (result.away_team && !result.away_team.logo_url) {
    const nameForLogo = aliasTeamName(result.away_team.name);
    result.away_team = {
      ...result.away_team,
      logo_url: findLogoPath(nameForLogo, result.competition) || '',
    };
  }
  return result;
}

function ensureMatchConsistency(match = {}) {
  const normalized = {
    id: match.id || generateId(),
    ...match,
    competition: canonicalizeCompetition(match.competition),
  };
  return ensureMatchLogos(normalized);
}

function normalizeAllMatches() {
  let changed = false;
  matchData.matches = (matchData.matches || []).map((m) => {
    const normed = ensureMatchConsistency(m);
    if (JSON.stringify(normed) !== JSON.stringify(m)) changed = true;
    return normed;
  });
  if (changed) {
    saveMatches((err) => {
      if (err) console.error('Gagal auto-normalize matches:', err.message);
      else console.log('Auto-normalize matches.json selesai.');
    });
  }
}

function refreshMatchesIfChanged() {
  if (useFirestore) return; // Firestore sebagai sumber utama, abaikan mtime file
  try {
    const stat = fs.statSync(MATCHES_FILE);
    if (stat.mtimeMs > lastLoadedMtimeMs) {
      console.log('Terdeteksi perubahan matches.json di disk, reload...');
      loadMatches();
    }
  } catch (err) {
    console.error('Gagal cek perubahan matches.json:', err.message);
  }
}

function createTeam(name, score, competition, providedLogo) {
  const parsedScore =
    score === '' || score === undefined || score === null
      ? null
      : Number(score);
  const finalScore = Number.isNaN(parsedScore) ? null : parsedScore;
  const nameForLogo = aliasTeamName(name);
  const team = {
    name,
    logo_url: providedLogo || findLogoPath(nameForLogo, competition) || '',
  };
  team.score = finalScore;
  return team;
}

function addMatchFromObject(obj) {
  if (!obj) throw new Error('Payload kosong');
  const {
    id,
    date,
    competition,
    home_team_name,
    away_team_name,
    home_score,
    away_score,
    home_team_logo_url,
    away_team_logo_url,
  } = obj;

  if (!date || !competition || !home_team_name || !away_team_name) {
    throw new Error('Field wajib: date, competition, home_team_name, away_team_name');
  }

  const competitionCanonical = canonicalizeCompetition(competition);
  const match = {
    id: id || generateId(),
    date, // "YYYY-MM-DD"
    competition: competitionCanonical,
    home_team: createTeam(home_team_name, home_score, competitionCanonical, home_team_logo_url),
    away_team: createTeam(away_team_name, away_score, competitionCanonical, away_team_logo_url),
  };

  matchData.matches.push(match);
  matchData.matches.sort((a, b) => new Date(a.date) - new Date(b.date));

  return match;
}

function filterMatchesByLeague(matches, leagueParam) {
  if (!leagueParam) return matches;
  const target = sanitize(canonicalizeCompetition(leagueParam));
  return matches.filter((m) => {
    const comp = sanitize(canonicalizeCompetition(m.competition));
    return comp.includes(target) || target.includes(comp);
  });
}

function findMatchIndex(id) {
  return (matchData.matches || []).findIndex((m) => m.id === id);
}

// ======================================
// 4. ENDPOINT API DENGAN FILTER LIGA + WINDOW 14 HARI
//    GET /api/matches
// ======================================
app.get('/api/matches', (req, res) => {
  refreshMatchesIfChanged();
  normalizeAllMatches();
  const league = req.query.league;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pastWindow = new Date(today);
  pastWindow.setDate(pastWindow.getDate() - 7);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWindow = new Date(today);
  nextWindow.setDate(nextWindow.getDate() + 7);

  const normalizeDate = (dateStr) => {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const matches = filterMatchesByLeague(matchData.matches || [], league).filter(
    (m) => normalizeDate(m.date)
  );

  const today_matches = [];
  const last_matches = [];
  const next_matches = [];

  matches.forEach((m) => {
    const d = normalizeDate(m.date);
    if (!d) return;
    if (d.getTime() === today.getTime()) {
      today_matches.push(m);
    } else if (d >= pastWindow && d <= yesterday) {
      last_matches.push(m);
    } else if (d >= tomorrow && d <= nextWindow) {
      next_matches.push(m);
    }
  });

  today_matches.sort(
    (a, b) =>
      new Date(a.date) - new Date(b.date) ||
      a.competition.localeCompare(b.competition) ||
      a.home_team.name.localeCompare(b.home_team.name)
  );
  last_matches.sort((a, b) => new Date(b.date) - new Date(a.date));
  next_matches.sort((a, b) => new Date(a.date) - new Date(b.date));

  res.json({ last_updated: matchData.last_updated, today_matches, last_matches, next_matches });
});

// ======================================
// 5. ENDPOINT CR*D MATCH
//    Form POST /api/matches (create)
//    GET /api/matches/:id (read)
//    PUT /api/matches/:id (update)
//    DELETE /api/matches/:id (delete)
// ======================================
app.post('/api/matches', (req, res) => {
  try {
    addMatchFromObject(req.body || {});
  } catch (err) {
    return res.status(400).send(err.message);
  }

  saveMatches((err) => {
    if (err) {
      return res.status(500).send('Gagal menyimpan data match.');
    }

    // balikin ke form dengan pesan sukses
    const wantsJSON =
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      req.is('application/json');
    if (wantsJSON) {
      return res.json({ status: 'ok' });
    }
    return res.redirect('/add-match.html?success=1');
  });
});

app.get('/api/matches/:id', (req, res) => {
  refreshMatchesIfChanged();
  normalizeAllMatches();
  const idx = findMatchIndex(req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Match tidak ditemukan' });
  return res.json(matchData.matches[idx]);
});

app.put('/api/matches/:id', (req, res) => {
  refreshMatchesIfChanged();
  normalizeAllMatches();
  const idx = findMatchIndex(req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Match tidak ditemukan' });

  const payload = req.body || {};
  const current = matchData.matches[idx];

  const competition = payload.competition || current.competition;
  const merged = {
    ...current,
    date: payload.date || current.date,
    competition,
    home_team: createTeam(
      payload.home_team_name || current.home_team?.name,
      payload.home_score ?? current.home_team?.score,
      competition,
      payload.home_team_logo_url || current.home_team?.logo_url
    ),
    away_team: createTeam(
      payload.away_team_name || current.away_team?.name,
      payload.away_score ?? current.away_team?.score,
      competition,
      payload.away_team_logo_url || current.away_team?.logo_url
    ),
  };

  matchData.matches[idx] = ensureMatchConsistency(merged);
  matchData.matches.sort((a, b) => new Date(a.date) - new Date(b.date));

  saveMatches((err) => {
    if (err) return res.status(500).send('Gagal menyimpan data match.');
    return res.json(matchData.matches[idx]);
  });
});

app.delete('/api/matches/:id', (req, res) => {
  refreshMatchesIfChanged();
  normalizeAllMatches();
  const idx = findMatchIndex(req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Match tidak ditemukan' });

  const deleted = matchData.matches.splice(idx, 1)[0];
  saveMatches((err) => {
    if (err) return res.status(500).send('Gagal menyimpan data match.');
    return res.json({ status: 'deleted', match: deleted });
  });
});

// ======================================
// 6. ENDPOINT AI AGENT (Gemini)
// ======================================
app.post('/agent', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt) return res.status(400).json({ error: 'Prompt wajib diisi' });

  if (!process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY belum diset' });
  }

  const apiVersion = (process.env.GEMINI_API_VERSION || 'v1').trim();
  const configuredModel = (process.env.GEMINI_MODEL || '').trim();
  
  // Ganti nama model ke gemini-2.5-flash
  const modelName = configuredModel || 'gemini-2.5-flash'; 
  
  const normalizedModel = modelName.replace(/^models\//i, '');

  console.log(`Gemini model: ${normalizedModel}, apiVersion: ${apiVersion} (Menambahkan baseUrl eksplisit)`);
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY, { apiVersion });
  
  const model = genAI.getGenerativeModel({ 
    model: normalizedModel,
    // Pertahankan Base URL eksplisit sebagai pengaman
    baseUrl: 'https://generativelanguage.googleapis.com/v1' 
  });

  const systemPrompt = `
Ubahlah perintah natural language menjadi JSON DENGAN FIELD WAJIB: date, competition, home_team_name, dan away_team_name.

Hanya masukkan field home_score dan away_score JIKA skor pertandingan disebutkan di prompt input. Jika skor tidak disebutkan (hanya menambahkan jadwal), JANGAN masukkan field skor tersebut.

Contoh format JSON (untuk jadwal, INI YANG ANDA INGINKAN):
{
  "date": "YYYY-MM-DD",
  "competition": "Nama Liga",
  "home_team_name": "Klub Home",
  "away_team_name": "Klub Away"
}
Contoh format JSON (untuk hasil):
{
  "date": "YYYY-MM-DD",
  "competition": "Nama Liga",
  "home_team_name": "Klub Home",
  "away_team_name": "Klub Away",
  "home_score": angka,
  "away_score": angka
}

Jawab HANYA JSON valid tanpa teks lain. Bahasa input bisa Indonesia.
`;

  try {
    const result = await model.generateContent([systemPrompt, prompt]);
    const text = result.response.text().trim();
    const cleaned = text
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return res.status(500).json({ error: 'Response AI tidak bisa diparse', raw: text });
    }

    let savedMatch;
    try {
      savedMatch = addMatchFromObject(parsed); // <<< ERROR TERJADI DI SINI
    } catch (err) {
      return res.status(400).json({ error: err.message }); // <<< PESAN ERROR DIKIRIM DARI SINI
    }

    await saveMatchesAsync();
    return res.json({ status: 'ok', saved_match: savedMatch });
  } catch (err) {
    console.error('Error Gemini:', err);
    return res.status(500).json({ error: 'Gagal memproses prompt AI', detail: err.message });
  }
});

// Route utama: kirim index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/index.html'));
});

// ======================================
// 7. BOOTSTRAP APP
// ======================================
let ready;
async function bootstrap() {
  if (ready) return ready;
  ready = (async () => {
    const { firestore: fsClient, useFirestore: enabled } = initFirestoreFromEnv();
    firestore = fsClient;
    useFirestore = enabled;
    await loadMatches();
    normalizeAllMatches();
    try {
      await saveMatchesAsync(); // pastikan dokumen/bacup ada
      console.log('Sync awal tersimpan (Firestore/file).');
    } catch (err) {
      console.error('Gagal sync awal:', err.message);
    }
  })();
  return ready;
}

// Jalankan server hanya jika dijalankan langsung (bukan di lingkungan Vercel)
if (!process.env.VERCEL && require.main === module) {
  bootstrap()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server berjalan di http://localhost:${port}`);
      });
    })
    .catch((err) => {
      console.error('Gagal start server:', err);
      process.exit(1);
    });
}

// Default export untuk runtime Vercel/Express preset harus fungsi/server.
const exportedReady = bootstrap();
module.exports = app;
module.exports.ready = exportedReady;
