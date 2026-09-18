import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SESSION_HOURS = 8;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const ALLOWED_CATS = new Set(['Surat Masuk', 'Surat Keluar', 'SK dan BA', 'Perencanaan']);
const ALLOWED_ROLES = new Set(['user', 'admin']);

function getServiceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys);
    if (parsed?.default) return parsed.default;
  }
  throw new Error('Service key tidak ditemukan di environment.');
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceKey(),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function fail(message: string, status = 400, code?: string) {
  return json({ success: false, message, ...(code ? { code } : {}) }, status);
}

function cleanText(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

function validateCategory(value: unknown): string | null {
  const v = cleanText(value, 40);
  return ALLOWED_CATS.has(v) ? v : null;
}

function validateDate(value: unknown): string | null {
  const v = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function validatePassword(value: unknown): string | null {
  const v = String(value ?? '');
  return v.length >= 6 && v.length <= 128 ? v : null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function newSession(username: string) {
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('app_sessions').insert({
    token_hash: tokenHash,
    username,
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  return { token, expiresAt };
}

async function revokeSession(token: string | null) {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await supabase.from('app_sessions').delete().eq('token_hash', tokenHash);
}

async function requireSession(req: Request) {
  const token = req.headers.get('x-session-token');
  if (!token) return { error: fail('Sesi tidak ditemukan. Silakan masuk kembali.', 401, 'UNAUTHORIZED') };
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase
    .from('app_sessions')
    .select('token_hash, username, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (error || !data) return { error: fail('Sesi sudah berakhir. Silakan masuk kembali.', 401, 'SESSION_EXPIRED') };

  const { data: user, error: userErr } = await supabase
    .from('akun')
    .select('username,nama,role')
    .eq('username', data.username)
    .limit(1)
    .maybeSingle();
  if (userErr || !user) return { error: fail('Akun tidak ditemukan. Silakan masuk kembali.', 401, 'SESSION_EXPIRED') };

  await supabase.from('app_sessions').update({ last_seen_at: new Date().toISOString() }).eq('token_hash', tokenHash);
  return { token, user: { username: user.username, name: user.nama || user.username, role: user.role === 'admin' ? 'admin' : 'user' } };
}

function requireAdmin(auth: { user?: { role: string }, error?: Response }) {
  if (auth.error) return auth.error;
  if (!auth.user || auth.user.role !== 'admin') return fail('Aksi ini hanya dapat dilakukan oleh admin.', 403, 'FORBIDDEN');
  return null;
}

async function saveFileToStorage(fileBase64: string, fileType: string, fileName: string) {
  if (!ALLOWED_FILE_TYPES.has(fileType)) throw new Error('Jenis file tidak diizinkan.');
  const base64Data = fileBase64.split(',')[1] || fileBase64;
  const raw = atob(base64Data);
  if (raw.length > MAX_FILE_BYTES) throw new Error(`Ukuran file maksimal ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const safeName = fileName.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160) || 'lampiran';
  const path = `${crypto.randomUUID()}_${safeName}`;
  const { error: upErr } = await supabase.storage.from('lampiran').upload(path, bytes, {
    contentType: fileType,
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);
  return { name: safeName, path };
}

async function deleteFileFromStorage(path: string | null | undefined) {
  if (!path) return;
  const { error } = await supabase.storage.from('lampiran').remove([path]);
  if (error) console.error('Gagal hapus file lampiran:', error.message);
}

async function signedFileUrl(path: string) {
  const { data, error } = await supabase.storage.from('lampiran').createSignedUrl(path, 15 * 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

function duplicateMessage(nomor: string, tanggal: string) {
  return `Nomor arsip “${nomor}” pada tanggal ${tanggal} sudah terdaftar. Gunakan nomor atau tanggal yang berbeda.`;
}

async function assertUniqueArchive(nomor: string, tanggal: string, excludeId?: string) {
  let q = supabase.from('arsip').select('id,judul,nomor,tanggal').eq('nomor', nomor).eq('tanggal', tanggal).limit(1);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function normalizeArchiveRow(row: any) {
  return {
    ...row,
    nomor: row.nomor ?? row.number ?? '',
    fileUrl: '',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = await req.json();
    const action = cleanText(payload.action, 50);

    if (action === 'login') {
      const username = cleanText(payload.username, 80);
      const password = String(payload.password ?? '');
      if (!username || !password) return fail('Nama pengguna dan kata sandi wajib diisi.');

      const { data: rows, error } = await supabase.rpc('app_login', {
        p_username: username,
        p_password: password,
      });
      if (error) return fail(error.message, 400, 'LOGIN_ERROR');
      if (!rows || rows.length === 0) return fail('Nama pengguna atau kata sandi salah.', 401, 'LOGIN_FAILED');

      const u = rows[0];
      const session = await newSession(u.username);
      const { data: arsip, error: dataErr } = await supabase.from('arsip').select('*').order('createdAt', { ascending: false });
      if (dataErr) { await revokeSession(session.token); return fail(dataErr.message, 500); }
      return json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: { name: u.nama || u.username, username: u.username, role: u.role === 'admin' ? 'admin' : 'user' },
        data: (arsip || []).map(normalizeArchiveRow),
      });
    }

    if (action === 'logout') {
      await revokeSession(req.headers.get('x-session-token'));
      return json({ success: true });
    }

    if (action === 'me') {
      const auth = await requireSession(req);
      if (auth.error) return auth.error;
      return json({ success: true, user: auth.user });
    }

    const auth = await requireSession(req);
    if (auth.error) return auth.error;

    if (action === 'getData') {
      const { data: arsip, error } = await supabase.from('arsip').select('*').order('createdAt', { ascending: false });
      return error ? fail(error.message, 500) : json({ success: true, data: (arsip || []).map(normalizeArchiveRow) });
    }

    if (action === 'getFileUrl') {
      const id = cleanText(payload.id, 100);
      if (!id) return fail('ID arsip tidak valid.');
      const { data: row, error } = await supabase.from('arsip').select('filePath,fileUrl,fileName').eq('id', id).limit(1).maybeSingle();
      if (error) return fail(error.message, 500);
      if (!row) return fail('Arsip tidak ditemukan.', 404);
      if (row.filePath) return json({ success: true, url: await signedFileUrl(row.filePath), name: row.fileName || 'Lampiran' });
      if (row.fileUrl && !String(row.fileUrl).startsWith('GAGAL_UPLOAD')) return json({ success: true, url: row.fileUrl, name: row.fileName || 'Lampiran' });
      return fail('Lampiran tidak tersedia.', 404);
    }

    if (action === 'insertData') {
      const nomor = cleanText(payload.nomor, 120);
      const judul = cleanText(payload.judul, 120);
      const kategori = validateCategory(payload.kategori);
      const tanggal = validateDate(payload.tanggal);
      const ket = cleanText(payload.ket, 240);
      if (!nomor) return fail('Nomor arsip wajib diisi.');
      if (!judul) return fail('Judul dokumen wajib diisi.');
      if (!kategori) return fail('Kategori tidak valid.');
      if (!tanggal) return fail('Tanggal dokumen tidak valid.');

      const duplicate = await assertUniqueArchive(nomor, tanggal);
      if (duplicate) return fail(duplicateMessage(nomor, tanggal), 409, 'DUPLICATE_NUMBER_DATE');

      let uploadedFile: { name: string; path: string } | null = null;
      if (payload.fileBase64 && payload.fileName && payload.fileType) {
        try {
          uploadedFile = await saveFileToStorage(String(payload.fileBase64), String(payload.fileType), String(payload.fileName));
        } catch (e) {
          return fail((e as Error).message, 400, 'UPLOAD_FAILED');
        }
      }

      const year = new Date(`${tanggal}T00:00:00`).getFullYear();
      const newId = crypto.randomUUID();
      const newItem = {
        id: newId,
        nomor,
        // Tetap isi legacy field agar data lama/komponen lama tetap kompatibel.
        number: nomor,
        judul,
        kategori,
        status: 'Aktif',
        tanggal,
        tahun: String(year),
        lokasi: '',
        ket,
        fileUrl: '',
        fileName: uploadedFile?.name || '',
        filePath: uploadedFile?.path || '',
        createdAt: new Date().toISOString(),
      };

      const { error } = await supabase.from('arsip').insert(newItem);
      if (error) {
        await deleteFileFromStorage(uploadedFile?.path);
        if (error.code === '23505') return fail(duplicateMessage(nomor, tanggal), 409, 'DUPLICATE_NUMBER_DATE');
        return fail(error.message, 400);
      }
      return json({ success: true, id: newId, item: normalizeArchiveRow(newItem), message: 'Arsip berhasil didaftarkan ke database.' });
    }

    if (action === 'updateData') {
      const id = cleanText(payload.id, 100);
      if (!id) return fail('ID arsip tidak valid.');
      const { data: existing, error: existingErr } = await supabase.from('arsip').select('*').eq('id', id).limit(1).maybeSingle();
      if (existingErr) return fail(existingErr.message, 500);
      if (!existing) return fail('Data arsip tidak ditemukan.', 404);

      const nomor = cleanText(payload.nomor, 120);
      const judul = cleanText(payload.judul, 120);
      const kategori = validateCategory(payload.kategori);
      const tanggal = validateDate(payload.tanggal);
      const ket = cleanText(payload.ket, 240);
      if (!nomor) return fail('Nomor arsip wajib diisi.');
      if (!judul) return fail('Judul dokumen wajib diisi.');
      if (!kategori) return fail('Kategori tidak valid.');
      if (!tanggal) return fail('Tanggal dokumen tidak valid.');

      const duplicate = await assertUniqueArchive(nomor, tanggal, id);
      if (duplicate) return fail(duplicateMessage(nomor, tanggal), 409, 'DUPLICATE_NUMBER_DATE');

      let uploadedFile: { name: string; path: string } | null = null;
      if (payload.fileBase64 && payload.fileName && payload.fileType) {
        try {
          uploadedFile = await saveFileToStorage(String(payload.fileBase64), String(payload.fileType), String(payload.fileName));
        } catch (e) {
          return fail((e as Error).message, 400, 'UPLOAD_FAILED');
        }
      }

      const year = new Date(`${tanggal}T00:00:00`).getFullYear();
      const updates: any = {
        nomor,
        number: nomor,
        judul,
        kategori,
        tanggal,
        tahun: String(year),
        ket,
      };
      if (uploadedFile) {
        updates.fileName = uploadedFile.name;
        updates.filePath = uploadedFile.path;
        updates.fileUrl = '';
      }

      const { error } = await supabase.from('arsip').update(updates).eq('id', id);
      if (error) {
        await deleteFileFromStorage(uploadedFile?.path);
        if (error.code === '23505') return fail(duplicateMessage(nomor, tanggal), 409, 'DUPLICATE_NUMBER_DATE');
        return fail(error.message, 400);
      }

      if (uploadedFile && existing.filePath) await deleteFileFromStorage(existing.filePath);
      return json({ success: true, item: normalizeArchiveRow({ ...existing, ...updates }), message: 'Perubahan arsip berhasil disimpan.' });
    }

    if (action === 'deleteData') {
      const adminError = requireAdmin(auth);
      if (adminError) return adminError;
      const id = cleanText(payload.id, 100);
      if (!id) return fail('ID arsip tidak valid.');
      const { data: deleted, error } = await supabase.from('arsip').delete().eq('id', id).select().limit(1);
      if (error) return fail(error.message, 400);
      if (!deleted || deleted.length === 0) return fail('Data arsip tidak ditemukan.', 404);
      await deleteFileFromStorage(deleted[0].filePath);
      return json({ success: true, message: 'Arsip berhasil dihapus.' });
    }

    if (action === 'updateProfile') {
      const name = cleanText(payload.name, 30);
      if (!name) return fail('Nama tampilan tidak boleh kosong.');
      const { error } = await supabase.from('akun').update({ nama: name }).eq('username', auth.user!.username);
      return error ? fail(error.message, 400) : json({ success: true, user: { ...auth.user, name }, message: 'Profil berhasil diperbarui.' });
    }

    if (action === 'updatePassword') {
      const oldPass = String(payload.oldPass ?? '');
      const newPass = validatePassword(payload.newPass);
      if (!oldPass || !newPass) return fail('Kata sandi tidak valid. Minimal 6 karakter.');
      const { data: current, error: verifyErr } = await supabase.rpc('app_login', { p_username: auth.user!.username, p_password: oldPass });
      if (verifyErr) return fail(verifyErr.message, 400);
      if (!current || current.length === 0) return fail('Kata sandi saat ini salah.', 401, 'WRONG_PASSWORD');
      const { error } = await supabase.rpc('app_change_password', { p_username: auth.user!.username, p_new_password: newPass });
      if (error) return fail(error.message, 400);
      await supabase.from('app_sessions').delete().eq('username', auth.user!.username).neq('token_hash', await sha256Hex(String(auth.token)));
      return json({ success: true, message: 'Kata sandi berhasil diubah. Sesi lain telah dikeluarkan.' });
    }

    if (action === 'listUsers') {
      const adminError = requireAdmin(auth);
      if (adminError) return adminError;
      const { data: users, error } = await supabase.from('akun').select('username,nama,role').order('username', { ascending: true });
      return error ? fail(error.message, 500) : json({ success: true, users: (users || []).map(u => ({ username: u.username, name: u.nama || u.username, role: u.role === 'admin' ? 'admin' : 'user' })) });
    }

    if (action === 'createUser') {
      const adminError = requireAdmin(auth);
      if (adminError) return adminError;
      const username = cleanText(payload.username, 80);
      const name = cleanText(payload.name, 80);
      const password = validatePassword(payload.password);
      const role = ALLOWED_ROLES.has(payload.role) ? payload.role : 'user';
      if (!username || !name || !password) return fail('Username, nama, dan kata sandi wajib diisi.');
      if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) return fail('Username hanya boleh berisi huruf, angka, titik, garis bawah, dan tanda minus.');
      const { data: created, error } = await supabase.rpc('app_admin_create_user', { p_username: username, p_name: name, p_new_password: password, p_role: role });
      if (error) return fail(error.message, 400, error.code === '23505' ? 'USERNAME_EXISTS' : undefined);
      return json({ success: true, user: created?.[0] || { username, name, role }, message: 'User baru berhasil dibuat.' });
    }

    if (action === 'resetUserPassword') {
      const adminError = requireAdmin(auth);
      if (adminError) return adminError;
      const username = cleanText(payload.username, 80);
      const password = validatePassword(payload.newPassword);
      if (!username || !password) return fail('Username dan kata sandi baru wajib diisi.');
      const { data: ok, error } = await supabase.rpc('app_admin_change_password', { p_username: username, p_new_password: password });
      if (error) return fail(error.message, 400);
      if (!ok) return fail('User tidak ditemukan.', 404);
      const targetTokenHash = await sha256Hex(String(auth.token));
      if (username === auth.user!.username) {
        await supabase.from('app_sessions').delete().eq('username', username).neq('token_hash', targetTokenHash);
      } else {
        await supabase.from('app_sessions').delete().eq('username', username);
      }
      return json({ success: true, message: `Kata sandi user ${username} berhasil diubah. Sesi lama user tersebut telah dikeluarkan.` });
    }

    return fail('Aksi tidak dikenali.');
  } catch (err) {
    console.error(err);
    return fail((err as Error).message || 'Terjadi kesalahan pada server.', 500);
  }
});
