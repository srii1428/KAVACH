// KAVACH - Pure Software Women Safety Platform

// ----------------------------------------------------
// 0. Global Elements & State
// ----------------------------------------------------
const feedback = document.getElementById("feedback");
const statusPill = document.getElementById("statusPill");
const locationPill = document.getElementById("locationPill");
const sosButton = document.getElementById("sosButton");
const silentSosBtn = document.getElementById("silentSosBtn");
const stopButton = document.getElementById("stopButton");
const locButton = document.getElementById("locButton");
const emergencyBanner = document.getElementById("emergencyBanner");
const bannerStopBtn = document.getElementById("bannerStopBtn");
const sirenToggle = document.getElementById("sirenToggle");
const systemStateBadge = document.getElementById("systemStateBadge");
const systemStateText = document.getElementById("systemStateText");
const coordinatesEl = document.getElementById("coordinates");
const gmapsLink = document.getElementById("gmapsLink");
const alertDispatchList = document.getElementById("alertDispatchList");
const contactForm = document.getElementById("contactForm");
const contactList = document.getElementById("contactList");
const contactsCount = document.getElementById("contactsCount");
const audioEvidenceBox = document.getElementById("audioEvidenceBox");
const saveAudioBtn = document.getElementById("saveAudioBtn");

let currentPosition = null;
let marker = null;
let accuracyCircle = null;
let pathPolyline = null;
let trackingPath = [];
let watchId = null;
let pollTimer = null;
let isEmergencyActive = false;
let userStoppedSessionAt = 0;

// Audio Siren (Web Audio API)
let audioCtx = null;
let sirenOsc = null;
let sirenGain = null;
let sirenLfo = null;
let isSirenMuted = false;

// Audio Evidence Recording
let mediaRecorder = null;
let audioChunks = [];
let recordedAudioBlob = null;

// Ringtone Synthesizer for Fake Call
let ringtoneInterval = null;
let ringtoneOsc = null;

// Guardian Timer State
let timerInterval = null;
let timerRemainingSeconds = 0;

// Leaflet Map Initialization
const initialLat = parseFloat(document.body.dataset.lat) || 12.9753;
const initialLon = parseFloat(document.body.dataset.lon) || 77.5910;
const initialZoom = document.body.dataset.lat ? 16 : 13;

const map = L.map("map").setView([initialLat, initialLon], initialZoom);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

pathPolyline = L.polyline([], { color: '#ed2f79', weight: 4, opacity: 0.85 }).addTo(map);

// API Helper with robust JSON & HTML response handling
async function postJSON(url, body = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  
  let data;
  const contentType = r.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await r.json();
    } catch (_) {
      data = {};
    }
  } else {
    const text = await r.text();
    if (!r.ok) {
      throw new Error(`Server returned HTTP ${r.status}`);
    }
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { ok: r.ok };
    }
  }
  
  if (!r.ok) throw new Error((data && data.error) || `HTTP error ${r.status}`);
  return data;
}

// XSS Sanitizer for dynamic DOM insertion
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ----------------------------------------------------
// 1. Navigation Tabs (Desktop Header & Mobile Bottom Bar)
// ----------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll(".nav-tab, .mobile-nav-item").forEach(el => {
    if (el.dataset.tab === tabId) el.classList.add("active");
    else el.classList.remove("active");
  });
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

  const targetPane = document.getElementById(tabId);
  if (targetPane) {
    targetPane.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (tabId === "tab-emergency") {
    setTimeout(() => map.invalidateSize(), 200);
  } else if (tabId === "tab-havens") {
    loadSafeHavens();
  } else if (tabId === "tab-history") {
    loadIncidentsHistory();
  }
}

document.querySelectorAll(".nav-tab, .mobile-nav-item").forEach(tab => {
  tab.addEventListener("click", () => {
    switchTab(tab.dataset.tab);
  });
});

// ----------------------------------------------------
// 2. Audio Siren Synthesizer
// ----------------------------------------------------
function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
}

function startSiren() {
  if (isSirenMuted) return;
  try {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    stopSiren();

    sirenOsc = audioCtx.createOscillator();
    sirenGain = audioCtx.createGain();
    sirenLfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();

    sirenOsc.type = "sawtooth";
    sirenOsc.frequency.setValueAtTime(800, audioCtx.currentTime);

    sirenLfo.type = "sine";
    sirenLfo.frequency.setValueAtTime(2, audioCtx.currentTime);
    lfoGain.gain.setValueAtTime(300, audioCtx.currentTime);

    sirenLfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);

    sirenGain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    sirenOsc.connect(sirenGain);
    sirenGain.connect(audioCtx.destination);

    sirenOsc.start();
    sirenLfo.start();
    sirenToggle.textContent = "🔊 Siren ON";
    sirenToggle.classList.remove("muted");
  } catch (err) {
    console.warn("Could not start siren:", err);
  }
}

function stopSiren() {
  try {
    if (sirenOsc) {
      sirenOsc.stop();
      sirenOsc.disconnect();
      sirenOsc = null;
    }
    if (sirenLfo) {
      sirenLfo.stop();
      sirenLfo.disconnect();
      sirenLfo = null;
    }
  } catch (_) {}
}

sirenToggle.addEventListener("click", () => {
  if (sirenOsc) {
    stopSiren();
    isSirenMuted = true;
    sirenToggle.textContent = "🔇 Siren MUTED";
    sirenToggle.classList.add("muted");
  } else {
    isSirenMuted = false;
    startSiren();
  }
});

// ----------------------------------------------------
// 3. Audio Evidence Recording
// ----------------------------------------------------
async function startAudioRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      recordedAudioBlob = new Blob(audioChunks, { type: "audio/webm" });
      audioEvidenceBox.style.display = "flex";
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    audioEvidenceBox.style.display = "flex";
  } catch (e) {
    console.warn("Mic recording unavailable:", e);
  }
}

function stopAudioRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

saveAudioBtn.addEventListener("click", () => {
  if (!recordedAudioBlob) return;
  const url = URL.createObjectURL(recordedAudioBlob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = `kavach-emergency-evidence-${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
});

// ----------------------------------------------------
// 4. Geolocation, Reverse Geocoding & Interactive Map
// ----------------------------------------------------
const addressText = document.getElementById("addressText");
const mapSearchForm = document.getElementById("mapSearchForm");
const mapSearchInput = document.getElementById("mapSearchInput");
const locateMeBtn = document.getElementById("locateMeBtn");

let reverseGeoDebounce = null;

async function fetchAddress(lat, lon) {
  if (!addressText) return;
  if (reverseGeoDebounce) clearTimeout(reverseGeoDebounce);
  reverseGeoDebounce = setTimeout(async () => {
    try {
      addressText.textContent = "Resolving street address...";
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`);
      const data = await res.json();
      if (data && data.display_name) {
        addressText.textContent = data.display_name;
        if (marker) {
          marker.bindPopup(`<strong>📍 Current Live Spot</strong><br><small>${data.display_name}</small>`);
        }
      } else {
        addressText.textContent = `Coordinates: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
    } catch (_) {
      addressText.textContent = `Coordinates: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  }, 400);
}

function updateMapLocation(lat, lon, accuracy = null, updateAddress = true) {
  currentPosition = { latitude: lat, longitude: lon };
  const latLng = [lat, lon];

  // Save to localStorage so user's exact area is remembered
  try {
    localStorage.setItem("kavach_user_lat", lat);
    localStorage.setItem("kavach_user_lon", lon);
  } catch (_) {}

  if (marker) {
    marker.setLatLng(latLng);
  } else {
    // Custom High-Visibility Draggable Emergency Pin
    const pinHtml = `
      <div class="pulse-marker-container">
        <div class="pulse-ring"></div>
        <div class="pulse-core"></div>
      </div>
    `;
    const pulseIcon = L.divIcon({
      className: 'pulse-marker-wrapper',
      html: pinHtml,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    
    marker = L.marker(latLng, { icon: pulseIcon, draggable: true }).addTo(map);
    
    // Allow dragging pin to fine-tune exact spot
    marker.on('dragend', function(e) {
      const pos = e.target.getLatLng();
      updateMapLocation(pos.lat, pos.lng, null, true);
      if (isEmergencyActive) {
        postJSON("/api/location", currentPosition).catch(() => {});
      }
    });
  }

  if (accuracy) {
    if (accuracyCircle) accuracyCircle.setLatLng(latLng).setRadius(accuracy);
    else accuracyCircle = L.circle(latLng, { radius: accuracy, color: '#ed2f79', fillOpacity: 0.12, weight: 1.5 }).addTo(map);
  }

  trackingPath.push(latLng);
  pathPolyline.setLatLngs(trackingPath);
  map.setView(latLng, 16);

  coordinatesEl.textContent = `Latitude: ${lat.toFixed(6)} · Longitude: ${lon.toFixed(6)}${accuracy ? ` (±${Math.round(accuracy)}m)` : ''}`;
  locationPill.textContent = "LOCATION LIVE";
  locationPill.classList.add("active");

  gmapsLink.href = `https://maps.google.com/?q=${lat},${lon}`;
  gmapsLink.style.display = "inline-flex";

  if (updateAddress) {
    fetchAddress(lat, lon);
  }
}

// Click anywhere on map to set position
map.on('click', function(e) {
  updateMapLocation(e.latlng.lat, e.latlng.lng, null, true);
  if (isEmergencyActive) {
    postJSON("/api/location", currentPosition).catch(() => {});
  }
});

function getLocationOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Browser does not support GPS."));
    }
    if (addressText) addressText.textContent = "Querying live device GPS sensor...";
    
    navigator.geolocation.getCurrentPosition(
      pos => {
        updateMapLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
        resolve(currentPosition);
      },
      err => {
        let msg = "Could not get live GPS.";
        if (err.code === 1) msg = "Location permission blocked. Enable location permissions in browser.";
        else if (err.code === 2) msg = "GPS position unavailable on this network.";
        else if (err.code === 3) msg = "GPS request timed out.";
        if (addressText) addressText.textContent = msg + " Use search bar or click map to set location.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function startContinuousTracking() {
  if (!navigator.geolocation || watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    pos => {
      updateMapLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, false);
      postJSON("/api/location", currentPosition).catch(() => {});
    },
    err => console.warn("Watch position error:", err),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

function stopContinuousTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// Map Location Search
if (mapSearchForm) {
  mapSearchForm.addEventListener("submit", async e => {
    e.preventDefault();
    const query = mapSearchInput.value.trim();
    if (!query) return;
    if (addressText) addressText.textContent = `Searching for "${query}"...`;
    
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const results = await res.json();
      if (results && results.length > 0) {
        const lat = parseFloat(results[0].lat);
        const lon = parseFloat(results[0].lon);
        updateMapLocation(lat, lon, null, false);
        if (addressText) addressText.textContent = results[0].display_name;
        if (isEmergencyActive) {
          postJSON("/api/location", currentPosition).catch(() => {});
        }
      } else {
        if (addressText) addressText.textContent = `No results found for "${query}". Try adding city (e.g. "${query} Bangalore").`;
      }
    } catch (err) {
      if (addressText) addressText.textContent = "Search error: " + err.message;
    }
  });
}

if (locateMeBtn) {
  locateMeBtn.addEventListener("click", async () => {
    try {
      await getLocationOnce();
    } catch (err) {
      console.warn(err);
    }
  });
}

// ----------------------------------------------------
// 5. Emergency SOS Flow (Loud vs Silent)
// ----------------------------------------------------
function renderAlertDispatches(dispatches) {
  if (!dispatches || dispatches.length === 0) return;
  alertDispatchList.innerHTML = "";
  
  // Detect iOS for SMS URI formatting
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  
  dispatches.forEach(d => {
    const item = document.createElement("div");
    item.className = "dispatch-item";
    
    // Format device-compatible SMS link
    const safeName = escapeHTML(d.name);
    const safePhone = escapeHTML(d.phone);
    const safeCallUrl = escapeHTML(d.call_url);
    const safeWaUrl = escapeHTML(d.whatsapp_url);
    const encodedBody = encodeURIComponent(d.sms_body || "");
    const smsLink = isIOS ? `sms:${encodeURIComponent(d.phone)}&body=${encodedBody}` : `sms:${encodeURIComponent(d.phone)}?body=${encodedBody}`;
    
    item.innerHTML = `
      <div class="dispatch-info">
        <strong>To: ${safeName} (${safePhone})</strong>
        <small>${d.gateway_sent ? '⚡ Automated SMS Dispatched' : 'Cellular SMS Ready · 1-Tap to Send'}</small>
      </div>
      <div class="dispatch-links">
        <a href="${smsLink}" class="dispatch-btn sms-btn">✉️ Send SMS</a>
        <a href="${safeCallUrl}" class="dispatch-btn call-btn">📞 Call</a>
        <a href="${safeWaUrl}" target="_blank" class="dispatch-btn wa-subtle-btn" title="Send via WhatsApp">💬</a>
      </div>
    `;
    alertDispatchList.appendChild(item);
  });
}

function activateEmergencyUI(data = {}, isSilent = false) {
  isEmergencyActive = true;
  document.body.classList.add("emergency-active");
  document.body.dataset.status = "ACTIVE";

  if (statusPill) {
    statusPill.textContent = isSilent ? "SILENT SOS" : "SOS ACTIVE";
    statusPill.classList.add("active");
  }
  if (systemStateBadge) {
    systemStateBadge.classList.add("active");
  }
  if (systemStateText) {
    systemStateText.textContent = isSilent ? "SILENT SOS" : "SOS ACTIVE";
  }
  if (sosButton) {
    sosButton.classList.add("pulsing");
    sosButton.innerHTML = '<span class="sos-label">STOP</span><small>TAP TO DISARM</small>';
  }
  if (stopButton) {
    stopButton.style.display = "inline-flex";
  }

  if (!isSilent) {
    if (emergencyBanner) emergencyBanner.style.display = "flex";
    startSiren();
  }

  if (data.dispatches && data.dispatches.length > 0) {
    renderAlertDispatches(data.dispatches);
  }

  feedback.textContent = data.message || "🚨 EMERGENCY DISTRESS BROADCAST ACTIVE!";
  startAudioRecording();
  startContinuousTracking();
}

function deactivateEmergencyUI() {
  isEmergencyActive = false;
  document.body.classList.remove("emergency-active");
  document.body.dataset.status = "SAFE";
  if (emergencyBanner) emergencyBanner.style.display = "none";

  if (statusPill) {
    statusPill.textContent = "SAFE";
    statusPill.classList.remove("active");
  }
  if (systemStateBadge) {
    systemStateBadge.classList.remove("active");
  }
  if (systemStateText) {
    systemStateText.textContent = "SYSTEM SAFE";
  }
  if (sosButton) {
    sosButton.classList.remove("pulsing");
    sosButton.innerHTML = '<span class="sos-label">SOS</span><small>LOUD ALARM</small>';
  }
  if (stopButton) {
    stopButton.style.display = "none";
  }

  feedback.textContent = "Emergency session stopped. System returned to SAFE status.";

  stopSiren();
  stopAudioRecording();
  stopContinuousTracking();
}

async function triggerSOS(triggerType = "MANUAL", isSilent = false) {
  try {
    feedback.textContent = isSilent
      ? "🤫 Covert distress signal dispatching..."
      : "Acquiring live GPS location & broadcasting SOS...";
    
    let pos = null;
    try {
      pos = await getLocationOnce();
    } catch (_) {}

    const payload = {
      latitude: pos ? pos.latitude : (currentPosition ? currentPosition.latitude : null),
      longitude: pos ? pos.longitude : (currentPosition ? currentPosition.longitude : null),
      trigger_type: triggerType,
      is_silent: isSilent
    };

    try {
      const res = await postJSON("/api/sos", payload);
      activateEmergencyUI(res, isSilent);
    } catch (primaryErr) {
      console.warn("Primary /api/sos failed, attempting fallback:", primaryErr);
      const q = new URLSearchParams({
        latitude: payload.latitude !== null && payload.latitude !== undefined ? payload.latitude : "",
        longitude: payload.longitude !== null && payload.longitude !== undefined ? payload.longitude : "",
        trigger_type: payload.trigger_type || "MANUAL",
        is_silent: payload.is_silent ? "1" : "0"
      });
      const getRes = await fetch(`/api/sos?${q.toString()}`, { method: "GET" });
      if (getRes.ok) {
        let data;
        const cType = getRes.headers.get("content-type") || "";
        if (cType.includes("application/json")) {
          data = await getRes.json();
        } else {
          data = { ok: true, status: "ACTIVE" };
        }
        activateEmergencyUI(data, isSilent);
      } else {
        throw primaryErr;
      }
    }
  } catch (err) {
    feedback.textContent = "Error triggering SOS: " + err.message;
  }
}

// SOS Button: Tapping while active immediately DISARMS; tapping while safe triggers SOS
sosButton.addEventListener("click", () => {
  if (isEmergencyActive) {
    stopSOS();
  } else {
    triggerSOS("MANUAL", false);
  }
});
silentSosBtn.addEventListener("click", () => triggerSOS("STEALTH", true));

locButton.addEventListener("click", async () => {
  try {
    feedback.textContent = "Acquiring updated GPS coordinates...";
    const pos = await getLocationOnce();
    if (isEmergencyActive) {
      await postJSON("/api/location", pos);
      feedback.textContent = "Live coordinates broadcasted to emergency session.";
    } else {
      feedback.textContent = "Location updated on map.";
    }
  } catch (err) {
    feedback.textContent = err.message;
  }
});

async function stopSOS() {
  userStoppedSessionAt = Date.now();

  // 1. Instantly silence siren, stop recorder, hide strobe, and switch UI to safe
  deactivateEmergencyUI();
  feedback.textContent = "Disarming emergency... Resetting system to SAFE.";

  // 2. Also reset any client-side guardian timer countdown
  try {
    resetTimerDisplay();
  } catch (_) {}

  // 3. Notify backend database to mark all emergencies CLOSED
  try {
    const res = await postJSON("/api/stop");
    feedback.textContent = res.message || "Emergency stopped. All systems reset to SAFE.";
  } catch (err) {
    console.warn("Primary /api/stop error, attempting fallback:", err);
    try {
      await fetch("/api/stop", { method: "POST" });
      feedback.textContent = "Emergency stopped. System reset to SAFE.";
    } catch (_) {
      try {
        await fetch("/api/stop", { method: "GET" });
        feedback.textContent = "Emergency stopped. System reset to SAFE.";
      } catch (_) {
        feedback.textContent = "Emergency disarmed locally. Alarm and sirens silenced.";
      }
    }
  }
}
stopButton.addEventListener("click", stopSOS);
bannerStopBtn.addEventListener("click", stopSOS);

// ----------------------------------------------------
// 6. Guardian Safety Timer ("Walk Safe")
// ----------------------------------------------------
const timerBadge = document.getElementById("timerBadge");
const timerSetup = document.getElementById("timerSetup");
const timerActiveDisplay = document.getElementById("timerActiveDisplay");
const countdownTime = document.getElementById("countdownTime");
const countdownDest = document.getElementById("countdownDest");
const startTimerBtn = document.getElementById("startTimerBtn");
const checkInSafeBtn = document.getElementById("checkInSafeBtn");
const timerSosNowBtn = document.getElementById("timerSosNowBtn");
const destinationInput = document.getElementById("destinationInput");

let selectedMinutes = 15;
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedMinutes = parseInt(btn.dataset.min);
  });
});

function updateTimerClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  countdownTime.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startClientCountdown(seconds, dest) {
  timerRemainingSeconds = seconds;
  countdownDest.textContent = "Destination: " + dest;
  timerSetup.style.display = "none";
  timerActiveDisplay.style.display = "block";
  timerBadge.textContent = "ACTIVE COUNTDOWN";
  timerBadge.classList.add("active");

  if (timerInterval) clearInterval(timerInterval);

  updateTimerClock(timerRemainingSeconds);

  timerInterval = setInterval(() => {
    timerRemainingSeconds--;
    if (timerRemainingSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      countdownTime.textContent = "00:00";
      // Auto-escalate to SOS!
      triggerSOS("TIMER_EXPIRED", false);
      resetTimerDisplay();
    } else {
      updateTimerClock(timerRemainingSeconds);
    }
  }, 1000);
}

function resetTimerDisplay() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerSetup.style.display = "block";
  timerActiveDisplay.style.display = "none";
  timerBadge.textContent = "INACTIVE";
  timerBadge.classList.remove("active");
}

startTimerBtn.addEventListener("click", async () => {
  const dest = destinationInput.value.trim() || "Commute / Walk Home";
  try {
    const res = await postJSON("/api/timer/start", { minutes: selectedMinutes, destination: dest });
    startClientCountdown(res.duration_seconds, dest);
  } catch (err) {
    alert("Could not start safety timer: " + err.message);
  }
});

checkInSafeBtn.addEventListener("click", async () => {
  try {
    await postJSON("/api/timer/checkin");
    resetTimerDisplay();
    alert("✅ Checked in safely! Your Guardian Timer has ended safely.");
  } catch (err) {
    alert("Check-in error: " + err.message);
  }
});

timerSosNowBtn.addEventListener("click", () => {
  triggerSOS("MANUAL", false);
  resetTimerDisplay();
});

// Check if a timer was already running on load
async function checkExistingTimer() {
  try {
    const res = await fetch("/api/timer/status");
    const data = await res.json();
    if (data.active && data.remaining_seconds > 0) {
      startClientCountdown(data.remaining_seconds, data.timer.destination);
    }
  } catch (_) {}
}

// ----------------------------------------------------
// 7. Fake Incoming Call Simulator
// ----------------------------------------------------
const fakeCallModal = document.getElementById("fakeCallModal");
const fcAvatar = document.getElementById("fcAvatar");
const fcCallerName = document.getElementById("fcCallerName");
const fcCallerNumber = document.getElementById("fcCallerNumber");
const fcCallStatus = document.getElementById("fcCallStatus");
const fcIncomingControls = document.getElementById("fcIncomingControls");
const fcActiveControls = document.getElementById("fcActiveControls");
const fcAcceptBtn = document.getElementById("fcAcceptBtn");
const fcDeclineBtn = document.getElementById("fcDeclineBtn");
const fcEndCallBtn = document.getElementById("fcEndCallBtn");
const fcDuration = document.getElementById("fcDuration");
const startFakeCallBtn = document.getElementById("startFakeCallBtn");
const fakeCallCountdown = document.getElementById("fakeCallCountdown");

let selectedCaller = { name: "Mom", num: "+91 98200 11223", avatar: "👩" };
let selectedDelay = 3;
let callDurationTimer = null;
let callDurationSeconds = 0;

document.querySelectorAll(".caller-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".caller-preset").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedCaller = {
      name: btn.dataset.name,
      num: btn.dataset.num,
      avatar: btn.textContent.trim().split(" ")[0]
    };
  });
});

document.querySelectorAll(".delay-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".delay-preset").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedDelay = parseInt(btn.dataset.delay);
  });
});

function playRingtone() {
  initAudio();
  if (!audioCtx) return;

  function beep() {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);
    } catch (_) {}
  }

  beep();
  ringtoneInterval = setInterval(beep, 2000);

  // Vibrate if mobile device
  if (navigator.vibrate) {
    navigator.vibrate([800, 400, 800, 400, 800]);
  }
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}

function speakVoiceScript() {
  if ('speechSynthesis' in window) {
    const text = "Hey, where are you right now? Dad and I are parked right outside in the car waiting for you. Please come out immediately, we need to leave!";
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.1;
    window.speechSynthesis.speak(utter);
  }
}

startFakeCallBtn.addEventListener("click", () => {
  let remaining = selectedDelay;
  fakeCallCountdown.style.display = "block";
  fakeCallCountdown.textContent = `Incoming call in ${remaining}s... Prepare to excuse yourself!`;

  const cd = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(cd);
      fakeCallCountdown.style.display = "none";
      launchFakeCallScreen();
    } else {
      fakeCallCountdown.textContent = `Incoming call in ${remaining}s...`;
    }
  }, 1000);
});

function launchFakeCallScreen() {
  fcAvatar.textContent = selectedCaller.avatar;
  fcCallerName.textContent = selectedCaller.name;
  fcCallerNumber.textContent = selectedCaller.num;
  fcCallStatus.textContent = "Incoming Call...";
  fcIncomingControls.style.display = "flex";
  fcActiveControls.style.display = "none";
  fakeCallModal.style.display = "flex";
  playRingtone();
}

fcAcceptBtn.addEventListener("click", () => {
  stopRingtone();
  fcCallStatus.textContent = "Connected";
  fcIncomingControls.style.display = "none";
  fcActiveControls.style.display = "flex";

  callDurationSeconds = 0;
  fcDuration.textContent = "00:00";
  callDurationTimer = setInterval(() => {
    callDurationSeconds++;
    const m = Math.floor(callDurationSeconds / 60);
    const s = callDurationSeconds % 60;
    fcDuration.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);

  speakVoiceScript();
});

function endFakeCall() {
  stopRingtone();
  if (callDurationTimer) clearInterval(callDurationTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  fakeCallModal.style.display = "none";
}

fcDeclineBtn.addEventListener("click", endFakeCall);
fcEndCallBtn.addEventListener("click", endFakeCall);

// ----------------------------------------------------
// 8. Stealth Calculator Disguise
// ----------------------------------------------------
const enterStealthBtn = document.getElementById("enterStealthBtn");
const stealthCalcOverlay = document.getElementById("stealthCalcOverlay");
const exitCalcBtn = document.getElementById("exitCalcBtn");
const calcDisplay = document.getElementById("calcDisplay");

let calcInput = "0";

enterStealthBtn.addEventListener("click", () => {
  calcInput = "0";
  calcDisplay.textContent = calcInput;
  stealthCalcOverlay.style.display = "flex";
});

exitCalcBtn.addEventListener("click", () => {
  stealthCalcOverlay.style.display = "none";
});

document.querySelectorAll(".calc-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const val = btn.dataset.val;

    if (val === "C") {
      calcInput = "0";
    } else if (val === "=") {
      // SECRET TRIGGER: If input contains 911 or 999
      if (calcInput.includes("911") || calcInput.includes("999")) {
        triggerSOS("STEALTH", true); // Trigger silent covert SOS
        calcDisplay.textContent = "Error: 0";
        setTimeout(() => { calcInput = "0"; calcDisplay.textContent = "0"; }, 1500);
        return;
      }
      // Validate arithmetic characters only to prevent code execution
      if (!/^[0-9+\-*/.() ]+$/.test(calcInput)) {
        calcInput = "Error";
      } else {
        try {
          calcInput = String(Function(`'use strict'; return (${calcInput})`)());
        } catch (_) {
          calcInput = "Error";
        }
      }
    } else if (val === "+/-") {
      if (calcInput.startsWith("-")) calcInput = calcInput.slice(1);
      else if (calcInput !== "0") calcInput = "-" + calcInput;
    } else if (val === "%") {
      calcInput = String(parseFloat(calcInput) / 100);
    } else {
      if (calcInput === "0" && !isNaN(val)) calcInput = val;
      else calcInput += val;
    }
    calcDisplay.textContent = calcInput;
  });
});

// ----------------------------------------------------
// 9. Safe Havens & Emergency Locations
// ----------------------------------------------------
async function loadSafeHavens() {
  const havensList = document.getElementById("havensList");
  havensList.innerHTML = '<div class="loading-haven">Locating safe emergency points near you...</div>';
  try {
    const lat = currentPosition ? currentPosition.latitude : initialLat;
    const lon = currentPosition ? currentPosition.longitude : initialLon;
    const res = await fetch(`/api/safe-havens?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    havensList.innerHTML = "";

    data.havens.forEach(h => {
      const card = document.createElement("div");
      card.className = "haven-item";
      card.innerHTML = `
        <div class="haven-icon">${h.icon}</div>
        <div class="haven-details">
          <strong>${h.name}</strong>
          <small>${h.type} · Approx. ${h.distance}</small>
          <div class="haven-helpline">Helpline: ${h.helpline}</div>
        </div>
        <div class="haven-actions">
          <a href="${h.directions_url}" target="_blank" class="haven-btn nav-btn">🧭 Navigate</a>
        </div>
      `;
      havensList.appendChild(card);
    });
  } catch (err) {
    havensList.innerHTML = `<div class="muted">Could not load safe havens: ${err.message}</div>`;
  }
}
document.getElementById("refreshHavensBtn").addEventListener("click", loadSafeHavens);

// ----------------------------------------------------
// 10. Incident History & Police Report Export
// ----------------------------------------------------
let cachedIncidents = [];
async function loadIncidentsHistory() {
  const tbody = document.getElementById("incidentsBody");
  tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading audit records...</td></tr>';
  try {
    const res = await fetch("/api/incidents");
    const data = await res.json();
    cachedIncidents = data.incidents || [];
    tbody.innerHTML = "";

    if (cachedIncidents.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No emergency records logged yet.</td></tr>';
      return;
    }

    cachedIncidents.forEach(inc => {
      const tr = document.createElement("tr");
      const coords = inc.latitude && inc.longitude ? `${inc.latitude.toFixed(4)}, ${inc.longitude.toFixed(4)}` : "Not Captured";
      tr.innerHTML = `
        <td>#${inc.id}</td>
        <td><span class="type-tag ${inc.trigger_type.toLowerCase()}">${inc.trigger_type}</span></td>
        <td><span class="status-tag ${inc.status.toLowerCase()}">${inc.status}</span></td>
        <td>${coords}</td>
        <td>${inc.created_at ? inc.created_at.slice(0, 19).replace('T', ' ') : 'N/A'}</td>
        <td>${inc.alerts_count} Dispatched</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Error: ${err.message}</td></tr>`;
  }
}

document.getElementById("downloadReportBtn").addEventListener("click", () => {
  if (cachedIncidents.length === 0) {
    alert("No incident records available to export.");
    return;
  }

  let report = "=========================================================\n";
  report += "      KAVACH WOMEN SAFETY - OFFICIAL INCIDENT REPORT      \n";
  report += "=========================================================\n";
  report += `Generated At: ${new Date().toLocaleString()}\n`;
  report += `Total Incidents: ${cachedIncidents.length}\n\n`;

  cachedIncidents.forEach((inc, idx) => {
    report += `--- INCIDENT EVENT #${inc.id} ---\n`;
    report += `Status: ${inc.status}\n`;
    report += `Trigger Mode: ${inc.trigger_type} (Silent: ${inc.is_silent ? 'YES' : 'NO'})\n`;
    report += `Coordinates: Lat ${inc.latitude || 'N/A'}, Lon ${inc.longitude || 'N/A'}\n`;
    if (inc.latitude) report += `Google Maps Link: https://maps.google.com/?q=${inc.latitude},${inc.longitude}\n`;
    report += `Timestamp: ${inc.created_at}\n`;
    report += `Dispatches Logged: ${inc.alerts_count}\n`;
    if (inc.alerts) {
      inc.alerts.forEach(a => {
        report += `  - Contact: ${a.contact_name} (${a.contact_phone}) | Sent: ${a.timestamp}\n`;
      });
    }
    report += "\n";
  });

  const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kavach-police-incident-report-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
});

// ----------------------------------------------------
// 11. Contact Management
// ----------------------------------------------------
contactForm.addEventListener("submit", async e => {
  e.preventDefault();
  const nameInput = document.getElementById("contactName");
  const phoneInput = document.getElementById("contactPhone");
  const submitBtn = contactForm.querySelector("button[type='submit']");
  const origBtnText = submitBtn ? submitBtn.textContent : "+ Add Contact";
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();

  if (!name || !phone) {
    alert("Please provide both a contact name and mobile number.");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
  }

  try {
    const res = await postJSON("/api/contacts", { name, phone });
    const emptyNotice = document.getElementById("emptyContacts");
    if (emptyNotice) emptyNotice.remove();

    const safeName = escapeHTML(res.name);
    const safePhone = escapeHTML(res.phone);

    const li = document.createElement("li");
    li.dataset.id = res.id;
    li.dataset.name = res.name;
    li.dataset.phone = res.phone;
    li.innerHTML = `
      <div class="contact-meta">
        <strong>${safeName}</strong>
        <small>${safePhone}</small>
      </div>
      <div class="contact-actions">
        <a href="sms:${encodeURIComponent(res.phone)}?body=Hello%20${encodeURIComponent(res.name)},%20this%20is%20my%20KAVACH%20trusted%20contact%20test." class="action-btn sms-action" title="Send SMS to ${safeName}">✉️</a>
        <a href="tel:${encodeURIComponent(res.phone)}" class="action-btn call-action" title="Call ${safeName}">📞</a>
        <button class="remove" aria-label="Remove ${safeName}" title="Delete Contact">×</button>
      </div>
    `;
    contactList.prepend(li);
    contactsCount.textContent = contactList.querySelectorAll("li:not(.empty)").length;

    nameInput.value = "";
    phoneInput.value = "";
    feedback.textContent = `Saved trusted contact "${res.name}".`;
  } catch (err) {
    console.error("Add contact error:", err);
    feedback.textContent = "Could not add contact: " + err.message;
    alert("Could not add contact: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = origBtnText;
    }
  }
});

contactList.addEventListener("click", async e => {
  if (!e.target.classList.contains("remove")) return;
  const li = e.target.closest("li");
  const contactId = li.dataset.id;
  if (!contactId) return;

  if (!confirm(`Delete trusted contact "${li.dataset.name || ''}"?`)) return;

  try {
    await fetch(`/api/contacts/${contactId}`, { method: "DELETE" });
    li.remove();
    const remaining = contactList.querySelectorAll("li:not(.empty)").length;
    contactsCount.textContent = remaining;
    if (remaining === 0) {
      contactList.innerHTML = '<li class="empty" id="emptyContacts">No trusted contacts added yet. Add at least one above.</li>';
    }
    feedback.textContent = "Contact removed.";
  } catch (err) {
    feedback.textContent = "Failed to remove contact: " + err.message;
  }
});

// ----------------------------------------------------
// 12. On Load Initialization & Background Sync
// ----------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  const initialStatus = document.body.dataset.status;
  const initialLat = parseFloat(document.body.dataset.lat);
  const initialLon = parseFloat(document.body.dataset.lon);

  // Check saved position in localStorage
  const savedLat = parseFloat(localStorage.getItem("kavach_user_lat"));
  const savedLon = parseFloat(localStorage.getItem("kavach_user_lon"));

  if (initialStatus === "ACTIVE" && initialLat && initialLon) {
    updateMapLocation(initialLat, initialLon, null, true);
    activateEmergencyUI({ message: "Resumed active emergency SOS from database." });
  } else {
    // Always prioritize acquiring live device GPS first
    getLocationOnce()
      .then(pos => {
        if (addressText) addressText.textContent = "Live device GPS acquired.";
      })
      .catch(() => {
        // If GPS is disabled or blocked, use saved custom location
        if (savedLat && savedLon) {
          updateMapLocation(savedLat, savedLon, null, true);
        } else if (initialLat && initialLon) {
          updateMapLocation(initialLat, initialLon, null, true);
        }
      });
  }

  checkExistingTimer();

  // Status Poll every 5 seconds
  pollTimer = setInterval(async () => {
    // If the user recently stopped the emergency (within 10 seconds), do not resurrect it
    if (Date.now() - userStoppedSessionAt < 10000) {
      return;
    }
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data.status === "ACTIVE" && !isEmergencyActive) {
        activateEmergencyUI({
          message: "SOS broadcast initiated!",
          dispatches: data.alerts
        });
        if (data.emergency && data.emergency.latitude) {
          updateMapLocation(data.emergency.latitude, data.emergency.longitude);
        }
      } else if (data.status !== "ACTIVE" && isEmergencyActive) {
        deactivateEmergencyUI();
      }
    } catch (_) {}
  }, 5000);
});
