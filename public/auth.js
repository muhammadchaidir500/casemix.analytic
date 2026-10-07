// =====================================================================
// Logic login / registrasi / status persetujuan akun.
// Menggunakan Firebase Authentication + Firestore.
// Tidak perlu diubah kecuali Anda ingin menambah field lain.
// =====================================================================
import { firebaseConfig } from '/firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, getDocs, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// =====================================================================
// GANTI dengan email Anda sendiri. Boleh huruf besar/kecil bebas (dicek
// otomatis tanpa membedakan huruf besar/kecil) — tapi pastikan email-nya
// sendiri benar (tidak typo), dan SAMA dengan email di firestore.rules
// (isi firestore.rules WAJIB huruf kecil semua, lihat komentar di sana).
// =====================================================================
const ADMIN_EMAIL = 'muhammadchaidir500@gmail.com';
const EXPIRY_DAYS = 90;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function $(id){ return document.getElementById(id); }

const STATES = ['stateLoading','stateLogin','stateForgot','stateRegister','statePending','stateRejected','stateExpired','statePendingRenewal'];
function showState(id){
  STATES.forEach(s=>{ $(s).style.display = (s===id) ? 'block' : 'none'; });
}

function translateAuthError(ex){
  const code = (ex && ex.code) || '';
  const map = {
    'auth/email-already-in-use': 'Email ini sudah terdaftar. Silakan masuk.',
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/weak-password': 'Kata sandi minimal 6 karakter.',
    'auth/missing-password': 'Kata sandi wajib diisi.',
    'auth/user-not-found': 'Email atau kata sandi salah.',
    'auth/wrong-password': 'Email atau kata sandi salah.',
    'auth/invalid-credential': 'Email atau kata sandi salah.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.',
    'auth/missing-email': 'Email wajib diisi.'
  };
  return map[code] || ('Terjadi kesalahan. (' + (code || 'tidak diketahui') + ')');
}

// ---- pindah antara form login <-> daftar ----
$('showRegister').addEventListener('click', e=>{ e.preventDefault(); showState('stateRegister'); });
$('showLogin').addEventListener('click', e=>{ e.preventDefault(); showState('stateLogin'); });
$('showForgot').addEventListener('click', e=>{
  e.preventDefault();
  $('forgotError').style.display = 'none';
  $('forgotSuccess').style.display = 'none';
  const prefill = $('loginEmail').value.trim();
  if(prefill) $('forgotEmail').value = prefill;
  showState('stateForgot');
});
$('showLoginFromForgot').addEventListener('click', e=>{ e.preventDefault(); showState('stateLogin'); });

// ---- lihat/sembunyikan kata sandi ----
function wirePasswordToggle(btnId, inputId){
  const btn = $(btnId), input = $(inputId);
  btn.addEventListener('click', ()=>{
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? '\u{1F648}' : '\u{1F441}\uFE0F';
    btn.setAttribute('aria-label', isHidden ? 'Sembunyikan kata sandi' : 'Lihat kata sandi');
  });
}
wirePasswordToggle('toggleLoginPassword', 'loginPassword');
wirePasswordToggle('toggleRegPassword', 'regPassword');

// ---- lupa kata sandi ----
$('forgotForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const err = $('forgotError'); err.style.display = 'none';
  const ok = $('forgotSuccess'); ok.style.display = 'none';
  const email = $('forgotEmail').value.trim();
  $('forgotSubmit').disabled = true;
  try{
    await sendPasswordResetEmail(auth, email);
    ok.textContent = 'Tautan reset kata sandi sudah dikirim ke ' + email + '. Periksa kotak masuk (dan folder spam) email Anda.';
    ok.style.display = 'block';
    $('forgotForm').reset();
  }catch(ex){
    err.textContent = translateAuthError(ex);
    err.style.display = 'block';
  }finally{
    $('forgotSubmit').disabled = false;
  }
});

// ---- daftar ----
$('registerForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const err = $('registerError'); err.style.display = 'none';
  const name = $('regName').value.trim();
  const email = $('regEmail').value.trim();
  const password = $('regPassword').value;
  $('registerSubmit').disabled = true;
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      email: email,
      displayName: name,
      status: 'pending',
      requestedAt: serverTimestamp()
    });
    $('regName').value = ''; $('regEmail').value = ''; $('regPassword').value = '';
    showState('statePending');
  }catch(ex){
    err.textContent = translateAuthError(ex);
    err.style.display = 'block';
  }finally{
    $('registerSubmit').disabled = false;
  }
});

// ---- masuk ----
$('loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const err = $('loginError'); err.style.display = 'none';
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  $('loginSubmit').disabled = true;
  try{
    await signInWithEmailAndPassword(auth, email, password);
    $('loginPassword').value = '';
    // status akun ditangani oleh onAuthStateChanged di bawah
  }catch(ex){
    err.textContent = translateAuthError(ex);
    err.style.display = 'block';
  }finally{
    $('loginSubmit').disabled = false;
  }
});

// ---- keluar ----
['btnLogoutPending','btnLogoutRejected','btnLogoutExpired','btnLogoutRenewal','btnLogoutApp'].forEach(id=>{
  const el = $(id);
  if(el) el.addEventListener('click', ()=> signOut(auth));
});

// ---- periksa status lagi (tombol manual) ----
$('btnRecheckPending').addEventListener('click', ()=> refreshUserStatus());
$('btnRecheckRenewal').addEventListener('click', ()=> refreshUserStatus());

// ---- ajukan perpanjangan (akun expired) ----
$('btnRequestRenewal').addEventListener('click', async ()=>{
  const err = $('renewalError'); err.style.display = 'none';
  const user = auth.currentUser;
  if(!user) return;
  $('btnRequestRenewal').disabled = true;
  try{
    await updateDoc(doc(db, 'users', user.uid), {
      status: 'pending_renewal',
      renewalRequestedAt: serverTimestamp()
    });
    showState('statePendingRenewal');
  }catch(ex){
    err.textContent = 'Gagal mengirim permintaan perpanjangan. Coba lagi.';
    err.style.display = 'block';
  }finally{
    $('btnRequestRenewal').disabled = false;
  }
});

async function refreshUserStatus(){
  const user = auth.currentUser;
  if(!user) return;
  showState('stateLoading');
  try{
    const snap = await getDoc(doc(db, 'users', user.uid));
    applyUserDoc(user, snap.exists() ? snap.data() : null);
  }catch(ex){
    showState('stateLogin');
  }
}

function applyUserDoc(user, data){
  const isAdminUser = (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  $('btnOpenAdmin').style.display = isAdminUser ? 'inline-block' : 'none';

  if(isAdminUser){
    // Admin tidak perlu melalui alur persetujuan sendiri.
    $('userBarEmail').textContent = user.email + ' (Admin)';
    $('userBarExpiry').textContent = '';
    window.__casemixUnlockApp();
    return;
  }

  if(!data){
    showState('stateLogin');
    return;
  }
  $('userBarEmail').textContent = data.email || user.email;

  if(data.status === 'approved'){
    const expiresAtMs = (data.expiresAt && data.expiresAt.toMillis) ? data.expiresAt.toMillis() : 0;
    if(expiresAtMs && Date.now() < expiresAtMs){
      const expDate = new Date(expiresAtMs).toLocaleDateString('id-ID', {day:'2-digit', month:'short', year:'numeric'});
      $('userBarExpiry').textContent = 'Berlaku sampai ' + expDate;
      window.__casemixUnlockApp();
    } else {
      // Sudah lewat waktu -> perlakukan sebagai kedaluwarsa (tanpa perlu proses server terjadwal).
      showState('stateExpired');
    }
    return;
  }
  if(data.status === 'pending'){ showState('statePending'); return; }
  if(data.status === 'pending_renewal'){ showState('statePendingRenewal'); return; }
  if(data.status === 'rejected'){ showState('stateRejected'); return; }
  if(data.status === 'expired'){ showState('stateExpired'); return; }
  showState('statePending');
}

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    window.__casemixLockApp();
    showState('stateLogin');
    return;
  }
  showState('stateLoading');
  try{
    const snap = await getDoc(doc(db, 'users', user.uid));
    applyUserDoc(user, snap.exists() ? snap.data() : null);
  }catch(ex){
    showState('stateLogin');
  }
});

// =====================================================================
// Panel Admin
// =====================================================================
$('btnOpenAdmin').addEventListener('click', ()=>{
  document.getElementById('adminPanel').style.display = 'flex';
  loadAdminLists();
});
$('btnCloseAdmin').addEventListener('click', ()=>{
  document.getElementById('adminPanel').style.display = 'none';
});

function fmtTs(ts){
  if(!ts || !ts.toMillis) return '-';
  return new Date(ts.toMillis()).toLocaleDateString('id-ID', {day:'2-digit', month:'short', year:'numeric'});
}

const STATUS_LABEL = {
  pending: 'Menunggu Persetujuan',
  pending_renewal: 'Menunggu Perpanjangan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  expired: 'Kedaluwarsa'
};

async function loadAdminLists(){
  const pendingBox = $('adminPendingList');
  const allBox = $('adminAllList');
  pendingBox.innerHTML = '<div class="admin-empty">Memuat&hellip;</div>';
  allBox.innerHTML = '';

  let users = [];
  try{
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
  }catch(ex){
    pendingBox.innerHTML = '<div class="admin-empty">Gagal memuat data. Pastikan Anda login dengan email admin yang benar.</div>';
    return;
  }

  const pending = users.filter(u => u.status === 'pending' || u.status === 'pending_renewal');
  const rest = users.filter(u => u.status !== 'pending' && u.status !== 'pending_renewal')
    .sort((a,b)=> (a.email||'').localeCompare(b.email||''));

  pendingBox.innerHTML = pending.length ? '' : '<div class="admin-empty">Tidak ada permintaan yang menunggu.</div>';
  pending.forEach(u=>{
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `
      <div class="who">
        <strong>${u.displayName || '-'}</strong>
        <span>${u.email} &middot; ${STATUS_LABEL[u.status] || u.status}</span>
      </div>
      <div class="actions">
        <button class="btn-primary" data-act="approve" data-id="${u.id}">Setujui (90 hari)</button>
        <button class="btn-danger" data-act="reject" data-id="${u.id}">Tolak</button>
      </div>`;
    pendingBox.appendChild(row);
  });

  allBox.innerHTML = rest.length ? '' : '<div class="admin-empty">Belum ada akun lain.</div>';
  rest.forEach(u=>{
    const row = document.createElement('div');
    row.className = 'admin-row';
    const expiryTxt = u.status === 'approved' ? (' &middot; berlaku sampai ' + fmtTs(u.expiresAt)) : '';
    row.innerHTML = `
      <div class="who">
        <strong>${u.displayName || '-'}</strong>
        <span>${u.email} &middot; ${STATUS_LABEL[u.status] || u.status}${expiryTxt}</span>
      </div>
      <div class="actions">
        <button class="btn-ghost" data-act="extend" data-id="${u.id}">Perpanjang 90 Hari</button>
        <button class="btn-danger" data-act="revoke" data-id="${u.id}">Cabut Akses</button>
      </div>`;
    allBox.appendChild(row);
  });
}

async function setUserStatus(uid, fields){
  await updateDoc(doc(db, 'users', uid), fields);
}

[$('adminPendingList'), $('adminAllList')].forEach(box=>{
  box.addEventListener('click', async e=>{
    const btn = e.target.closest('button[data-act]');
    if(!btn) return;
    const uid = btn.dataset.id;
    const act = btn.dataset.act;
    btn.disabled = true;
    try{
      if(act === 'approve' || act === 'extend'){
        const expiresAt = Timestamp.fromMillis(Date.now() + EXPIRY_DAYS*24*60*60*1000);
        await setUserStatus(uid, { status: 'approved', approvedAt: serverTimestamp(), expiresAt });
      } else if(act === 'reject'){
        await setUserStatus(uid, { status: 'rejected' });
      } else if(act === 'revoke'){
        await setUserStatus(uid, { status: 'rejected' });
      }
      await loadAdminLists();
    }catch(ex){
      alert('Gagal memproses. Pastikan email login Anda sama persis dengan ADMIN_EMAIL di auth.js dan firestore.rules.');
      btn.disabled = false;
    }
  });
});
