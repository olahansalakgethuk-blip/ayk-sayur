import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";

const ADMIN_PUSAT_UID = "3109dc75-7519-4d32-a201-fd9007b4fc90";

const supabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const json = (res, status, body) => {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
  if (required.some((key) => !process.env[key])) {
    return json(res, 500, { error: "Konfigurasi server LIVE belum lengkap." });
  }

  try {
    const { action, role, password, username, branchId, identity: requestedIdentity } = req.body || {};
    const db = supabase();

    // Daftar dan tonton LIVE tetap bisa diakses pembeli tanpa login.
    if (action === "list") {
      const { data, error } = await db.from("live_streams")
        .select("identity,nama,role,room,started_at")
        .eq("aktif", true)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return json(res, 200, { streams: data || [] });
    }

    if (action === "join") {
      const { data, error } = await db.from("live_streams")
        .select("identity,nama,room")
        .eq("identity", String(requestedIdentity || ""))
        .eq("aktif", true)
        .maybeSingle();
      if (error || !data) return json(res, 404, { error: "Siaran sudah berakhir atau tidak ditemukan." });

      const viewer = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
        identity: "viewer-" + Date.now(),
        name: "Pembeli",
        ttl: "2h"
      });
      // Izin bicara tetap aktif; hilangkan canPublishSources string yang memicu error TrackSource.
      viewer.addGrant({ roomJoin: true, room: data.room, canPublish: true, canSubscribe: true });
      return json(res, 200, { token: await viewer.toJwt(), url: process.env.LIVEKIT_URL, room: data.room, name: data.nama });
    }

    let identity = "";
    let displayName = "";
    let room = "";

    if (role === "admin-pusat" || role === "admin-cabang") {
      const authHeader = String(req.headers.authorization || "");
      const accessToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!accessToken) return json(res, 401, { error: "Sesi Admin tidak ditemukan. Silakan login kembali." });

      const { data: authData, error: authError } = await db.auth.getUser(accessToken);
      if (authError || !authData?.user) return json(res, 401, { error: "Sesi Supabase tidak valid atau sudah berakhir." });

      if (role === "admin-pusat") {
        if (authData.user.id !== ADMIN_PUSAT_UID) return json(res, 403, { error: "Akun ini bukan Admin Pusat." });
        identity = "admin-pusat";
        displayName = "Admin Pusat";
        room = "ayk-live-admin-pusat";
      } else {
        if (typeof branchId !== "string" || !branchId || branchId.length > 100) {
          return json(res, 400, { error: "Cabang belum dipilih." });
        }
        const { data: access, error: accessError } = await db.from("admin_cabang_auth")
          .select("cabang_id,aktif")
          .eq("user_id", authData.user.id)
          .eq("aktif", true)
          .maybeSingle();
        if (accessError || !access || String(access.cabang_id) !== String(branchId)) {
          return json(res, 403, { error: "Akun ini tidak memiliki akses ke cabang tersebut." });
        }
        identity = "admin-cabang-" + String(branchId).replace(/[^a-zA-Z0-9_-]/g, "-");
        displayName = "Admin Cabang";
        room = "ayk-live-" + identity;
      }
    } else if (role === "keliling") {
      if (typeof username !== "string" || !username || username.length > 100 || typeof password !== "string" || !password || password.length > 256) {
        return json(res, 400, { error: "Username dan password Penjual Keliling wajib diisi." });
      }
      const { data, error } = await db.from("penjual_keliling")
        .select("id,nama,username,password,aktif")
        .ilike("username", username)
        .maybeSingle();
      if (error) {
        console.error("AYK LIVE seller lookup error:", error);
        return json(res, 500, { error: "Gagal membaca data Penjual Keliling dari database." });
      }
      if (!data || data.aktif !== true || String(data.password) !== password) {
        return json(res, 401, { error: "Login Penjual Keliling tidak valid atau akun tidak aktif." });
      }
      identity = "penjual-keliling-" + String(data.id).replace(/[^a-zA-Z0-9_-]/g, "-");
      displayName = String(data.nama || "Penjual Keliling").slice(0, 80);
      room = "ayk-live-" + identity;
    } else {
      return json(res, 400, { error: "Jenis akun tidak diizinkan untuk LIVE." });
    }

    if (action === "stop") {
      const { error } = await db.from("live_streams").update({ aktif: false }).eq("identity", identity);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }
    if (action !== "start") return json(res, 400, { error: "Perintah LIVE tidak dikenal." });

    const { error: saveError } = await db.from("live_streams").upsert({
      identity, nama: displayName, role, room, aktif: true, started_at: new Date().toISOString()
    }, { onConflict: "identity" });
    if (saveError) throw saveError;

    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity, name: displayName, ttl: "2h"
    });
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    return json(res, 200, { token: await token.toJwt(), url: process.env.LIVEKIT_URL, room, identity, name: displayName });
  } catch (error) {
    console.error("AYK LIVE token error:", error);
    return json(res, 500, { error: "Server gagal menyiapkan LIVE.", detail: error?.message || String(error) });
  }
}
