// Student side of the GW13F leaderboard.
// - shows whether a competition is running (live, from Firestore control/state)
// - the team name is locked once confirmed (per competition: a new competition unlocks it)
// - when a RUN SIMULATION animation plays to the end, index.html calls window.__gw13fRunComplete(p, r);
//   if a competition is running, the team name is confirmed and the run is valid, the settings are sent.
// The leaderboard re-runs the simulation itself, so the time sent here is only for display.
import { db, fs } from "./firebase.js";

const { doc, onSnapshot, collection, addDoc, serverTimestamp } = fs;
const S = window.GW13FSim;
const $ = (id) => document.getElementById(id);
const banner = $("lb-banner"), team = $("lb-team"), confirmBtn = $("lb-confirm"), lockMsg = $("lb-lock"), status = $("lb-status");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let ctl = null, connected = false;

// ------------------------------------------------------------------
// Team name: typed draft, then locked as { name, compId } in this browser
// ------------------------------------------------------------------
const DRAFT_KEY = "gw13f_team_v1", LOCK_KEY = "gw13f_team_lock_v1";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
};
let lock = null;
try { lock = JSON.parse(store.get(LOCK_KEY) || "null"); } catch (e) { lock = null; }
if (!lock || !S.cleanTeam(lock.name)) lock = null;
const saveLock = () => { if (lock) store.set(LOCK_KEY, JSON.stringify(lock)); else store.del(LOCK_KEY); };

function renderTeam() {
  const live = !!(ctl && ctl.active);
  if (lock) {
    team.value = lock.name; team.disabled = true; confirmBtn.hidden = true; team.classList.remove("need");
    lockMsg.className = "mono lb-lock"; lockMsg.textContent = "";
  } else {
    team.disabled = false; confirmBtn.hidden = false;
    team.classList.toggle("need", live);
    lockMsg.className = "mono lb-lock" + (live ? " warn" : "");
    lockMsg.textContent = live ? "Confirm your team name: runs are not sent until you do." : "";
  }
}

if (!lock) team.value = store.get(DRAFT_KEY) || "";
team.addEventListener("input", () => { if (!lock) store.set(DRAFT_KEY, team.value); });
team.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmBtn.click(); });
confirmBtn.addEventListener("click", () => {
  const name = S.cleanTeam(team.value);
  if (!name) { lockMsg.className = "mono lb-lock warn"; lockMsg.textContent = "Type a team name first."; team.focus(); return; }
  lock = { name, compId: (ctl && ctl.compId) || null }; saveLock(); renderTeam();
});

// a new competition (e.g. the next section) unlocks the name on this computer
function syncLockToCompetition() {
  if (!lock || !ctl || !ctl.compId) return;
  if (!lock.compId) { lock.compId = ctl.compId; saveLock(); }
  else if (lock.compId !== ctl.compId) { lock = null; saveLock(); team.value = ""; store.del(DRAFT_KEY); }
}

// ------------------------------------------------------------------
// Competition banner
// ------------------------------------------------------------------
function renderBanner() {
  banner.className = "lb-banner";
  if (!connected) { banner.textContent = "Connecting to the leaderboard…"; }
  else if (ctl && ctl.active) {
    banner.classList.add("live");
    banner.innerHTML = `🏁 ${esc(ctl.label || "Competition")} is LIVE: finished runs that stay on the road are sent to the leaderboard.`;
  } else if (ctl && ctl.compId) {
    banner.classList.add("closed");
    banner.innerHTML = `Competition closed (${esc(ctl.label || "")}): runs are not being sent to the leaderboard.`;
  } else {
    banner.textContent = "No competition is running: runs are not being sent to the leaderboard.";
  }
  renderTeam();
}

// ------------------------------------------------------------------
// Lockdown: controls are greyed out and unusable unless a competition is live
// ------------------------------------------------------------------
const lockables = [$("lb-lockable")]; // the team name can be entered any time; only the simulation is locked
function setLocked(locked) {
  if (locked) {
    const stop = $("s13-stop"); if (stop && !stop.disabled) stop.click(); // freeze a run in progress
    if (document.activeElement && lockables.some((el) => el.contains(document.activeElement))) document.activeElement.blur();
  }
  lockables.forEach((el) => { el.inert = locked; });
}

// "Ready, set, go" over the page when the competition starts; unlocks on GO
let rsgTimer = null;
function readySetGo(onGo) {
  const old = document.querySelector(".rsg"); if (old) old.remove();
  clearTimeout(rsgTimer);
  const ov = document.createElement("div");
  ov.className = "rsg";
  ov.innerHTML = `<div class="rsg-lights"><div class="rsg-light"></div><div class="rsg-light"></div><div class="rsg-light"></div></div><div class="rsg-word"></div>`;
  document.body.appendChild(ov);
  const lights = ov.querySelectorAll(".rsg-light"), word = ov.querySelector(".rsg-word");
  const steps = [
    { w: "READY", c: "#FB7185", l: "red" },
    { w: "SET", c: "#FFB454", l: "amber" },
    { w: "GO!", c: "#34D399", l: "green", go: true },
  ];
  let i = 0;
  const next = () => {
    const s = steps[i];
    lights.forEach((el, j) => { el.className = "rsg-light" + (s.go ? " green" : j === i ? " " + s.l : ""); });
    word.textContent = s.w; word.style.color = s.c;
    word.className = "rsg-word" + (s.go ? " go" : ""); void word.offsetWidth; word.style.animation = "none"; void word.offsetWidth; word.style.animation = "";
    if (s.go) {
      onGo();
      rsgTimer = setTimeout(() => { ov.classList.add("out"); setTimeout(() => ov.remove(), 500); }, 900);
    } else { i++; rsgTimer = setTimeout(next, 900); }
  };
  next();
}

let prevActive; // undefined until the first snapshot
function applyState() {
  const active = !!(ctl && ctl.active);
  if (active && prevActive === false) readySetGo(() => setLocked(false)); // just started while the page was open
  else if (active && prevActive !== true) setLocked(false);              // page opened during a live competition
  else if (!active) { const ov = document.querySelector(".rsg"); if (ov) ov.remove(); clearTimeout(rsgTimer); setLocked(true); }
  prevActive = active;
}

renderTeam();
onSnapshot(doc(db, "control", "state"),
  (snap) => { connected = true; ctl = snap.exists() ? snap.data() : null; syncLockToCompetition(); renderBanner(); applyState(); },
  (err) => { console.error(err); setLocked(true); banner.className = "lb-banner"; banner.textContent = "Could not reach the leaderboard (check your internet connection)."; });

// ------------------------------------------------------------------
// Submitting a finished run
// ------------------------------------------------------------------
function setStatus(text, kind) { status.textContent = text; status.className = "mono lb-status" + (kind ? " " + kind : ""); }

window.__gw13fRunComplete = async (p, r) => {
  if (!ctl || !ctl.active || !ctl.compId) { setStatus("Not sent to the leaderboard: no competition is running."); return; }
  if (!lock) { setStatus("Not sent to the leaderboard: confirm your team name above the controls first.", "warn"); team.classList.add("need"); return; }
  const v = S.checkRun(p, r);
  if (!v.ok) { setStatus(`Not sent to the leaderboard: ${v.reason}.`, "warn"); return; }
  const name = lock.name, compId = ctl.compId;
  setStatus("Sending to the leaderboard…");
  try {
    await addDoc(collection(db, "competitions", compId, "runs"), {
      team: name, steer: p.steer, Ki: p.Ki, Kp: p.Kp, Kd: p.Kd, speed: p.speed, KiV: p.KiV, KpV: p.KpV, V: p.V,
      time: r.timeFinish, maxErr: r.maxErr, createdAt: serverTimestamp(),
    });
    setStatus(`✓ Sent to the leaderboard as "${name}": time ${r.timeFinish.toFixed(3)} s, max displacement ${r.maxErr.toFixed(3)} m.`, "ok");
  } catch (e) {
    console.error(e);
    if (e && e.code === "permission-denied") setStatus("Not sent: the competition closed before this run finished.", "warn");
    else setStatus(`Could not send to the leaderboard: ${e && e.message ? e.message : e}`, "warn");
  }
};
