import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";

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
    const { role, password, username, branchId } = req.body || {};
    if (typeof password !== "string" || !password || password.length > 256) {
      return json(res, 400, { error: "Data login tidak lengkap." });
    }

    const db = supabase();
    let identity = "";
    let displayName = "";
    let room = "";

    if (role === "admin-pusat") {
      const { data, error } = await db
        .from("pengaturan_admin")
        .select("password")
        .eq("id", 1)
        .single();
      if (error || !data || String(data.password) !== password) {
        return json(res, 401, { error: "Login Admin Pusat tidak valid." });
      }
      identity = "admin-pusat";
      displayName = "Admin Pusat";
      room = "ayk-live-admin-pusat";
    } else if (role === "admin-cabang") {
      if (typeof branchId !== "string" || !branchId || branchId.length > 100) {
        return json(res, 400, { error: "Cabang belum dipilih." });
      }
      const { data, error } = await db
        .from("admin_cabang")
        .select("cabang_id,password")
        .eq("cabang_id", branchId)
        .maybeSingle();
      if (error || !data || String(data.password) !== password) {
        return json(res, 401, { error: "Login Admin Cabang tidak valid." });
      }
      identity = "admin-cabang-" + branchId.replace(/[^a-zA-Z0-9_-]/g, "-");
      displayName = "Admin Cabang";
      room = "ayk-live-" + identity;
    } else if (role === "keliling") {
      if (typeof username !== "string" || !username || username.length > 100) {
        return json(res, 400, { error: "Username penjual belum diisi." });
      }
      const { data, error } = await db
        .from("penjual_keliling")
        .select("id,nama,username,password,aktif")
        .ilike("username", username)
        .maybeSingle();
      if (error || !data || data.aktif !== true || String(data.password) !== password) {
        return json(res, 401, { error: "Login Penjual Keliling tidak valid atau nonaktif." });
      }
      identity = "penjual-keliling-" + String(data.id).replace(/[^a-zA-Z0-9_-]/g, "-");
      displayName = String(data.nama || "Penjual Keliling").slice(0, 80);
      room = "ayk-live-" + identity;
    } else {
      return json(res, 400, { error: "Jenis akun tidak diizinkan untuk LIVE." });
    }

    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      ttl: "2h"
    });
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    return json(res, 200, {
      token: await token.toJwt(),
      url: process.env.LIVEKIT_URL,
      room,
      identity,
      name: displayName
    });
  } catch (error) {
    console.error("AYK LIVE token error:", error);
    return json(res, 500, { error: "Server gagal menyiapkan LIVE." });
  }
}
