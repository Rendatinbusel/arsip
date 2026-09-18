/* ================================================================
   Arsip Rendatin — Frontend
   - Session token server-side
   - Role admin/user
   - Nomor arsip + tanggal unik
   - Manajemen user admin
   - Preview file via signed URL 15 menit
================================================================ */
const API_URL = 'https://gobgpaouqymsnleauiim.supabase.co/functions/v1/api';
const SUPABASE_KEY = 'sb_publishable_V__Lj9OuydfsBjt7kUeR8g_ndmz2CFD';
const SESSION_KEY = 'arsipku.sesi.v3';
const LEGACY_SESSION_KEY = 'arsipku.sesi.v2';
const CATS = ['Surat Masuk', 'Surat Keluar', 'SK dan BA', 'Perencanaan'];
const ROLES = ['user', 'admin'];
const PER_PAGE = 8;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf','image/jpeg','image/png','image/webp','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = d => { const x = new Date(d); return Number.isNaN(x.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(x); };
const fmtLongDate = d => new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d);
const fmtDay = d => new Intl.DateTimeFormat('id-ID',{weekday:'short'}).format(d);
const initials = s => String(s || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
const AV_PALETTE = [['#b91c1c','#fef2f2'],['#ea580c','#fff7ed'],['#f59e0b','#fffbeb'],['#059669','#ecfdf5'],['#3b82f6','#eff6ff']];
const avColor = key => { let h=0; for(const c of String(key)) h=(h*31+c.charCodeAt(0))>>>0; return AV_PALETTE[h%5]; };
const avStyle = key => { const [fg,bg] = avColor(key); return `background:${bg};color:${fg}`; };
const highlight = (escaped,q) => { if(!q) return escaped; const rx = new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'); return escaped.replace(rx,'<mark>$1</mark>'); };
const icons = () => { try { lucide.createIcons(); } catch {} };
const isAdmin = () => profil.role === 'admin';

let data = [];
let users = [];
let profil = { name:'Memuat...', username:'', role:'user' };
let dataLoaded = false;
const state = { view:'dash', query:'', cat:'semua', year:'semua', sortKey:'createdAt', sortDir:'desc', page:1, editingId:null, detailId:null, confirmId:null, resetUsername:null, justAdded:null };

function saveSession(token, user) {
  const payload = JSON.stringify({ token, user });
  // Persist di localStorage agar reload halaman tetap mempertahankan login.
  localStorage.setItem(SESSION_KEY, payload);
  sessionStorage.setItem(SESSION_KEY, payload);
  profil = { name:user.name || user.username, username:user.username, role:user.role === 'admin' ? 'admin' : 'user' };
}
function readSession(){
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return JSON.parse(stored);
    // Migrasi otomatis dari sesi versi lama bila masih ada.
    const legacy = sessionStorage.getItem(SESSION_KEY) || sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      localStorage.setItem(SESSION_KEY, legacy);
      sessionStorage.setItem(SESSION_KEY, legacy);
      return JSON.parse(legacy);
    }
  } catch {}
  return null;
}
function clearSession(){
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  profil = {name:'Memuat...',username:'',role:'user'};
}
function sessionToken(){ return readSession()?.token || ''; }

async function fetchAPI(action, payload = {}) {
  try {
    const token = sessionToken();
    const headers = { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY };
    if(token) headers['x-session-token'] = token;
    const res = await fetch(API_URL, { method:'POST', headers, body:JSON.stringify({action,...payload}) });
    let body = null;
    try { body = await res.json(); } catch { body = {success:false,message:'Respons server tidak valid.'}; }
    if ((res.status === 401 || body?.code === 'SESSION_EXPIRED' || body?.code === 'UNAUTHORIZED') && action !== 'login') {
      handleSessionExpired();
      return { success:false, message:'Sesi sudah berakhir. Silakan masuk kembali.', code:'SESSION_EXPIRED' };
    }
    return body;
  } catch (err) {
    console.error('Gagal terhubung ke server:', err);
    return { success:false, message:'Koneksi ke server gagal.' };
  }
}

function handleSessionExpired(){
  clearSession();
  data = []; users = []; dataLoaded = false;
  closeModals();
  $('#viewApp').classList.add('hide'); $('#viewLogin').classList.remove('hide');
  $('#loginPass').value = '';
  $('#loginErrMsg').textContent = 'Sesi Anda telah berakhir. Silakan masuk kembali.';
  $('#loginErr').classList.add('show');
}

function toast(msg, type='ok'){
  const ic = {ok:'circle-check',del:'trash-2',info:'bell',warn:'triangle-alert'}[type] || 'circle-check';
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'del' ? ' del' : type === 'warn' ? ' warn-toast' : '');
  const icon = document.createElement('i'); icon.setAttribute('data-lucide',ic);
  const span = document.createElement('span'); span.textContent = String(msg);
  el.append(icon,span); $('#toasts').appendChild(el); icons();
  const kill=()=>{el.classList.add('gone');setTimeout(()=>el.remove(),350);};
  el.addEventListener('click',kill); setTimeout(kill,3600);
}

const MODALS = ['#mForm','#mDetail','#mConfirm','#mNotif','#mPreview','#mDuplicate','#mUserForm','#mResetPass'];
function openModal(sel){ $('#overlay').classList.add('show'); MODALS.forEach(m => $(m)?.classList.toggle('open',m===sel)); document.body.style.overflow='hidden'; }
function closeModals(){ $('#overlay').classList.remove('show'); MODALS.forEach(m => $(m)?.classList.remove('open')); document.body.style.overflow=''; const frame=$('#pvFrame'); if(frame) frame.src=''; }
$('#overlay').addEventListener('click',closeModals);
$$('[data-close]').forEach(b=>b.addEventListener('click',closeModals));
document.addEventListener('keydown',e=>{ const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||''); if(e.key==='Escape'){closeModals();closeSidebar();closeMenu();} if(e.key==='/'&&!typing&&!$('#viewApp').classList.contains('hide')){e.preventDefault();$('#globalSearch').focus();} });

$('#togglePass').addEventListener('click',()=>{ const i=$('#loginPass'), show=i.type==='password'; i.type=show?'text':'password'; $('#togglePass').innerHTML=`<i data-lucide="${show?'eye-off':'eye'}"></i>`; icons(); i.focus(); });
$('#forgot').addEventListener('click',()=>toast('Hubungi administrator sistem untuk bantuan reset kata sandi.','info'));

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const u=$('#loginUser').value.trim(), p=$('#loginPass').value, btn=$('#loginBtn');
  if(!u||!p){$('#loginErrMsg').textContent='Username dan kata sandi wajib diisi.';$('#loginErr').classList.add('show');return;}
  btn.disabled=true; btn.innerHTML='<i data-lucide="loader-circle" class="spin"></i> Memverifikasi…'; icons();
  const result=await fetchAPI('login',{username:u,password:p});
  btn.disabled=false; btn.innerHTML='<i data-lucide="log-in"></i> Masuk'; icons();
  if(result.success){
    saveSession(result.token,result.user); data=result.data||[]; dataLoaded=true;
    $('#loginErr').classList.remove('show'); $('#loginPass').value=''; enterApp();
    toast(`Selamat datang, ${profil.name}.`,'ok');
  }else{
    $('#loginErrMsg').textContent=result.message||'Nama pengguna atau kata sandi salah.'; $('#loginErr').classList.add('show');
    const c=$('.l-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
  }
});

async function logout(){ await fetchAPI('logout'); clearSession(); data=[]; users=[]; dataLoaded=false; $('#viewApp').classList.add('hide'); $('#viewLogin').classList.remove('hide'); $('#loginPass').value=''; $('#loginErr').classList.remove('show'); toast('Anda telah keluar dari sistem.','info'); }
$('#btnLogout').addEventListener('click',logout); $('#menuLogout').addEventListener('click',logout);

async function enterApp(){
  $('#viewLogin').classList.add('hide'); $('#viewApp').classList.remove('hide');
  applyProfile(); configureRoleUI(); showView('dash');
  if(dataLoaded) renderAll(); else { $('#dashHello').textContent='Memuat data…'; await loadDataServer(); }
  $('#dashHello').textContent='Selamat datang, ' + (profil.name || 'Petugas').split(' ')[0];
}
async function restoreSession(){
  const s=readSession(); if(!s?.token||!s?.user?.username) return false;
  const result=await fetchAPI('me');
  if(!result.success){ clearSession(); return false; }
  saveSession(s.token,result.user);
  return true;
}

function applyProfile(){
  const n=profil.name||'Memuat...';
  $('#sbName').textContent=n; $('#topName').textContent=n; $('#sbAva').textContent=initials(n); $('#topAva').textContent=initials(n); $('#setName').value=n;
  $('#roleBadge').textContent=isAdmin()?'Admin':'Petugas';
  $('#roleBadgeTop').textContent=isAdmin()?'Admin':'Petugas';
}
function configureRoleUI(){
  const admin=isAdmin();
  $('#navUsers').classList.toggle('hide',!admin);
  $('#menuUsers').classList.toggle('hide',!admin);
  $('#dDel').classList.toggle('hide',!admin);
  $('#adminHint').classList.toggle('hide',!admin);
  $('#userCount').classList.toggle('hide',!admin);
}
$('#dashDate').textContent=fmtLongDate(new Date());

function showView(v){
  if(v==='users'&&!isAdmin()) return showView('dash');
  state.view=v; $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  $$('.view-pane').forEach(p=>p.classList.toggle('active',p.id==='v'+v.charAt(0).toUpperCase()+v.slice(1)));
  closeSidebar(); window.scrollTo({top:0});
  if(v==='data') renderTable();
  if(v==='users') loadUsers();
}
function goToData(cat='semua'){ state.query=''; state.cat=cat; state.page=1; $('#q').value=''; $('#globalSearch').value=''; $('#fCat').value=cat; showView('data'); }
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>{ const v=b.dataset.view; if(v==='data')goToData(); else showView(v); }));
$('#menuProfile').addEventListener('click',()=>{closeMenu();showView('set');});
$('#menuUsers').addEventListener('click',()=>{closeMenu();showView('users');});
$('#btnSeeAll').addEventListener('click',()=>goToData());
$('#menuNew').addEventListener('click',()=>{closeMenu();openForm(null);});
$('#btnRefreshData').addEventListener('click',async()=>{const btn=$('#btnRefreshData'), old=btn.innerHTML;btn.disabled=true;btn.innerHTML='<i data-lucide="loader-circle" class="spin"></i> Menyegarkan…';icons();await loadDataServer();btn.disabled=false;btn.innerHTML=old;icons();});
$('#hamburger').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#scrim').classList.add('show');});
$('#scrim').addEventListener('click',closeSidebar); function closeSidebar(){$('#sidebar').classList.remove('open');$('#scrim').classList.remove('show');}
$('#btnUserMenu').addEventListener('click',e=>{e.stopPropagation();$('#userMenu').classList.toggle('open');}); document.addEventListener('click',e=>{if(!e.target.closest('#userMenu')&&!e.target.closest('#btnUserMenu'))closeMenu();}); function closeMenu(){$('#userMenu').classList.remove('open');}
$('#globalSearch').addEventListener('input',e=>{state.query=e.target.value;state.page=1;if(state.view!=='data')showView('data');renderTable();});

async function loadDataServer(){
  const result=await fetchAPI('getData');
  if(result.success){data=result.data||[];dataLoaded=true;renderAll();}
  else toast(result.message||'Gagal memuat data arsip.','del');
}

function fillSelect(sel,arr,allLabel){ if(!sel)return; sel.innerHTML=(allLabel?`<option value="semua">${esc(allLabel)}</option>`:'')+arr.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(''); }
fillSelect($('#fKategori'),CATS); fillSelect($('#fCat'),CATS,'Semua Kategori');
function itemYear_(x){ return String(x.tahun || (x.tanggal ? new Date(`${x.tanggal}T00:00:00`).getFullYear() : '') || ''); }
function scopedData(){ return state.year!=='semua'?data.filter(x=>itemYear_(x)===state.year):data; }
function populateYearFilter(){ const years=[...new Set(data.map(itemYear_).filter(Boolean))].sort((a,b)=>b-a); if(state.year!=='semua'&&!years.includes(state.year))state.year='semua'; fillSelect($('#fYear'),years,'Tahun'); $('#fYear').value=state.year; }
$('#fYear').addEventListener('change',e=>{state.year=e.target.value;state.page=1;renderAll();});
function setInvalid(n,on){ const el=document.querySelector(`.field[data-f="${n}"]`); if(el)el.classList.toggle('invalid',on); }

function openForm(id){
  state.editingId=id||null; const edit=!!id; $('#formTitle').textContent=edit?'Ubah Data Arsip':'Arsip Baru'; $('#formSub').textContent=edit?'Perbarui informasi dokumen.':'Lengkapi data dokumen untuk didaftarkan.'; $('#btnSaveTxt').textContent=edit?'Simpan Perubahan':'Simpan Arsip';
  $$('#arsipForm .field').forEach(f=>f.classList.remove('invalid'));
  if(edit){ const r=data.find(x=>String(x.id)===String(id)); if(!r)return; $('#fNomor').value=r.nomor||r.number||''; $('#fJudul').value=r.judul||''; $('#fKategori').value=r.kategori||CATS[0]; $('#fTanggal').value=r.tanggal||''; $('#fKet').value=r.ket||''; $('#fFile').value=''; $('#currentFile').textContent=r.fileName?`Lampiran saat ini: ${r.fileName}`:'Belum ada lampiran.'; }
  else { $('#arsipForm').reset(); $('#fKategori').value=CATS[0]; $('#fTanggal').value=new Date().toISOString().slice(0,10); $('#currentFile').textContent='Belum ada lampiran.'; }
  openModal('#mForm'); setTimeout(()=>$('#fNomor').focus(),280);
}
$('#btnNewDash').addEventListener('click',()=>openForm(null)); $('#btnNewData').addEventListener('click',()=>openForm(null));

function showDuplicatePopup(message){ $('#dupMessage').textContent=message||'Nomor dan tanggal tersebut sudah terdaftar.'; openModal('#mDuplicate'); }
function fileToBase64(file){ return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Gagal membaca file.'));r.readAsDataURL(file);}); }

async function submitForm(){
  const nomor=$('#fNomor').value.trim(), judul=$('#fJudul').value.trim(), tanggal=$('#fTanggal').value, kategori=$('#fKategori').value, ket=$('#fKet').value.trim();
  let ok=true; setInvalid('nomor',!nomor);ok=ok&&!!nomor; setInvalid('judul',!judul);ok=ok&&!!judul; setInvalid('tanggal',!tanggal);ok=ok&&!!tanggal; if(!ok)return;
  const file=$('#fFile').files[0];
  if(file){ if(file.size>MAX_FILE_BYTES){toast('Ukuran file maksimal 15 MB.','del');return;} if(!ALLOWED_FILE_TYPES.has(file.type)){toast('Jenis file tidak diizinkan. Gunakan PDF, gambar, Word, Excel, atau PowerPoint.','del');return;} }
  const btn=$('#btnSave'); btn.disabled=true; btn.innerHTML='<i data-lucide="loader-circle" class="spin"></i> '+(file?'Mengunggah…':'Menyimpan…'); icons();
  try{
    let fileBase64=null,fileName=null,fileType=null; if(file){fileBase64=await fileToBase64(file);fileName=file.name;fileType=file.type;}
    const action=state.editingId?'updateData':'insertData';
    const result=await fetchAPI(action,{id:state.editingId,nomor,judul,kategori,tanggal,ket,fileBase64,fileName,fileType});
    if(result.success){ closeModals(); const wasEditing=!!state.editingId; state.justAdded=result.id||state.editingId; if(result.item){ if(wasEditing){const idx=data.findIndex(x=>String(x.id)===String(state.editingId));if(idx!==-1)data[idx]=result.item;else data.unshift(result.item);}else{data.unshift(result.item);state.page=1;state.sortKey='createdAt';state.sortDir='desc';} } else await loadDataServer(); if(state.view!=='data')showView('data');renderAll();toast(result.message||'Data berhasil disimpan.','ok'); }
    else if(result.code==='DUPLICATE_NUMBER_DATE'){showDuplicatePopup(result.message);}
    else toast(result.message||'Gagal menyimpan data.','del');
  }catch(e){toast(e.message||'Gagal menyimpan data.','del');}
  btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i><span id="btnSaveTxt">'+(state.editingId?'Simpan Perubahan':'Simpan Arsip')+'</span>'; icons();
}
$('#arsipForm').addEventListener('submit',e=>{e.preventDefault();submitForm();}); $('#btnSave').addEventListener('click',submitForm);

async function openPreviewForRecord(r){
  $('#pvTitle').textContent=r.fileName||'Pratinjau File'; $('#pvOpenTab').href='#'; $('#pvFrame').style.display='none'; $('#pvFallback').style.display='flex'; $('#pvLoading').classList.remove('hide'); $('#pvError').classList.add('hide'); openModal('#mPreview');
  const result=await fetchAPI('getFileUrl',{id:r.id});
  $('#pvLoading').classList.add('hide');
  if(!result.success){$('#pvError').textContent=result.message||'Pratinjau tidak tersedia.';$('#pvError').classList.remove('hide');return;}
  $('#pvOpenTab').href=result.url;
  const ext=String(result.name||r.fileName||'').toLowerCase().split('.').pop();
  const inline=ext==='pdf'||['jpg','jpeg','png','webp','gif'].includes(ext);
  if(inline){$('#pvFallback').style.display='none'; $('#pvFrame').src=result.url; $('#pvFrame').style.display='block';}
  else {$('#pvError').textContent='File ini tidak mendukung pratinjau langsung di browser. Gunakan tombol “Buka di Tab Baru”.';$('#pvError').classList.remove('hide');}
}

function openDetail(id){
  const r=data.find(x=>String(x.id)===String(id));if(!r)return;state.detailId=id;
  $('#dAva').style.cssText=avStyle(r.kategori)+';width:48px;height:48px;border-radius:13px;font-size:14px'; $('#dAva').textContent=initials(r.judul); $('#dNomor').textContent=r.nomor||r.number||'—'; $('#dNomor2').textContent=r.nomor||r.number||'—'; $('#dJudul').textContent=r.judul||'—'; $('#dKategori').textContent=r.kategori||'—'; $('#dTanggal').textContent=fmtDate(r.tanggal); $('#dDaftar').textContent=fmtDate(r.createdAt); $('#dKet').textContent=r.ket||'Tidak ada keterangan.';
  const file=r.fileName||r.filePath||r.fileUrl; $('#dFileWrapper').style.display=file?'block':'none'; if(file){$('#dFileLink').innerHTML='';const box=document.createElement('div');box.className='file-actions';const b=document.createElement('button');b.type='button';b.className='btn btn-ghost btn-sm';b.innerHTML='<i data-lucide="eye"></i>Pratinjau';const a=document.createElement('span');a.className='cell-muted';a.textContent=r.fileName||'Lampiran tersedia';b.addEventListener('click',()=>openPreviewForRecord(r));box.append(b,a);$('#dFileLink').append(box);icons();}
  $('#dEdit').classList.toggle('hide',!r); $('#dDel').classList.toggle('hide',!isAdmin()); openModal('#mDetail');
}
$('#dEdit').addEventListener('click',()=>{const id=state.detailId;closeModals();setTimeout(()=>openForm(id),200);}); $('#dDel').addEventListener('click',()=>{if(!isAdmin())return;const id=state.detailId;closeModals();setTimeout(()=>openConfirm(id),200);});
function openConfirm(id){ if(!isAdmin())return;const r=data.find(x=>String(x.id)===String(id));if(!r)return;state.confirmId=id;$('#cAva').style.cssText=avStyle(r.kategori);$('#cAva').textContent=initials(r.judul);$('#cNomor').textContent=r.nomor||r.number||'—';$('#cJudul').textContent=r.judul;openModal('#mConfirm'); }
async function yesDelete(){const id=state.confirmId,btn=$('#cYes');if(!id||!isAdmin())return;btn.disabled=true;btn.innerHTML='<i data-lucide="loader-circle" class="spin"></i> Menghapus…';icons();const result=await fetchAPI('deleteData',{id});btn.disabled=false;btn.innerHTML='<i data-lucide="trash-2"></i>Ya, Hapus';icons();if(result.success){closeModals();data=data.filter(x=>String(x.id)!==String(id));renderAll();toast(result.message||'Arsip berhasil dihapus.','del');}else toast(result.message||'Gagal menghapus data.','del');}
$('#cYes').addEventListener('click',yesDelete);

function renderStats(){ const d=scopedData(); $('#stTotal').textContent=d.length;$('#sbCount').textContent=d.length;$('#stKeluar').textContent=d.filter(x=>x.kategori==='Surat Keluar').length;$('#stMasuk').textContent=d.filter(x=>x.kategori==='Surat Masuk').length;$('#stSkBa').textContent=d.filter(x=>x.kategori==='SK dan BA').length;$('#stPerencanaan').textContent=d.filter(x=>x.kategori==='Perencanaan').length;const now=Date.now(),w=7*864e5,baru=d.filter(x=>new Date(x.createdAt).getTime()>=now-w).length;$('#trTotal').textContent='+'+baru+' pekan ini'; }
const CAT_STAT_MAP_={stKeluar:'Surat Keluar',stMasuk:'Surat Masuk',stSkBa:'SK dan BA',stPerencanaan:'Perencanaan'};Object.entries(CAT_STAT_MAP_).forEach(([id,cat])=>{$('#'+id).closest('.card.stat').addEventListener('click',()=>goToData(cat));});
function renderActivity(){const d=scopedData(),days=[],today=new Date();today.setHours(0,0,0,0);for(let i=6;i>=0;i--){const dt=new Date(today.getTime()-i*864e5),next=dt.getTime()+864e5,n=d.filter(x=>{const t=new Date(x.createdAt).getTime();return t>=dt.getTime()&&t<next;}).length;days.push({label:fmtDay(dt),n});}const max=Math.max(1,...days.map(x=>x.n)),total=days.reduce((s,x)=>s+x.n,0);$('#actTotal').textContent=total+' pendaftaran';$('#actBars').innerHTML=days.map(x=>`<div class="b"><div class="fill${x.n===max&&x.n>0?' hot':''}" style="height:${Math.max(5,Math.round(x.n/max*100))}%" data-tip="${x.n} arsip"></div><span class="d">${x.label}</span></div>`).join('');}
function renderCats(){const d=scopedData(),counts=CATS.map(c=>({c,n:d.filter(x=>x.kategori===c).length})).sort((a,b)=>b.n-a.n),max=Math.max(1,...counts.map(x=>x.n));$('#catBox').innerHTML=counts.map(x=>`<div class="cat"><span class="n">${esc(x.c)}</span><span class="tr"><span class="fl" data-w="${Math.round(x.n/max*100)}"></span></span><span class="v">${x.n}</span></div>`).join('');requestAnimationFrame(()=>requestAnimationFrame(()=>$$('.cat .fl').forEach(f=>f.style.width=f.dataset.w+'%')));}
function renderRecent(){const rows=[...scopedData()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5);$('#recentBody').innerHTML=rows.length?rows.map(r=>`<tr data-id="${esc(r.id)}"><td class="mono number-cell">${esc(r.nomor||r.number||'—')}</td><td><div class="cell-doc"><span class="avatar av" style="${avStyle(r.kategori)}">${initials(r.judul)}</span><div><b>${esc(r.judul)}</b><span>${esc(r.ket||'-')}</span></div></div></td><td><span class="chip">${esc(r.kategori)}</span></td><td class="cell-muted">${esc(fmtDate(r.tanggal))}</td><td class="c-act"><button class="icon-btn" data-act="view" title="Detail"><i data-lucide="eye"></i></button></td></tr>`).join(''):`<tr><td colspan="5"><div class="empty"><div class="ico"><i data-lucide="inbox"></i></div><h4>Belum ada arsip</h4><p>Daftarkan dokumen pertama Anda.</p><button class="btn btn-primary" id="emptyNewArchive"><i data-lucide="plus"></i>Arsip Baru</button></div></td></tr>`;icons();$('#emptyNewArchive')?.addEventListener('click',()=>openForm(null));}
function filtered(){let rows=[...scopedData()],q=state.query.trim().toLowerCase();if(q)rows=rows.filter(r=>[r.nomor,r.number,r.judul,r.ket,r.kategori].some(v=>String(v||'').toLowerCase().includes(q)));if(state.cat!=='semua')rows=rows.filter(r=>r.kategori===state.cat);const k=state.sortKey,dir=state.sortDir==='asc'?1:-1;rows.sort((a,b)=>String(a[k]??'').localeCompare(String(b[k]??''),'id',{sensitivity:'base',numeric:k==='tanggal'} )*dir);return rows;}
function renderTable(){const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/PER_PAGE));state.page=Math.min(state.page,pages);const start=(state.page-1)*PER_PAGE,pageRows=rows.slice(start,start+PER_PAGE),q=state.query.trim();$('#countInfo').textContent=rows.length?`Menampilkan ${start+1}–${start+pageRows.length} dari ${rows.length} arsip`:'Tidak ada arsip yang cocok';const tb=$('#tbody');if(!pageRows.length){tb.innerHTML='<tr><td colspan="5"><div class="empty"><div class="ico"><i data-lucide="search-x"></i></div><h4>Tidak ditemukan</h4><p>Coba ubah kata kunci atau saringan.</p></div></td></tr>';}else{tb.innerHTML=pageRows.map(r=>`<tr data-id="${esc(r.id)}"><td class="mono number-cell">${highlight(esc(r.nomor||r.number||'—'),q)}</td><td><div class="cell-doc"><span class="avatar av" style="${avStyle(r.kategori)}">${initials(r.judul)}</span><div><b>${highlight(esc(r.judul),q)}</b><span>${highlight(esc(r.ket||'-'),q)}</span></div></div></td><td><span class="chip">${highlight(esc(r.kategori),q)}</span></td><td class="cell-muted">${esc(fmtDate(r.tanggal))}</td><td class="c-act"><button class="icon-btn" data-act="view" title="Detail"><i data-lucide="eye"></i></button><button class="icon-btn" data-act="edit" title="Ubah"><i data-lucide="pencil"></i></button>${isAdmin()?'<button class="icon-btn del" data-act="del" title="Hapus"><i data-lucide="trash-2"></i></button>':''}</td></tr>`).join('');}icons();$('#pageInfo').textContent=state.page+' / '+pages;$('#pPrev').disabled=state.page<=1;$('#pNext').disabled=state.page>=pages;$$('th.sortable').forEach(th=>{th.classList.remove('sort-asc','sort-desc');if(th.dataset.sort===state.sortKey)th.classList.add(state.sortDir==='asc'?'sort-asc':'sort-desc');});}
['#tbody','#recentBody'].forEach(sel=>$(sel).addEventListener('click',e=>{const btn=e.target.closest('button[data-act]'),tr=e.target.closest('tr[data-id]');if(!tr)return;const id=tr.dataset.id;if(btn){e.stopPropagation();if(btn.dataset.act==='view')openDetail(id);if(btn.dataset.act==='edit')openForm(id);if(btn.dataset.act==='del')openConfirm(id);}else openDetail(id);}));
$('#thead').addEventListener('click',e=>{const b=e.target.closest('button.th-in');if(!b)return;const k=b.dataset.sort;if(state.sortKey===k)state.sortDir=state.sortDir==='asc'?'desc':'asc';else{state.sortKey=k;state.sortDir='asc';}renderTable();});
$('#q').addEventListener('input',e=>{state.query=e.target.value;$('#globalSearch').value=state.query;state.page=1;renderTable();});$('#fCat').addEventListener('change',e=>{state.cat=e.target.value;state.page=1;renderTable();});$('#pPrev').addEventListener('click',()=>{if(state.page>1){state.page--;renderTable();}});$('#pNext').addEventListener('click',()=>{state.page++;renderTable();});

$('#btnSaveName').addEventListener('click',async()=>{const n=$('#setName').value.trim();if(!n){toast('Nama tampilan tidak boleh kosong.','del');return;}const btn=$('#btnSaveName'),old=btn.innerHTML;btn.disabled=true;btn.innerHTML='<i data-lucide="loader-circle" class="spin"></i> Menyimpan…';icons();const result=await fetchAPI('updateProfile',{name:n});btn.disabled=false;btn.innerHTML=old;icons();if(result.success){saveSession(readSession().token,result.user);applyProfile();$('#dashHello').textContent='Selamat datang, '+n.split(' ')[0];toast(result.message||'Profil berhasil diperbarui.','ok');}else toast(result.message||'Gagal mengubah profil.','del');});
$('#btnSavePass').addEventListener('click',async()=>{const old=$('#oldP').value,nw=$('#newP').value,nw2=$('#newP2').value;if(!old){toast('Kata sandi saat ini wajib diisi.','del');return;}if(nw.length<6){toast('Kata sandi baru minimal 6 karakter.','del');return;}if(nw!==nw2){toast('Konfirmasi kata sandi tidak cocok.','del');return;}const btn=$('#btnSavePass'),oldHtml=btn.innerHTML;btn.disabled=true;btn.innerHTML='<i data-lucide="loader-circle" class="spin"></i> Memproses…';icons();const result=await fetchAPI('updatePassword',{oldPass:old,newPass:nw});btn.disabled=false;btn.innerHTML=oldHtml;icons();if(result.success){$('#oldP').value=$('#newP').value=$('#newP2').value='';toast(result.message||'Kata sandi berhasil diubah.','ok');}else toast(result.message||'Gagal mengubah kata sandi.','del');});

async function loadUsers(){ if(!isAdmin())return; const result=await fetchAPI('listUsers'); if(result.success){users=result.users||[];renderUsers();}else toast(result.message||'Gagal memuat daftar user.','del'); }
function renderUsers(){
  const tb=$('#usersBody'); $('#usersCount').textContent=users.length+' user'; $('#userCount').textContent=users.length;
  if(!users.length){tb.innerHTML='<tr><td colspan="4"><div class="empty"><div class="ico"><i data-lucide="users"></i></div><h4>Belum ada user</h4></div></td></tr>';icons();return;}
  tb.innerHTML=users.map(u=>`<tr><td><div class="cell-doc"><span class="avatar av" style="${avStyle(u.username)}">${initials(u.name)}</span><div><b>${esc(u.name)}</b><span>@${esc(u.username)}</span></div></div></td><td><span class="role-chip ${u.role==='admin'?'admin':''}">${u.role==='admin'?'Admin':'User'}</span></td><td class="cell-muted">${u.username===profil.username?'Akun Anda':'—'}</td><td class="c-act"><button class="icon-btn" data-reset-user="${esc(u.username)}" title="Reset password"><i data-lucide="key-round"></i></button></td></tr>`).join('');icons();
  $$('#usersBody [data-reset-user]').forEach(b=>b.addEventListener('click',()=>openResetPass(b.dataset.resetUser)));
}
$('#btnNewUser').addEventListener('click',openUserForm);
function openUserForm(){ $('#userForm').reset();$('#ufRole').value='user';openModal('#mUserForm');setTimeout(()=>$('#ufUsername').focus(),250); }
$('#userForm').addEventListener('submit',async e=>{e.preventDefault();const username=$('#ufUsername').value.trim(),name=$('#ufName').value.trim(),password=$('#ufPassword').value,role=$('#ufRole').value;if(!username||!name||password.length<6){toast('Username, nama, dan kata sandi minimal 6 karakter wajib diisi.','del');return;}const btn=$('#btnCreateUser');btn.disabled=true;btn.textContent='Menyimpan…';const result=await fetchAPI('createUser',{username,name,password,role});btn.disabled=false;btn.textContent='Buat User';if(result.success){closeModals();await loadUsers();toast(result.message||'User baru berhasil dibuat.','ok');}else toast(result.message||'Gagal membuat user.','del');});
function openResetPass(username){state.resetUsername=username;$('#resetUserLabel').textContent='@'+username;$('#resetForm').reset();openModal('#mResetPass');setTimeout(()=>$('#rpPassword').focus(),250);}
$('#resetForm').addEventListener('submit',async e=>{e.preventDefault();const username=state.resetUsername,password=$('#rpPassword').value,confirm=$('#rpPassword2').value;if(password.length<6){toast('Kata sandi minimal 6 karakter.','del');return;}if(password!==confirm){toast('Konfirmasi kata sandi tidak cocok.','del');return;}const btn=$('#btnResetPass');btn.disabled=true;btn.textContent='Menyimpan…';const result=await fetchAPI('resetUserPassword',{username,newPassword:password});btn.disabled=false;btn.textContent='Simpan Password';if(result.success){closeModals();toast(result.message||'Kata sandi berhasil diubah.','ok');}else toast(result.message||'Gagal mengubah kata sandi.','del');});

function renderNotif(){ $('#notifBody').innerHTML='<div class="empty" style="padding:36px 12px"><div class="ico"><i data-lucide="bell-off"></i></div><h4>Tidak ada notifikasi</h4><p>Sistem akan menampilkan pemberitahuan penting di sini.</p></div>';icons(); }
$('#btnNotif').addEventListener('click',()=>{renderNotif();openModal('#mNotif');});
function renderAll(){populateYearFilter();renderStats();renderActivity();renderCats();renderRecent();renderTable();}

(async function init(){
  $('#dashDate').textContent=fmtLongDate(new Date());
  icons();
  const ok=await restoreSession();
  if(ok){enterApp();}else{$('#viewLogin').classList.remove('hide');$('#viewApp').classList.add('hide');}
})();
