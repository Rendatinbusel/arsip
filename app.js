/* =================================================================
   Arsip Rendatin — Sistem Pengarsipan Data (LIVE API CONNECTOR)
================================================================= */
const API_URL = 'https://script.google.com/macros/s/AKfycbxLqzP55ZEwHv7lj_05wheBsxTE6WINdKA4YPnt93FL8OHla-JVe3aIn0DEw5KfundcBw/exec'; 
const SESSION_KEY = 'arsipku.sesi.v2';

const CATS = ['Surat Masuk', 'Surat Keluar', 'SK dan BA', 'Perencanaan'];
const PER_PAGE = 8;

const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = d => new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(d);
const fmtDay = d => new Intl.DateTimeFormat('id-ID',{weekday:'short'}).format(d);
const initials = s => String(s||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const AV_PALETTE = [['#b91c1c','#fef2f2'],['#ea580c','#fff7ed'],['#f59e0b','#fffbeb'],['#059669','#ecfdf5'],['#3b82f6','#eff6ff']];
const avColor = key => {let h=0;for(const c of String(key))h=(h*31+c.charCodeAt(0))>>>0;return AV_PALETTE[h%5];};
const avStyle = key => {const[fg,bg]=avColor(key);return `background:${bg};color:${fg}`;};
const hl = (escaped,q) => {if(!q)return escaped;const rx=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig');return escaped.replace(rx,'<mark>$1</mark>');};
const icons = () => {try{lucide.createIcons();}catch(e){}};

let data = [];
let profil = { name: 'Memuat...' };
const state = { view:'dash', query:'', cat:'semua', sortKey:'createdAt', sortDir:'desc', page:1, editingId:null, detailId:null, confirmId:null, justAdded:null };

async function fetchAPI(action, payload = {}) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...payload }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    return await res.json();
  } catch (err) {
    console.error("Gagal terhubung ke server:", err);
    return { success: false, message: "Koneksi ke server gagal." };
  }
}

function toast(msg, type){
  type = type||'ok';
  const ic = {ok:'circle-check',del:'trash-2',info:'bell'}[type]||'circle-check';
  const el = document.createElement('div');
  el.className = 'toast'+(type==='del'?' del':'');
  el.innerHTML = `<i data-lucide="${ic}"></i><span>${msg}</span>`;
  $('#toasts').appendChild(el); icons();
  const kill = () => {el.classList.add('gone');setTimeout(()=>el.remove(),350);};
  el.addEventListener('click',kill); setTimeout(kill,3600);
}

$('#togglePass').addEventListener('click', () => {
  const i = $('#loginPass'), show = i.type === 'password'; i.type = show ? 'text' : 'password';
  $('#togglePass').innerHTML = `<i data-lucide="${show?'eye-off':'eye'}"></i>`; icons(); i.focus();
});
$('#forgot').addEventListener('click', () => toast('Hubungi administrator sistem untuk mereset kata sandi.','info'));

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const u = $('#loginUser').value.trim(), p = $('#loginPass').value, btn = $('#loginBtn');
  if(!u || !p) return;

  btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Memverifikasi…'; icons();
  
  const result = await fetchAPI('login', { username: u, password: p });
  
  btn.disabled = false; btn.innerHTML = '<i data-lucide="log-in"></i> Masuk'; icons();
  
  if (result.success) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(result.user));
    profil.name = result.user.name;
    $('#loginErr').classList.remove('show');
    enterApp();
    toast(`Selamat datang, <b>${esc(profil.name)}</b>.`, 'ok');
  } else {
    $('#loginErrMsg').textContent = result.message || "Nama pengguna atau kata sandi salah.";
    $('#loginErr').classList.add('show');
    const c = $('.l-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
  }
});

$('#btnLogout').addEventListener('click', logout);
$('#menuLogout').addEventListener('click', logout);
function logout(){
  sessionStorage.removeItem(SESSION_KEY);
  data = [];
  $('#viewApp').classList.add('hide'); $('#viewLogin').classList.remove('hide');
  $('#loginPass').value = ''; $('#loginErr').classList.remove('show');
  toast('Anda telah keluar dari sistem.', 'info');
}

async function enterApp(){
  $('#loginUser').value=''; $('#loginPass').value='';
  $('#viewLogin').classList.add('hide'); $('#viewApp').classList.remove('hide');
  applyProfile();
  showView('dash');
  
  $('#dashHello').innerHTML = '<i data-lucide="loader-circle" class="spin" style="width:20px;height:20px;margin-bottom:-2px"></i> Memuat Data...';
  icons();
  await loadDataServer();
  $('#dashHello').textContent = 'Selamat datang, ' + (profil.name).split(' ')[0];
}

async function loadDataServer() {
  const result = await fetchAPI('getData');
  if (result.success) {
    data = result.data || [];
    renderAll();
  } else {
    toast('Gagal memuat data arsip dari server.', 'del');
  }
}

function applyProfile(){
  const n = profil.name || 'Memuat...';
  $('#sbName').textContent = n; $('#topName').textContent = n;
  $('#sbAva').textContent = initials(n); $('#topAva').textContent = initials(n);
  $('#setName').value = n;
}

$('#dashDate').textContent = new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());

function showView(v){
  state.view = v;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view-pane').forEach(p => p.classList.toggle('active', p.id === 'v'+v.charAt(0).toUpperCase()+v.slice(1)));
  closeSidebar(); window.scrollTo({top:0});
}

$$('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
$('#menuProfile').addEventListener('click', () => { closeMenu(); showView('set'); });
$('#btnSeeAll').addEventListener('click', () => showView('data'));
$('#btnRefreshData').addEventListener('click', async () => {
    const btn = $('#btnRefreshData');
    const ogHtml = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Menyegarkan...'; icons();
    toast('Menyegarkan data...', 'info');
    
    await loadDataServer();
    
    btn.disabled = false; btn.innerHTML = ogHtml; icons();
});

$('#hamburger').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
$('#scrim').addEventListener('click', closeSidebar);
function closeSidebar(){ $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

$('#btnUserMenu').addEventListener('click', e => { e.stopPropagation(); $('#userMenu').classList.toggle('open'); });
document.addEventListener('click', e => { if(!e.target.closest('#userMenu') && !e.target.closest('#btnUserMenu')) closeMenu(); });
function closeMenu(){ $('#userMenu').classList.remove('open'); }

// Sinkronisasi Pencarian Bilah Atas
$('#globalSearch').addEventListener('input', e => {
  state.query = e.target.value;
  state.page = 1;
  if(state.view !== 'data') showView('data');
  renderTable();
});

const MODALS = ['#mForm','#mDetail','#mConfirm','#mNotif','#mPreview'];
function openModal(sel){ $('#overlay').classList.add('show'); MODALS.forEach(m => $(m).classList.toggle('open', m === sel)); document.body.style.overflow='hidden'; }
function closeModals(){ 
  $('#overlay').classList.remove('show'); 
  MODALS.forEach(m => $(m).classList.remove('open')); 
  document.body.style.overflow=''; 
  $('#cYes').onclick = yesDelete; // Reset fungsi tombol hapus agar tidak tersangkut
  const pv = $('#pvFrame'); if(pv) pv.src = ''; // Hentikan pratinjau saat modal ditutup
}
$('#overlay').addEventListener('click', closeModals);
$$('[data-close]').forEach(b => b.addEventListener('click', closeModals));
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if(e.key === 'Escape'){ closeModals(); closeSidebar(); closeMenu(); }
  if(e.key === '/' && !typing && !$('#viewApp').classList.contains('hide')){ e.preventDefault(); $('#globalSearch').focus(); }
});

function renderNotif(){
  $('#notifBody').innerHTML = `<div class="empty" style="padding:36px 12px"><div class="ico"><i data-lucide="bell-off"></i></div>
    <h4>Tidak ada notifikasi</h4><p>Semua arsip dalam kondisi terkendali.</p></div>`;
  $('#notifDot').style.display = 'none';
  icons();
}
$('#btnNotif').addEventListener('click', () => { renderNotif(); openModal('#mNotif'); });
$('#menuNew').addEventListener('click', () => { closeMenu(); openForm(null); });

function fillSelect(sel, arr, all){ sel.innerHTML = (all?`<option value="semua">${all}</option>`:'')+arr.map(v=>`<option>${esc(v)}</option>`).join(''); }
fillSelect($('#fKategori'), CATS);
fillSelect($('#fCat'), CATS, 'Semua Kategori');

function setInvalid(n, on){ document.querySelector(`.field[data-f="${n}"]`).classList.toggle('invalid', on); }

function openForm(id){
  state.editingId = id || null; const edit = !!id;
  $('#formTitle').textContent = edit ? 'Ubah Data Arsip' : 'Arsip Baru';
  $('#formSub').textContent = edit ? 'Perbarui informasi dokumen.' : 'Lengkapi data dokumen untuk didaftarkan.';
  $('#btnSaveTxt').textContent = edit ? 'Simpan Perubahan' : 'Simpan Arsip';
  $$('#arsipForm .field').forEach(f => f.classList.remove('invalid'));
  
  if(edit){
    const r = data.find(x => String(x.id) === String(id));
    $('#fJudul').value = r.judul; $('#fKategori').value = r.kategori;
    $('#fTanggal').value = r.tanggal; $('#fKet').value = r.ket || '';
    $('#fFile').value = '';
  }else{
    $('#arsipForm').reset();
    $('#fTanggal').value = new Date().toISOString().slice(0,10);
  }
  openModal('#mForm'); setTimeout(() => $('#fJudul').focus(), 280);
}
$('#btnNewDash').addEventListener('click', () => openForm(null));
$('#btnNewData').addEventListener('click', () => openForm(null));

async function submitForm(){
  const judul = $('#fJudul').value.trim(), tanggal = $('#fTanggal').value;
  let ok = true;
  setInvalid('judul', !judul); ok = ok && !!judul;
  setInvalid('tanggal', !tanggal); ok = ok && !!tanggal;
  if(!ok) return;

  const fileInput = $('#fFile');
  const file = fileInput.files[0];
  const isUploading = !!file;

  const sendPayload = async (fileBase64 = null, fileName = null, fileType = null) => {
    const payload = { 
      id: state.editingId, 
      judul, 
      kategori: $('#fKategori').value, 
      tanggal, 
      ket: $('#fKet').value.trim(),
      fileBase64,
      fileName,
      fileType
    };

    const btn = $('#btnSave');
    const loadingText = isUploading ? 'Mengunggah...' : 'Menyimpan...';
    btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-circle" class="spin"></i> ${loadingText}`; icons();

    const action = state.editingId ? 'updateData' : 'insertData';
    const result = await fetchAPI(action, payload);

    btn.disabled = false; btn.innerHTML = `<i data-lucide="save"></i><span id="btnSaveTxt">${state.editingId ? 'Simpan Perubahan' : 'Simpan Arsip'}</span>`; icons();

    if (result.success) {
      closeModals();
      state.justAdded = result.id || state.editingId;
      if(!state.editingId) { state.page = 1; state.sortKey = 'createdAt'; state.sortDir = 'desc'; }
      if(state.view !== 'data') showView('data');
      toast(result.message || 'Data berhasil disimpan.', 'ok');
      await loadDataServer();
    } else {
      toast(result.message || 'Gagal menyimpan data.', 'del');
    }
  };

  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      sendPayload(e.target.result, file.name, file.type);
    };
    reader.onerror = function() {
      toast('Gagal membaca file.', 'del');
    };
    reader.readAsDataURL(file);
  } else {
    sendPayload();
  }
}
$('#arsipForm').addEventListener('submit', e => { e.preventDefault(); submitForm(); });
$('#btnSave').addEventListener('click', submitForm);

function driveFileId_(url){
  if(!url) return null;
  let m = String(url).match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if(m) return m[1];
  m = String(url).match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}
function openPreview(url, name){
  $('#pvTitle').textContent = name || 'Pratinjau File';
  $('#pvOpenTab').href = url || '#';
  const fileId = driveFileId_(url);
  const frame = $('#pvFrame');
  if(fileId){
    frame.src = `https://drive.google.com/file/d/${fileId}/preview`;
    frame.style.display = 'block';
    $('#pvFallback').style.display = 'none';
  } else {
    frame.src = '';
    frame.style.display = 'none';
    $('#pvFallback').style.display = 'flex';
  }
  openModal('#mPreview');
}

function openDetail(id){
  const r = data.find(x => String(x.id) === String(id)); if(!r) return;
  state.detailId = id;
  $('#dAva').style.cssText = avStyle(r.kategori) + ';width:48px;height:48px;border-radius:13px;font-size:14px';
  $('#dAva').textContent = initials(r.judul);
  $('#dJudul').textContent = r.judul;
  $('#dKategori').textContent = r.kategori;
  $('#dTanggal').textContent = fmtDate(new Date(r.tanggal));
  $('#dDaftar').textContent = fmtDate(new Date(r.createdAt));
  $('#dKet').textContent = r.ket || 'Tidak ada keterangan.';
  
  if (r.fileUrl && r.fileName) {
    $('#dFileWrapper').style.display = 'block';
    if (String(r.fileUrl).startsWith('GAGAL_UPLOAD')) {
      $('#dFileLink').innerHTML = `<span style="color:var(--red);display:inline-flex;align-items:center;gap:6px">
        <i data-lucide="triangle-alert"></i>Upload file sebelumnya gagal, silakan unggah ulang.</span>`;
      icons();
    } else {
      $('#dFileLink').innerHTML = `
        <div class="file-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="dFilePreviewBtn"><i data-lucide="eye"></i>Pratinjau</button>
          <a href="${r.fileUrl}" target="_blank" rel="noopener" class="link"><i data-lucide="paperclip"></i>${esc(r.fileName)}</a>
        </div>`;
      icons();
      $('#dFilePreviewBtn').onclick = () => openPreview(r.fileUrl, r.fileName);
    }
  } else {
    $('#dFileWrapper').style.display = 'none';
  }
  openModal('#mDetail');
}
$('#dEdit').addEventListener('click', () => { const id = state.detailId; closeModals(); setTimeout(()=>openForm(id), 200); });
$('#dDel').addEventListener('click', () => { const id = state.detailId; closeModals(); setTimeout(()=>openConfirm(id), 200); });

function openConfirm(id){
  const r = data.find(x => String(x.id) === String(id)); if(!r) return;
  state.confirmId = id;
  $('#cAva').style.cssText = avStyle(r.kategori); $('#cAva').textContent = initials(r.judul);
  $('#cJudul').textContent = r.judul;
  openModal('#mConfirm');
}

async function yesDelete(){
  const btn = $('#cYes');
  btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Menghapus...'; icons();

  const result = await fetchAPI('deleteData', { id: state.confirmId });

  btn.disabled = false; btn.innerHTML = '<i data-lucide="trash-2"></i>Ya, Hapus'; icons();

  if(result.success){
    closeModals();
    toast(result.message || 'Arsip berhasil dihapus.', 'del');
    await loadDataServer();
  } else {
    toast(result.message || 'Gagal menghapus data.', 'del');
  }
}
$('#cYes').onclick = yesDelete;

function renderStats(){
  $('#stTotal').textContent = data.length;
  $('#stKeluar').textContent = data.filter(x => x.kategori === 'Surat Keluar').length;
  $('#stMasuk').textContent = data.filter(x => x.kategori === 'Surat Masuk').length;
  $('#stSkBa').textContent = data.filter(x => x.kategori === 'SK dan BA').length;
  $('#stPerencanaan').textContent = data.filter(x => x.kategori === 'Perencanaan').length;

  const now = Date.now(), w = 7*864e5;
  const baru = data.filter(x => new Date(x.createdAt).getTime() >= now-w).length;
  $('#trTotal').textContent = '+' + baru + ' pekan ini';
}
function renderActivity(){
  const days = []; const today = new Date(); today.setHours(0,0,0,0);
  for(let i=6; i>=0; i--){
    const d = new Date(today.getTime() - i*864e5);
    const next = d.getTime() + 864e5;
    const n = data.filter(x => { const t = new Date(x.createdAt).getTime(); return t >= d.getTime() && t < next; }).length;
    days.push({label: fmtDay(d), n});
  }
  const max = Math.max(1, ...days.map(d => d.n));
  const total = days.reduce((s,d) => s + d.n, 0);
  $('#actTotal').textContent = total + ' pendaftaran';
  $('#actBars').innerHTML = days.map(d => 
    `<div class="b"><div class="fill${d.n===max && d.n>0 ? ' hot':''}" style="height:${Math.max(5,Math.round(d.n/max*100))}%" data-tip="${d.n} arsip"></div><span class="d">${d.label}</span></div>`).join('');
}
function renderCats(){
  const counts = CATS.map(c => ({c, n: data.filter(x => x.kategori === c).length})).sort((a,b) => b.n - a.n);
  const max = Math.max(1, ...counts.map(x => x.n));
  $('#catBox').innerHTML = counts.length
    ? counts.map(x => `<div class="cat"><span class="n">${esc(x.c)}</span><span class="tr"><span class="fl" data-w="${Math.round(x.n/max*100)}"></span></span><span class="v">${x.n}</span></div>`).join('')
    : '<p style="color:var(--muted);font-size:13px;padding:8px 0">Belum ada data arsip.</p>';
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.cat .fl').forEach(f => f.style.width = f.dataset.w + '%')));
}
function renderRecent(){
  const rows = [...data].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,5);
  $('#recentBody').innerHTML = rows.length ? rows.map(r => `
    <tr data-id="${r.id}" class="${String(r.id) === String(state.justAdded) ? 'row-new' : ''}">
      <td><div class="cell-doc"><span class="avatar av" style="${avStyle(r.kategori)}">${initials(r.judul)}</span>
        <div><b>${esc(r.judul)}</b><span>${esc(r.ket || '-')}</span></div></div></td>
      <td><span class="chip">${esc(r.kategori)}</span></td>
      <td class="cell-muted">${esc(fmtDate(new Date(r.tanggal)))}</td>
      <td class="c-act"><button class="icon-btn" data-act="view" title="Detail"><i data-lucide="eye"></i></button></td>
    </tr>`).join('')
    : `<tr><td colspan="4"><div class="empty"><div class="ico"><i data-lucide="inbox"></i></div>
      <h4>Belum ada arsip</h4><p>Daftarkan dokumen pertama Anda.</p>
      <button class="btn btn-primary" onclick="openForm(null)"><i data-lucide="plus"></i>Arsip Baru</button></div></td></tr>`;
  icons();
}

function filtered(){
  let rows = [...data];
  const q = state.query.trim().toLowerCase();
  if(q) rows = rows.filter(r => [r.judul, r.ket, r.kategori].some(v => (v||'').toLowerCase().includes(q)));
  if(state.cat !== 'semua') rows = rows.filter(r => r.kategori === state.cat);
  const k = state.sortKey, dir = state.sortDir === 'asc' ? 1 : -1;
  rows.sort((a,b) => String(a[k]??'').localeCompare(String(b[k]??''), 'id', {sensitivity:'base'}) * dir);
  return rows;
}
function renderTable(){
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PER_PAGE;
  const pageRows = rows.slice(start, start + PER_PAGE);
  const q = state.query.trim();
  $('#countInfo').textContent = rows.length ? `Menampilkan ${start+1}–${start+pageRows.length} dari ${rows.length} arsip` : 'Tidak ada arsip yang cocok';
  const tb = $('#tbody');
  
  if(!pageRows.length){
    tb.innerHTML = `<tr><td colspan="4"><div class="empty"><div class="ico"><i data-lucide="search-x"></i></div>
      <h4>Tidak ditemukan</h4><p>Coba ubah kata kunci atau longgarkan saringan.</p>
      <button class="btn btn-ghost" id="resetF"><i data-lucide="rotate-ccw"></i>Setel ulang saringan</button></div></td></tr>`;
  }else{
    tb.innerHTML = pageRows.map(r => `
      <tr data-id="${r.id}" class="${String(r.id) === String(state.justAdded) ? 'row-new' : ''}">
        <td><div class="cell-doc"><span class="avatar av" style="${avStyle(r.kategori)}">${initials(r.judul)}</span>
          <div><b>${hl(esc(r.judul), q)}</b><span>${hl(esc(r.ket || '-'), q)}</span></div></div></td>
        <td><span class="chip">${hl(esc(r.kategori), q)}</span></td>
        <td class="cell-muted">${esc(fmtDate(new Date(r.tanggal)))}</td>
        <td class="c-act">
          <button class="icon-btn" data-act="view" title="Detail"><i data-lucide="eye"></i></button>
          <button class="icon-btn" data-act="edit" title="Ubah"><i data-lucide="pencil"></i></button>
          <button class="icon-btn del" data-act="del" title="Hapus"><i data-lucide="trash-2"></i></button>
        </td></tr>`).join('');
  }
  icons();
  $$('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if(th.dataset.sort === state.sortKey) th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  $('#pageInfo').textContent = state.page + ' / ' + pages;
  $('#pPrev').disabled = state.page <= 1;
  $('#pNext').disabled = state.page >= pages;
  
  const rf = $('#resetF');
  if(rf) rf.addEventListener('click', () => {
    state.query = ''; state.cat = 'semua'; state.page = 1;
    $('#q').value = ''; $('#globalSearch').value = ''; $('#fCat').value = 'semua'; renderTable();
  });
}

['#tbody', '#recentBody'].forEach(sel => {
  $(sel).addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]'), tr = e.target.closest('tr[data-id]');
    if(!tr) return; const id = tr.dataset.id;
    if(btn){
      e.stopPropagation();
      if(btn.dataset.act === 'view') openDetail(id);
      if(btn.dataset.act === 'edit') openForm(id);
      if(btn.dataset.act === 'del') openConfirm(id);
    } else openDetail(id);
  });
});
$('#thead').addEventListener('click', e => {
  const b = e.target.closest('button.th-in'); if(!b) return;
  const k = b.dataset.sort;
  if(state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  else { state.sortKey = k; state.sortDir = 'asc'; }
  renderTable();
});

// Perbaikan Sinkronisasi Pencarian Dua Arah (Tabel)
$('#q').addEventListener('input', e => { 
  state.query = e.target.value; 
  $('#globalSearch').value = state.query; 
  state.page = 1; 
  renderTable(); 
});

$('#fCat').addEventListener('change', e => { state.cat = e.target.value; state.page = 1; renderTable(); });
$('#pPrev').addEventListener('click', () => { if(state.page > 1){ state.page--; renderTable(); }});
$('#pNext').addEventListener('click', () => { state.page++; renderTable(); });

$('#btnSaveName').addEventListener('click', async () => {
  const n = $('#setName').value.trim();
  if(!n) { toast('Nama tampilan tidak boleh kosong.', 'del'); return; }
  const btn = $('#btnSaveName');
  btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Menyimpan...'; icons();
  
  const result = await fetchAPI('updateProfile', { name: n });
  
  btn.disabled = false; btn.innerHTML = '<i data-lucide="check"></i>Simpan Profil'; icons();
  
  if(result.success){
    profil.name = n;
    applyProfile();
    $('#dashHello').textContent = 'Selamat datang, ' + n.split(' ')[0];
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    s.name = n; sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    toast(result.message || 'Profil berhasil diperbarui.', 'ok');
  } else toast(result.message || 'Gagal mengubah profil.', 'del');
});

$('#btnSavePass').addEventListener('click', async () => {
  const old = $('#oldP').value, nw = $('#newP').value, nw2 = $('#newP2').value;
  if(nw.length < 6) { toast('Kata sandi baru minimal 6 karakter.', 'del'); return; }
  if(nw !== nw2) { toast('Konfirmasi kata sandi tidak cocok.', 'del'); return; }
  
  const btn = $('#btnSavePass');
  btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Memproses...'; icons();
  
  const result = await fetchAPI('updatePassword', { oldPass: old, newPass: nw });
  
  btn.disabled = false; btn.innerHTML = '<i data-lucide="key-round"></i>Ubah Sandi'; icons();
  
  if(result.success){
    $('#oldP').value = $('#newP').value = $('#newP2').value = '';
    toast(result.message || 'Kata sandi berhasil diubah.', 'ok');
  } else toast(result.message || 'Kata sandi saat ini salah atau gagal dirubah.', 'del');
});

function renderAll(){ renderStats(); renderActivity(); renderCats(); renderRecent(); renderTable(); }

(async function init(){
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if(raw) {
      const parsed = JSON.parse(raw);
      profil.name = parsed.name || 'Petugas';
      enterApp();
    }
  } catch(e) {}
  icons();
})();