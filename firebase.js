const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Inisialisasi Firestore dari environment variables
function initFirestoreFromEnv() {
  try {
    const credPath = process.env.FIREBASE_CREDENTIALS_PATH;
    let fileCreds = null;
    if (credPath) {
      try {
        const resolved = path.resolve(credPath);
        fileCreds = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        console.log('Memuat kredensial Firebase dari file.');
      } catch (err) {
        console.warn('Gagal membaca FIREBASE_CREDENTIALS_PATH:', err.message);
      }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || fileCreds?.project_id;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || fileCreds?.client_email;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || fileCreds?.private_key;
    if (!projectId || !clientEmail || !privateKey) {
      console.warn('Firebase env tidak lengkap, Firestore dimatikan.');
      return { firestore: null, useFirestore: false };
    }
    // Izinkan format multiline dengan \n
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
    const firestore = admin.firestore();
    console.log('Firestore diinisialisasi.');
    return { firestore, useFirestore: true };
  } catch (err) {
    console.warn('Firestore tidak aktif:', err.message);
    return { firestore: null, useFirestore: false };
  }
}

module.exports = { initFirestoreFromEnv };
