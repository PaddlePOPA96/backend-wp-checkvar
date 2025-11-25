// Seed ulang Firestore dengan data dari matches.json
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initFirestoreFromEnv } = require('./firebase');

const MATCHES_FILE = path.join(__dirname, 'matches.json');
const FIRESTORE_DOC_PATH = 'matches/data';

const generateId =
  crypto.randomUUID ||
  (() => 'match-' + Date.now() + '-' + Math.random().toString(16).slice(2));

const normalizeScore = (score) => {
  if (score === '' || score === null || score === undefined) return null;
  const n = Number(score);
  return Number.isNaN(n) ? null : n;
};

function normalizeTeam(team = {}) {
  return {
    name: team.name || '',
    logo_url: team.logo_url || '',
    score: normalizeScore(team.score),
  };
}

function normalizeMatch(match = {}, idx = 0) {
  return {
    id: String(match.id || generateId() || `match-${idx}`),
    date: match.date || '',
    competition: match.competition || '',
    home_team: normalizeTeam(match.home_team || {}),
    away_team: normalizeTeam(match.away_team || {}),
  };
}

async function main() {
  const { firestore, useFirestore } = initFirestoreFromEnv();
  if (!useFirestore || !firestore) {
    throw new Error('Firestore belum terkonfigurasi. Cek env FIREBASE_* atau FIREBASE_CREDENTIALS_PATH.');
  }

  const raw = fs.readFileSync(MATCHES_FILE, 'utf8');
  const parsed = JSON.parse(raw);

  const matches = Array.isArray(parsed.matches)
    ? parsed.matches.map((m, idx) => normalizeMatch(m, idx))
    : [];

  const payload = {
    last_updated: parsed.last_updated || new Date().toISOString(),
    matches,
  };

  await firestore.doc(FIRESTORE_DOC_PATH).set(payload, { merge: false });
  console.log(`Firestore berhasil dioverwrite dengan ${matches.length} match.`);
}

main().catch((err) => {
  console.error('Gagal seed Firestore:', err.message);
  process.exit(1);
});
