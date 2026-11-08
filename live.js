/* AYK SAYUR LIVE client */
let aykLiveRoom = null;
let aykLiveTracks = [];
let aykBuyerMicTrack = null;

async function aykLiveApi(payload) {
  let response;
  const headers = { "Content-Type": "application/json" };

  // Admin Pusat/Cabang memakai sesi Supabase yang sudah aktif.
  if (payload.role === "admin-pusat" || payload.role === "admin-cabang") {
    if (typeof sb === "undefined" || !sb?.auth) {
      throw new Error("Koneksi login Supabase belum tersedia.");
    }
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError || !sessionData?.session?.access_token) {
      throw new Error("Sesi Admin sudah berakhir. Silakan login kembali.");
    }
    headers.Authorization = "Bearer " + sessionData.session.access_token;
  }

  try {
    response = await fetch("/api/livekit-token", {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error("Tidak dapat terhubung ke server Vercel: " + error.message);
  }

  const text = await response.text();
  let data = {};

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "Server mengirim jawaban bukan JSON. HTTP " + response.status +
      ". Jawaban: " + text.slice(0, 250)
    );
  }

  if (!response.ok) {
    throw new Error(
      data.detail ||
      data.error ||
      "Server gagal. HTTP " + response.status
    );
  }

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
  stage.innerHTML = '<h3>' + title + '</h3><div id="aykLiveVideo" style="background:#111;min-height:220px;border-radius:12px;overflow:hidden"></div><div id="aykLiveParticipants" class="panel" style="margin-top:8px;padding:10px"><b>👥 Bergabung (1)</b><div id="aykLiveParticipantNames" style="font-size:13px;margin-top:6px">Memuat peserta...</div></div><p id="aykLiveStatus">Menghubungkan video...</p>';
  return stage;
}

function aykLiveRenderParticipants(room) {
  const box = document.getElementById("aykLiveParticipantNames");
  const heading = document.querySelector("#aykLiveParticipants b");
  if (!box || !room) return;
  const people = [];
  const localName = room.localParticipant?.name || (room.localParticipant?.identity === "admin-pusat" ? "Admin Pusat" : room.localParticipant?.identity || "Anda");
  people.push({ name: localName, local: true });
  room.remoteParticipants?.forEach(participant => {
    people.push({ name: participant.name || participant.identity || "Peserta", local: false });
  });
  if (heading) heading.textContent = "👥 Bergabung (" + people.length + ")";
  box.replaceChildren();
  people.forEach(person => {
    const line = document.createElement("div");
    line.style.cssText = "padding:3px 0";
    line.textContent = (person.local ? "🟢 " : "👤 ") + person.name + (person.local ? " (Anda)" : "");
    box.appendChild(line);
  });
}

async function aykLiveConnect(data, publish) {
  if (!window.LivekitClient) throw new Error("Komponen video belum termuat. Muat ulang aplikasi.");
  const room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
  room.on(LivekitClient.RoomEvent.ParticipantConnected, () => aykLiveRenderParticipants(room));
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => aykLiveRenderParticipants(room));
  room.on(LivekitClient.RoomEvent.DataReceived, (payload, participant) => {
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload));
      if (msg.type !== "ayk-chat" || typeof msg.text !== "string") return;
      aykLiveAppendChat(msg.text, participant?.name || "Peserta");
    } catch (e) { console.warn("Pesan LIVE tidak terbaca", e); }
  });
  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    const el = track.attach();
    if (track.kind === "audio") {
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
    } else {
      el.style.width = "100%";
      el.style.maxHeight = "65vh";
      document.getElementById("aykLiveVideo")?.appendChild(el);
    }
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
  aykLiveRenderParticipants(room);
  const status = document.getElementById("aykLiveStatus");
  if (status) status.textContent = publish ? "Anda sedang LIVE." : "Terhubung ke siaran langsung.";
  aykLiveChatPanel(publish);
}

async function aykLiveStart() {
  try {
    if (role !== "admin" && role !== "keliling") throw new Error("Akun ini tidak memiliki izin LIVE.");
    const payload = { action: "start" };
    if (role === "keliling") {
      const password = prompt("Masukkan password Penjual Keliling:");
      if (!password) return;
      payload.password = password;
    }
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
    const payload = { action: "stop" };
    if (role === "keliling") {
      const password = prompt("Masukkan password Penjual Keliling:");
      if (!password) return;
      payload.password = password;
    }
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
    if (aykLiveRoom) {
      aykLiveChatPanel(false);
      const controls = document.createElement("div");
      controls.className = "panel";
      controls.id = "aykBuyerTalkControls";
      controls.style.cssText = "margin-top:6px;padding:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap";
      controls.innerHTML = '<button class="btn green" style="padding:6px 10px;font-size:12px" id="aykBuyerMicButton" onclick="aykBuyerToggleMic()">🎤 Bicara</button><small id="aykBuyerMicStatus">Mikrofon mati · tekan untuk bicara</small>';
      const chat = document.getElementById("aykLiveChat");
      stage.insertBefore(controls, chat || null);
    }
  } catch (error) {
    alert(error.message);
  }
}

async function aykBuyerToggleMic() {
  try {
    if (!aykLiveRoom) throw new Error("Hubungkan ke siaran LIVE terlebih dahulu.");
    const button = document.getElementById("aykBuyerMicButton");
    const status = document.getElementById("aykBuyerMicStatus");
    if (aykBuyerMicTrack) {
      if (aykBuyerMicTrack.isMuted) {
        await aykBuyerMicTrack.unmute();
        if (button) button.textContent = "🔇 Matikan";
        if (status) status.textContent = "Mikrofon aktif. Penjual dapat mendengar Anda.";
      } else {
        await aykBuyerMicTrack.mute();
        if (button) button.textContent = "🎤 Bicara";
        if (status) status.textContent = "Mikrofon mati.";
      }
      return;
    }
    aykBuyerMicTrack = await LivekitClient.createLocalAudioTrack();
    await aykLiveRoom.localParticipant.publishTrack(aykBuyerMicTrack);
    if (button) button.textContent = "🔇 Matikan Mikrofon";
    if (status) status.textContent = "Mikrofon aktif. Penjual dapat mendengar Anda.";
  } catch (error) {
    alert("Mikrofon pembeli: " + (error.message || error));
  }
}

function aykLiveChatPanel(isSeller) {
  const stage = document.getElementById("aykLiveStage");
  if (!stage || document.getElementById("aykLiveChat")) return;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "aykLiveChat";
  panel.innerHTML = '<h3>💬 Chat LIVE</h3><div id="aykLiveChatMessages" style="height:180px;overflow:auto;background:#f4f6f4;border-radius:8px;padding:10px;margin-bottom:10px"><small>Belum ada pesan. Mulai percakapan!</small></div><div style="display:flex;gap:8px"><input id="aykLiveChatInput" type="text" maxlength="500" placeholder="Tulis pesan atau pertanyaan..." style="flex:1;min-width:0"><button class="btn green" onclick="aykLiveSendChat()">Kirim</button></div>';
  stage.appendChild(panel);
  const input = panel.querySelector("#aykLiveChatInput");
  input.addEventListener("keydown", e => { if (e.key === "Enter") aykLiveSendChat(); });
}
function aykLiveAppendChat(message, sender) {
  const box = document.getElementById("aykLiveChatMessages");
  if (!box) return;
  const empty = box.querySelector("small");
  if (empty && empty.textContent.startsWith("Belum ada pesan")) box.innerHTML = "";
  const line = document.createElement("p");
  line.style.cssText = "margin:6px 0;padding:7px;background:white;border-radius:7px;overflow-wrap:anywhere";
  const who = document.createElement("b");
  who.textContent = sender + ": ";
  const body = document.createTextNode(message);
  line.append(who, body);
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}
async function aykLiveSendChat() {
  try {
    if (!aykLiveRoom) throw new Error("Belum terhubung ke siaran LIVE.");
    const input = document.getElementById("aykLiveChatInput");
    const message = String(input?.value || "").trim().slice(0,500);
    if (!message) return;
    const name = aykLiveRoom.localParticipant.name || (typeof currentKelilingSellerName !== "undefined" ? currentKelilingSellerName : "Peserta");
    const packet = new TextEncoder().encode(JSON.stringify({type:"ayk-chat",text:message}));
    await aykLiveRoom.localParticipant.publishData(packet, { reliable:true });
    aykLiveAppendChat(message, name || "Anda");
    input.value = "";
  } catch (error) { alert("Chat LIVE: " + (error.message || error)); }
}
