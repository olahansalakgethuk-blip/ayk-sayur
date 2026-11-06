/* AYK SAYUR LIVE client */
let aykLiveRoom = null;
let aykLiveTracks = [];

async function aykLiveApi(payload) {
  const response = await fetch("/api/livekit-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Server LIVE tidak merespons.");
  return data;
}

function aykLiveStage(title) {
  let stage = document.getElementById("aykLiveStage");
  if (!stage) {
    stage = document.createElement("section");
    stage.id = "aykLiveStage";
    stage.className = "panel";
    const page = document.querySelector(".page") || document.getElementById("app");
    page.appendChild(stage);
  }
  stage.innerHTML = '<h3>' + title + '</h3><div id="aykLiveVideo" style="background:#111;min-height:220px;border-radius:12px;overflow:hidden"></div><p id="aykLiveStatus">Menghubungkan video...</p>';
  return stage;
}

async function aykLiveConnect(data, publish) {
  if (!window.LivekitClient) throw new Error("Komponen video belum termuat. Muat ulang aplikasi.");
  const room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
  room.on(LivekitClient.RoomEvent.TrackSubscribed, track => {
    const el = track.attach();
    el.style.width = "100%";
    el.style.maxHeight = "65vh";
    document.getElementById("aykLiveVideo")?.appendChild(el);
  });
  await room.connect(data.url, data.token);
  if (publish) {
    const tracks = await LivekitClient.createLocalTracks({
      audio: true,
      video: { facingMode: "user" }
    });
    aykLiveTracks = tracks;
    for (const track of tracks) {
      await room.localParticipant.publishTrack(track);
      if (track.kind === "video") {
        const el = track.attach();
        el.style.width = "100%";
        document.getElementById("aykLiveVideo")?.appendChild(el);
      }
    }
  }
  aykLiveRoom = room;
  const status = document.getElementById("aykLiveStatus");
  if (status) status.textContent = publish ? "Anda sedang LIVE." : "Terhubung ke siaran langsung.";
}

async function aykLiveStart() {
  try {
    if (role !== "admin" && role !== "keliling") throw new Error("Akun ini tidak memiliki izin LIVE.");
    const password = prompt("Masukkan password akun untuk mulai LIVE:");
    if (!password) return;
    const payload = { action: "start", password };
    if (role === "admin") {
      payload.role = adminMode === "pusat" ? "admin-pusat" : "admin-cabang";
      if (adminMode !== "pusat") payload.branchId = String(currentBranchId);
    } else {
      const seller = kelilingSellers.find(x => String(x.id) === String(currentKelilingSellerId));
      if (!seller) throw new Error("Data penjual tidak ditemukan.");
      payload.role = "keliling";
      payload.username = seller.username;
    }
    const data = await aykLiveApi(payload);
    aykLiveStage("🔴 LIVE AYK SAYUR");
    await aykLiveConnect(data, true);
    document.getElementById("aykLiveStage")?.insertAdjacentHTML(
      "beforeend",
      '<button class="btn red full" onclick="aykLiveStop()">⏹ Akhiri LIVE</button>'
    );
  } catch (error) {
    alert(error.message);
  }
}

async function aykLiveStop() {
  try {
    if (!aykLiveRoom) throw new Error("Tidak ada siaran aktif pada perangkat ini.");
    const password = prompt("Masukkan password akun untuk mengakhiri LIVE:");
    if (!password) return;
    const payload = { action: "stop", password };
    if (role === "admin") {
      payload.role = adminMode === "pusat" ? "admin-pusat" : "admin-cabang";
      if (adminMode !== "pusat") payload.branchId = String(currentBranchId);
    } else {
      const seller = kelilingSellers.find(x => String(x.id) === String(currentKelilingSellerId));
      payload.role = "keliling";
      payload.username = seller?.username || "";
    }
    await aykLiveApi(payload);
    aykLiveTracks.forEach(track => { track.stop(); track.detach(); });
    aykLiveTracks = [];
    await aykLiveRoom.disconnect();
    aykLiveRoom = null;
    document.getElementById("aykLiveStage")?.remove();
    alert("Siaran LIVE sudah diakhiri.");
  } catch (error) {
    alert(error.message);
  }
}

function aykLiveAdminPage(container) {
  container.innerHTML = '<h2>🔴 LIVE AYK SAYUR</h2><div class="panel"><p>Admin dapat menyiarkan video langsung.</p><button class="btn red full" onclick="aykLiveStart()">▶ Mulai LIVE</button></div>';
}

function aykLiveSellerPage() {
  document.getElementById("app").innerHTML =
    '<header><h1>🔴 LIVE PENJUAL</h1><p>' +
    String(currentKelilingSellerName || "Penjual Keliling") +
    '</p></header><div class="page"><button class="btn light full" onclick="kelilingApp()">← Kembali</button><div class="panel"><p>Izinkan akses kamera dan mikrofon saat diminta.</p><button class="btn red full" onclick="aykLiveStart()">▶ Mulai LIVE</button></div></div>';
}

async function aykBuyerLiveList() {
  document.getElementById("app").innerHTML =
    '<header><h1>🔴 LIVE Penjual AYK SAYUR</h1><p>Siaran yang sedang berlangsung</p></header><div class="page"><button class="btn light full" onclick="buyerApp()">← Kembali Belanja</button><div id="aykLiveList" class="panel">Memuat daftar LIVE...</div></div>';
  try {
    const data = await aykLiveApi({ action: "list" });
    const list = document.getElementById("aykLiveList");
    if (!data.streams?.length) {
      list.textContent = "Belum ada penjual yang sedang LIVE.";
      return;
    }
    list.innerHTML = "";
    data.streams.forEach(stream => {
      const card = document.createElement("div");
      card.className = "panel";
      const title = document.createElement("b");
      title.textContent = "🔴 " + stream.nama;
      const watch = document.createElement("button");
      watch.className = "btn green full";
      watch.textContent = "▶ Tonton LIVE";
      watch.onclick = () => aykBuyerWatchLive(stream.identity, stream.nama);
      card.append(title, document.createElement("br"), watch);
      list.appendChild(card);
    });
  } catch (error) {
    document.getElementById("aykLiveList").textContent = error.message;
  }
}

async function aykBuyerWatchLive(identity, name) {
  try {
    const data = await aykLiveApi({ action: "join", identity });
    const stage = aykLiveStage("🔴 LIVE " + name);
    stage.scrollIntoView({ behavior: "smooth", block: "start" });
    await aykLiveConnect(data, false);
  } catch (error) {
    alert(error.message);
  }
}
