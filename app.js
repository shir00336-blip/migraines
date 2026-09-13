/* =====================================================================
   MigraineLog — app logic
   Everything here runs entirely client-side. No fetch(), no XHR, no
   analytics. All data lives in this browser's localStorage only.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. STORAGE LAYER
   --------------------------------------------------------------------- */
const DB = {
  keys: {
    entries: "ml_entries",
    checkins: "ml_checkins",
    meds: "ml_meds",
    streak: "ml_streak",
    settings: "ml_settings",
  },
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  entries() { return this.get(this.keys.entries, []); },
  saveEntries(arr) { this.set(this.keys.entries, arr); },
  checkins() { return this.get(this.keys.checkins, []); },
  saveCheckins(arr) { this.set(this.keys.checkins, arr); },
  meds() { return this.get(this.keys.meds, []); },
  saveMeds(arr) { this.set(this.keys.meds, arr); },
  streak() { return this.get(this.keys.streak, { current: 0, longest: 0, lastDate: null }); },
  saveStreak(s) { this.set(this.keys.streak, s); },
  settings() { return this.get(this.keys.settings, { notifyEnabled: false }); },
  saveSettings(s) { this.set(this.keys.settings, s); },
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------
   2. STREAK LOGIC
   Counts consecutive days with at least one entry or check-in logged.
   --------------------------------------------------------------------- */
function bumpStreak() {
  const s = DB.streak();
  const today = todayKey();
  if (s.lastDate === today) return s; // already counted today
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  s.current = s.lastDate === yesterday ? s.current + 1 : 1;
  s.longest = Math.max(s.longest || 0, s.current);
  s.lastDate = today;
  DB.saveStreak(s);
  return s;
}
function currentStreakDisplay() {
  const s = DB.streak();
  const today = todayKey();
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  if (s.lastDate === today || s.lastDate === yesterday) return s.current;
  return 0; // streak lapsed
}

/* ---------------------------------------------------------------------
   3. TOAST
   --------------------------------------------------------------------- */
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------------------------------------------------------------------
   4. NAVIGATION
   --------------------------------------------------------------------- */
function initNav() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.target));
  });
}
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.dataset.view !== name;
  });
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.target === name);
  });
  const titles = {
    log: "Log", checkin: "Daily check-in", history: "History",
    insights: "Insights", meds: "Medications", settings: "More",
  };
  document.getElementById("topbar-title").textContent = titles[name] || "";
  if (name === "history") renderHistory();
  if (name === "insights") renderInsights();
  if (name === "meds") renderMeds();
  renderStreak();
  renderMonthStats();
}

/* ---------------------------------------------------------------------
   5. CHIP GROUPS (multi-select)
   --------------------------------------------------------------------- */
function initChipGroup(containerId) {
  const el = document.getElementById(containerId);
  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    btn.classList.toggle("is-selected");
  });
}
function selectedChips(containerId) {
  return [...document.querySelectorAll(`#${containerId} .chip.is-selected`)].map((b) => b.dataset.val);
}
function clearChips(containerId) {
  document.querySelectorAll(`#${containerId} .chip`).forEach((b) => b.classList.remove("is-selected"));
}

/* ---------------------------------------------------------------------
   6. LOG FORM
   --------------------------------------------------------------------- */
function nowLocalInputValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function initLogForm() {
  const modeNow = document.getElementById("mode-now");
  const modePast = document.getElementById("mode-past");
  const startInput = document.getElementById("start-time");

  function setMode(isPast) {
    modeNow.classList.toggle("is-active", !isPast);
    modePast.classList.toggle("is-active", isPast);
    modeNow.setAttribute("aria-selected", String(!isPast));
    modePast.setAttribute("aria-selected", String(isPast));
    if (!isPast) startInput.value = nowLocalInputValue();
  }
  modeNow.addEventListener("click", () => setMode(false));
  modePast.addEventListener("click", () => setMode(true));
  setMode(false);

  const painSlider = document.getElementById("pain-level");
  const painOut = document.getElementById("pain-level-out");
  painSlider.addEventListener("input", () => { painOut.textContent = painSlider.value; });

  const reliefSlider = document.getElementById("relief");
  const reliefOut = document.getElementById("relief-out");
  reliefSlider.addEventListener("input", () => {
    reliefOut.textContent = reliefSlider.value === "0" ? "—" : reliefSlider.value;
  });

  document.getElementById("entry-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const entries = DB.entries();
    const entry = {
      id: uid(),
      startTime: document.getElementById("start-time").value,
      endTime: document.getElementById("end-time").value || null,
      painLevel: Number(painSlider.value),
      location: selectedChips("chips-location"),
      symptoms: selectedChips("chips-symptoms"),
      triggers: selectedChips("chips-triggers"),
      medId: document.getElementById("med-select").value || null,
      relief: Number(reliefSlider.value) || null,
      notes: document.getElementById("notes").value.trim(),
      loggedRetroactively: modePast.classList.contains("is-active"),
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    DB.saveEntries(entries);
    bumpStreak();
    renderStreak();
    renderMonthStats();
    toast("Entry saved");
    e.target.reset();
    clearChips("chips-location");
    clearChips("chips-symptoms");
    clearChips("chips-triggers");
    painSlider.value = 5; painOut.textContent = "5";
    reliefSlider.value = 0; reliefOut.textContent = "—";
    setMode(false);
  });
}

/* ---------------------------------------------------------------------
   7. CHECK-IN FORM
   --------------------------------------------------------------------- */
function initCheckinForm() {
  const sq = document.getElementById("ci-sleep-quality");
  const sqOut = document.getElementById("ci-sleep-quality-out");
  sq.addEventListener("input", () => { sqOut.textContent = sq.value; });

  const st = document.getElementById("ci-stress");
  const stOut = document.getElementById("ci-stress-out");
  st.addEventListener("input", () => { stOut.textContent = st.value; });

  document.getElementById("checkin-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const checkins = DB.checkins();
    const today = todayKey();
    const existingIdx = checkins.findIndex((c) => c.date === today);
    const record = {
      date: today,
      sleepHours: Number(document.getElementById("ci-sleep").value) || null,
      sleepQuality: Number(sq.value),
      stressLevel: Number(st.value),
      water: Number(document.getElementById("ci-water").value) || null,
    };
    if (existingIdx >= 0) checkins[existingIdx] = record; else checkins.push(record);
    DB.saveCheckins(checkins);
    bumpStreak();
    renderStreak();
    document.getElementById("checkin-done-msg").hidden = false;
    toast("Check-in saved");
  });
}

/* ---------------------------------------------------------------------
   8. HISTORY VIEW
   --------------------------------------------------------------------- */
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function renderHistory() {
  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  const entries = [...DB.entries()].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  list.innerHTML = "";
  empty.hidden = entries.length > 0;

  const meds = DB.meds();
  entries.forEach((entry) => {
    const med = meds.find((m) => m.id === entry.medId);
    const card = document.createElement("div");
    card.className = "entry-card";
    const metaParts = [];
    if (entry.symptoms?.length) metaParts.push(entry.symptoms.join(", "));
    if (entry.triggers?.length) metaParts.push("Triggers: " + entry.triggers.join(", "));
    if (med) metaParts.push("Took: " + med.name);
    card.innerHTML = `
      <div class="entry-top">
        <span class="entry-date">${fmtDateTime(entry.startTime)}${entry.loggedRetroactively ? " · logged later" : ""}</span>
        <span class="entry-pain">${entry.painLevel}/10</span>
      </div>
      <div class="entry-meta">${metaParts.join(" — ") || "No further details"}</div>
      <div class="entry-actions">
        <button data-action="delete" data-id="${entry.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const remaining = DB.entries().filter((e) => e.id !== btn.dataset.id);
      DB.saveEntries(remaining);
      renderHistory();
      renderMonthStats();
      toast("Entry deleted");
    });
  });
}

/* ---------------------------------------------------------------------
   9. INSIGHTS VIEW
   --------------------------------------------------------------------- */
const TRIGGER_LABELS = {
  stress: "Stress", sleep: "Poor sleep", weather: "Weather", hormonal: "Hormonal",
  food: "Food / drink", screens: "Screen time", dehydration: "Dehydration",
  "skipped-meal": "Skipped meal", alcohol: "Alcohol",
};

function renderInsights() {
  const container = document.getElementById("insights-content");
  const entries = DB.entries();
  container.innerHTML = "";

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 30l8-10 7 6 9-14 8 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>Log a few migraines and this page will start surfacing patterns.</p>
      </div>`;
    return;
  }

  // Trigger frequency
  const counts = {};
  entries.forEach((e) => (e.triggers || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length ? sorted[0][1] : 1;

  const triggerCard = document.createElement("div");
  triggerCard.className = "insight-card";
  triggerCard.innerHTML = `<h3>Trigger frequency</h3>`;
  if (sorted.length === 0) {
    triggerCard.innerHTML += '<p class="muted-note">No triggers logged yet.</p>';
  } else {
    sorted.forEach(([key, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      triggerCard.innerHTML += `
        <div class="bar-row">
          <span class="bar-label">${TRIGGER_LABELS[key] || key}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
          <span class="bar-count">${count}</span>
        </div>`;
    });
    if (entries.length >= 5 && sorted[0]) {
      const [topKey, topCount] = sorted[0];
      const pctOfAll = Math.round((topCount / entries.length) * 100);
      triggerCard.innerHTML += `<p class="muted-note">${TRIGGER_LABELS[topKey] || topKey} shows up in ${pctOfAll}% of your logged migraines — a possible pattern, not a confirmed cause.</p>`;
    }
  }
  container.appendChild(triggerCard);

  // Averages
  const avgPain = (entries.reduce((s, e) => s + (e.painLevel || 0), 0) / entries.length).toFixed(1);
  const summaryCard = document.createElement("div");
  summaryCard.className = "insight-card";
  summaryCard.innerHTML = `
    <h3>Overview</h3>
    <p class="muted-note">${entries.length} migraine${entries.length === 1 ? "" : "s"} logged · average pain ${avgPain}/10</p>
  `;
  container.appendChild(summaryCard);

  // Medication effectiveness
  const meds = DB.meds();
  if (meds.length) {
    const medCard = document.createElement("div");
    medCard.className = "insight-card";
    medCard.innerHTML = `<h3>Medication effectiveness</h3>`;
    let any = false;
    meds.forEach((med) => {
      const used = entries.filter((e) => e.medId === med.id && e.relief != null);
      if (!used.length) return;
      any = true;
      const avgRelief = (used.reduce((s, e) => s + e.relief, 0) / used.length).toFixed(1);
      const pct = Math.round((avgRelief / 10) * 100);
      medCard.innerHTML += `
        <div class="bar-row">
          <span class="bar-label">${med.name}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
          <span class="bar-count">${avgRelief}</span>
        </div>`;
    });
    if (!any) medCard.innerHTML += '<p class="muted-note">Log relief level after taking a medication to see effectiveness here.</p>';
    container.appendChild(medCard);
  }
}

/* ---------------------------------------------------------------------
   10. MEDICATIONS
   --------------------------------------------------------------------- */
function refreshMedSelect() {
  const select = document.getElementById("med-select");
  const meds = DB.meds();
  select.innerHTML = '<option value="">None</option>' +
    meds.map((m) => `<option value="${m.id}">${m.name}${m.dose ? " — " + m.dose : ""}</option>`).join("");
}
function renderMeds() {
  const list = document.getElementById("med-list");
  const meds = DB.meds();
  list.innerHTML = meds.length ? "" : '<p class="empty-state">No medications added yet.</p>';
  meds.forEach((m) => {
    const card = document.createElement("div");
    card.className = "med-card";
    card.innerHTML = `
      <div class="med-info">
        <div class="med-name">${m.name}</div>
        <div class="med-sub">${m.dose ? m.dose + " · " : ""}${m.type}</div>
      </div>
      <button class="med-remove" data-id="${m.id}" aria-label="Remove">&times;</button>
    `;
    list.appendChild(card);
  });
  list.querySelectorAll(".med-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      DB.saveMeds(DB.meds().filter((m) => m.id !== btn.dataset.id));
      renderMeds();
      refreshMedSelect();
    });
  });
}
function initMedForm() {
  document.getElementById("med-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("med-name").value.trim();
    if (!name) return;
    const meds = DB.meds();
    meds.push({
      id: uid(),
      name,
      dose: document.getElementById("med-dose").value.trim(),
      type: document.getElementById("med-type").value,
    });
    DB.saveMeds(meds);
    e.target.reset();
    renderMeds();
    refreshMedSelect();
    toast("Medication added");
  });
}

/* ---------------------------------------------------------------------
   11. SETTINGS: export / import / notifications / wipe
   --------------------------------------------------------------------- */
function initSettings() {
  document.getElementById("btn-export").addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      entries: DB.entries(),
      checkins: DB.checkins(),
      meds: DB.meds(),
      streak: DB.streak(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migrainelog-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const status = document.getElementById("backup-status");
    status.hidden = false;
    status.textContent = "Backup file downloaded — save it in Files or iCloud Drive.";
  });

  document.getElementById("import-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data.entries)) DB.saveEntries(data.entries);
        if (Array.isArray(data.checkins)) DB.saveCheckins(data.checkins);
        if (Array.isArray(data.meds)) DB.saveMeds(data.meds);
        if (data.streak) DB.saveStreak(data.streak);
        refreshMedSelect();
        renderStreak();
        const status = document.getElementById("backup-status");
        status.hidden = false;
        status.textContent = "Backup restored.";
        toast("Data imported");
      } catch (err) {
        toast("That file couldn't be read");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("btn-notify").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      toast("Notifications aren't supported here");
      return;
    }
    const perm = await Notification.requestPermission();
    const settings = DB.settings();
    settings.notifyEnabled = perm === "granted";
    DB.saveSettings(settings);
    toast(perm === "granted" ? "Reminder check enabled" : "Permission not granted");
  });

  document.getElementById("btn-wipe").addEventListener("click", () => {
    if (!confirm("Delete all MigraineLog data from this browser? This can't be undone unless you have a backup file.")) return;
    Object.values(DB.keys).forEach((k) => localStorage.removeItem(k));
    location.reload();
  });
}

/* ---------------------------------------------------------------------
   12. ON-OPEN REMINDER CHECK
   True background push would require a server (and would break the
   zero-network-requests requirement), so the only honest option here is
   checking when the app is actually opened. If you haven't logged
   anything today, or haven't exported a backup in a while, show a gentle
   local notification / toast.
   --------------------------------------------------------------------- */
function checkOnOpenReminders() {
  const today = todayKey();
  const entries = DB.entries();
  const checkins = DB.checkins();
  const loggedToday = entries.some((e) => (e.startTime || "").startsWith(today))
    || checkins.some((c) => c.date === today);

  const settings = DB.settings();
  if (!loggedToday) {
    const msg = "You haven't logged anything today yet.";
    if (settings.notifyEnabled && "Notification" in window && Notification.permission === "granted") {
      new Notification("MigraineLog", { body: msg });
    }
  }
}

/* ---------------------------------------------------------------------
   13. STREAK + MONTH STATS RENDER
   --------------------------------------------------------------------- */
function renderStreak() {
  document.getElementById("streak-count").textContent = currentStreakDisplay();
}

function renderMonthStats() {
  const now = new Date();
  const ym = now.toISOString().slice(0, 7); // "YYYY-MM"
  const entries = DB.entries().filter((e) => (e.startTime || "").startsWith(ym));

  document.getElementById("stat-count").textContent = entries.length;

  const days = new Set(entries.map((e) => (e.startTime || "").slice(0, 10)));
  document.getElementById("stat-days").textContent = days.size;

  const painEl = document.getElementById("stat-pain");
  if (entries.length) {
    const avg = entries.reduce((s, e) => s + (e.painLevel || 0), 0) / entries.length;
    painEl.textContent = avg.toFixed(1);
  } else {
    painEl.textContent = "—";
  }
}

/* ---------------------------------------------------------------------
   14. BOOT
   --------------------------------------------------------------------- */
function startApp() {
  initNav();
  initChipGroup("chips-location");
  initChipGroup("chips-symptoms");
  initChipGroup("chips-triggers");
  initLogForm();
  initCheckinForm();
  initMedForm();
  initSettings();
  refreshMedSelect();
  renderMeds();
  renderStreak();
  renderMonthStats();
  checkOnOpenReminders();

  if (DB.checkins().some((c) => c.date === todayKey())) {
    document.getElementById("checkin-done-msg").hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  startApp();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
