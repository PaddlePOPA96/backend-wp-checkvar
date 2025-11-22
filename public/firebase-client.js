// Inisialisasi Firebase Web SDK untuk halaman frontend.
import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyBAQnizU0XoLpe3TllraLoZwoE-Sv_ib8I',
  authDomain: 'checkvar.firebaseapp.com',
  databaseURL: 'https://checkvar-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'checkvar',
  storageBucket: 'checkvar.firebasestorage.app',
  messagingSenderId: '27044982800',
  appId: '1:27044982800:web:2251ac2e5152932b6b5a95',
  measurementId: 'G-8954MR4NMV',
};

export const firebaseApp = initializeApp(firebaseConfig);

// Aktifkan Analytics jika lingkungan mendukung (HTTPS, browser modern).
isSupported()
  .then((supported) => {
    if (supported) getAnalytics(firebaseApp);
  })
  .catch((err) => {
    console.warn('Firebase Analytics non-aktif:', err.message);
  });
