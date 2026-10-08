/* Real Sound: The Winds of Regret · subtitled audio player */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const CH = window.RS_CHAPTERS;
  const CHARS = window.RS_CHARACTERS;
  const params = new URLSearchParams(location.search);
  const REVIEW = params.has("review");
  // Opus (WebM) where supported; MP3 as a fallback for older browsers
  const AUDIO_EXT = document.createElement("audio").canPlayType('audio/webm; codecs="opus"') ? "webm" : "mp3";
  // audio paths come from /api/media when available; otherwise from audio/ directly
  const media = fetch("api/media", { headers: { "X-RS": "1" }, credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : r.status === 404 ? null : {})).catch(() => null);
  async function trackUrl(id) {
    const table = await media;
    if (!table) return `audio/${id}.webm`;
    const m = table[id] || {};
    return m[AUDIO_EXT] || m.webm || m.mp3 || "";
  }

  // ---------- saved state ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("rs." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("rs." + k, JSON.stringify(v)); } catch { /* no storage */ } },
  };
  const settings = Object.assign({ ja: false, size: 1, volume: 1, speed: 1 }, store.get("settings", {}));
  const positions = store.get("positions", {});

  // ---------- subtitles ----------
  window.RS_SUBS = window.RS_SUBS || {};
  const subsLoading = {};
  function loadSubs(id) {
    if (window.RS_SUBS[id]) return Promise.resolve(window.RS_SUBS[id]);
    const ch = CH.find((c) => c.id === id);
    if (!ch || !ch.subs) return Promise.resolve(null);
    if (!subsLoading[id]) {
      subsLoading[id] = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = `data/subs/${id}.js?v=${Date.now()}`;
        s.onload = () => resolve(window.RS_SUBS[id] || null);
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return subsLoading[id];
  }

  let trackIdx = 0;
  let subsEnd = 0;
  // notice shown when the track (or its current section) has no subtitles yet
  function updateCoverage() {
    const ch = CH[trackIdx];
    const partial = cues.length && ch.subsUntil && audio.currentTime > subsEnd + 5;
    $("noSubs").hidden = !(!cues.length || partial);
  }
  let cues = [];
  let activeCue = null;

  function findCue(t) {
    // last cue with start <= t (binary search), valid if t < end
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans >= 0 && t < cues[ans].end) return ans;
    return -1;
  }

  // ---------- dialogue box ----------
  const dlg = $("dialog"), dlgText = $("dlgText");
  const dlgLine = $("dlgLine"), dlgJa = $("dlgJa");
  let hideTimer = 0;

  function showCue(i) {
    if (i === activeCue) return;
    activeCue = i;
    clearTimeout(hideTimer);
    if (i < 0) {
      // a short delay avoids flicker between close lines
      hideTimer = setTimeout(() => dlg.classList.add("fade"), 400);
      renderReview();
      return;
    }
    const c = cues[i];
    const who = CHARS[c.speaker] || { name: c.speaker, color: "#c9c9c9" };
    dlg.hidden = false;
    dlg.classList.remove("fade");
    dlg.classList.toggle("mono", !!who.mono);
    dlg.classList.toggle("sfx", !!who.sfx);
    dlg.style.setProperty("--c", who.color);
    // double names on two lines ("少年・少女" / "Boy and Girl")
    $("dlgWhoJa").textContent = (who.ja || c.speaker).replace("・", "\n");
    $("dlgWhoName").textContent = (c.name || who.name).replace(" and ", "\nand ");
    $("dlgWhoTag").textContent = c.tag_en || who.sub || "";
    dlgLine.textContent = c.en;
    dlgJa.textContent = c.ja || "";
    dlgJa.hidden = !settings.ja || !c.ja;
    // restart the text fade-in animation
    dlgText.classList.remove("in");
    void dlgText.offsetWidth;
    dlgText.classList.add("in");
    renderReview();
  }

  // ---------- track ----------
  async function loadTrack(idx, { autoplay = false, at = null } = {}) {
    trackIdx = (idx + CH.length) % CH.length;
    const ch = CH[trackIdx];
    store.set("track", ch.id);
    $("nowTitle").textContent = ch.title;
    $("nowJa").textContent = ch.ja;
    $("nowNo").textContent = ch.bonus ? "★" : ch.id;
    $("startSub").textContent = `${ch.title} · ${Math.round(ch.duration / 60)} min`;
    audio.src = await trackUrl(ch.id);
    cues = [];
    activeCue = null;
    dlg.hidden = true;
    renderChapters();
    const start = at != null ? at : positions[ch.id] || 0;
    audio.addEventListener("loadedmetadata", () => {
      if (start > 0 && start < audio.duration - 2) audio.currentTime = start;
      if (autoplay) audio.play();
    }, { once: true });
    const data = await loadSubs(ch.id);
    if (CH[trackIdx] !== ch) return;
    cues = data ? data.cues : [];
    subsEnd = cues.length ? cues[cues.length - 1].end : 0;
    renderCueMarks();
    updateCoverage();
  }

  // ---------- progress bar ----------
  const progress = $("progress"), fill = $("progressFill"), knob = $("progressKnob");
  const dur = () => audio.duration || CH[trackIdx].duration;
  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
  };
  function renderProgress() {
    const p = Math.min(1, audio.currentTime / dur()) * 100 || 0;
    fill.style.width = p + "%";
    knob.style.left = p + "%";
    $("tCur").textContent = fmt(audio.currentTime);
    $("tDur").textContent = fmt(dur());
  }
  function renderCueMarks() {
    const box = $("progressCues");
    box.textContent = "";
    const d = dur();
    // merge nearby cues into blocks to avoid creating thousands of elements
    let a = null, b = null;
    const flush = () => {
      if (a == null) return;
      const i = document.createElement("i");
      i.style.left = (a / d) * 100 + "%";
      i.style.width = Math.max(0.15, ((b - a) / d) * 100) + "%";
      box.appendChild(i);
    };
    for (const c of cues) {
      if (a != null && c.start - b < 8) b = c.end;
      else { flush(); a = c.start; b = c.end; }
    }
    flush();
  }
  let dragging = false;
  function seekFromEvent(e) {
    const r = progress.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    audio.currentTime = p * dur();
    renderProgress();
  }
  progress.addEventListener("pointerdown", (e) => { dragging = true; progress.setPointerCapture(e.pointerId); seekFromEvent(e); });
  progress.addEventListener("pointermove", (e) => dragging && seekFromEvent(e));
  progress.addEventListener("pointerup", () => { dragging = false; });

  // ---------- sync loop ----------
  function tick() {
    if (cues.length) showCue(findCue(audio.currentTime));
    updateCoverage();
    if (!audio.paused) requestAnimationFrame(tick);
  }
  audio.addEventListener("play", () => { document.body.classList.add("is-playing"); requestAnimationFrame(tick); });
  audio.addEventListener("pause", () => { document.body.classList.remove("is-playing"); savePos(); });
  audio.addEventListener("seeked", () => { if (cues.length) showCue(findCue(audio.currentTime)); updateCoverage(); });
  audio.addEventListener("timeupdate", () => { renderProgress(); savePosThrottled(); });
  audio.addEventListener("durationchange", () => { renderProgress(); renderCueMarks(); });
  audio.addEventListener("ended", () => {
    positions[CH[trackIdx].id] = 0; store.set("positions", positions);
    if (trackIdx < CH.length - 1) loadTrack(trackIdx + 1, { autoplay: true, at: 0 });
  });

  let lastSave = 0;
  function savePos() { positions[CH[trackIdx].id] = audio.currentTime; store.set("positions", positions); }
  function savePosThrottled() { const n = Date.now(); if (n - lastSave > 3000) { lastSave = n; savePos(); } }

  // ---------- controls ----------
  const togglePlay = () => (audio.paused ? audio.play() : audio.pause());
  const skip = (s) => { audio.currentTime = Math.min(dur(), Math.max(0, audio.currentTime + s)); };
  function jumpCue(dir) {
    if (!cues.length) return skip(dir * 10);
    const t = audio.currentTime;
    let i;
    if (dir > 0) i = cues.findIndex((c) => c.start > t + 0.05);
    else {
      const cur = findCue(t);
      // back: if more than 1 s into the current line, restart that line
      if (cur >= 0 && t - cues[cur].start > 1) i = cur;
      else { i = -1; for (let k = cues.length - 1; k >= 0; k--) if (cues[k].start < t - 0.3 && k !== cur) { i = k; break; } }
    }
    if (i >= 0) audio.currentTime = Math.max(0, cues[i].start - 0.15);
  }

  // with the panel open, the player's play button also closes it
  $("btnPlay").onclick = () => (aboutOpen() && audio.paused ? closeAbout(true) : togglePlay());
  $("btnBack").onclick = () => skip(-10);
  $("btnFwd").onclick = () => skip(10);
  $("btnPrevCue").onclick = () => jumpCue(-1);
  $("btnNextCue").onclick = () => jumpCue(1);
  $("btnPrevTrack").onclick = () => (audio.currentTime > 5 ? (audio.currentTime = 0) : loadTrack(trackIdx - 1, { autoplay: !audio.paused, at: 0 }));
  $("btnNextTrack").onclick = () => loadTrack(trackIdx + 1, { autoplay: !audio.paused, at: 0 });

  const vol = $("volume"), btnMute = $("btnMute");
  function setVolume(v) {
    audio.volume = settings.volume = Math.min(1, Math.max(0, v));
    audio.muted = false;
    vol.value = audio.volume;
    btnMute.classList.toggle("muted", audio.volume === 0);
    saveSettings();
  }
  vol.value = audio.volume = settings.volume;
  vol.oninput = () => setVolume(+vol.value);
  btnMute.onclick = () => { audio.muted = !audio.muted; btnMute.classList.toggle("muted", audio.muted || audio.volume === 0); };

  const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5];
  const btnSpeed = $("btnSpeed");
  function applySpeed() {
    audio.playbackRate = settings.speed;
    btnSpeed.textContent = (Number.isInteger(settings.speed) ? settings.speed.toFixed(1) : String(settings.speed)) + "×";
  }
  btnSpeed.onclick = () => { settings.speed = SPEEDS[(SPEEDS.indexOf(settings.speed) + 1) % SPEEDS.length]; applySpeed(); saveSettings(); };
  audio.addEventListener("loadedmetadata", applySpeed);
  applySpeed();

  const btnJa = $("btnJa");
  function applyJa() {
    btnJa.setAttribute("aria-pressed", settings.ja);
    const c = activeCue >= 0 ? cues[activeCue] : null;
    dlgJa.hidden = !settings.ja || !(c && c.ja);
  }
  btnJa.onclick = () => { settings.ja = !settings.ja; applyJa(); saveSettings(); };
  applyJa();

  const SIZES = [0.85, 1, 1.2, 1.4];
  function applySize() { document.documentElement.style.setProperty("--sub-scale", settings.size); }
  $("btnSize").onclick = () => { settings.size = SIZES[(SIZES.indexOf(settings.size) + 1) % SIZES.length]; applySize(); saveSettings(); };
  applySize();

  $("btnFull").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  function saveSettings() { store.set("settings", settings); }

  // ---------- chapters ----------
  const drawer = $("chapters");
  $("btnChapters").onclick = () => { drawer.hidden = !drawer.hidden; };
  $("btnCloseChapters").onclick = () => { drawer.hidden = true; };
  function renderChapters() {
    const ol = $("chapterList");
    ol.textContent = "";
    CH.forEach((c, i) => {
      const li = document.createElement("li");
      if (i === trackIdx) li.className = "current";
      const b = document.createElement("button");
      const badge = !c.subs ? "Subtitles coming soon"
        : c.subsUntil ? `Subtitled up to ${fmt(c.subsUntil)} · preview` : "Subtitled";
      b.innerHTML = `<span class="n">${c.bonus ? "★" : String(i + 1).padStart(2, "0")}</span>
        <span class="t">${c.title}<small>${c.ja}</small><span class="badge${c.subs ? " on" : ""}">${badge}</span></span>
        <span class="d">${fmt(c.duration)}</span>`;
      b.onclick = () => { drawer.hidden = true; loadTrack(i, { autoplay: true }); };
      li.appendChild(b);
      ol.appendChild(li);
    });
  }

  // ---------- about panel ----------
  const about = $("about");
  const body = document.body;
  // once the listener has started, the panel no longer opens by itself
  let started = store.get("started", false);
  function markStarted() { if (!started) { started = true; store.set("started", true); } }
  audio.addEventListener("play", markStarted);
  function closeAbout(play) {
    about.classList.add("leaving");
    setTimeout(() => {
      about.classList.remove("leaving");
      body.classList.remove("is-intro", "about-open");
      body.classList.add("is-listening");
    }, 300);
    if (play) { markStarted(); audio.play(); }
  }
  function openAbout() {
    if (body.classList.contains("about-open")) return closeAbout(false);
    body.classList.add("about-open");
    $("btnStart").hidden = started;
    $("btnAboutClose").hidden = !started;
  }
  $("btnStart").onclick = () => closeAbout(true);
  $("btnAboutClose").onclick = () => closeAbout(false);
  $("btnAbout").onclick = openAbout;
  const aboutOpen = () => body.classList.contains("is-intro") || body.classList.contains("about-open");

  // tabs
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  tabs.forEach((t) => {
    t.onclick = () => {
      tabs.forEach((x) => {
        const on = x === t;
        x.setAttribute("aria-selected", on);
        $(x.dataset.tab).hidden = !on;
      });
    };
  });

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea")) return;
    if (aboutOpen()) {
      if (e.key === "Escape" && started) return closeAbout(false);
      if (e.key === "Enter" && !started && !e.target.closest("button")) return closeAbout(true);
      if (!started) {
        if (e.key === " " && !e.target.closest("button")) { e.preventDefault(); closeAbout(true); }
        return;
      }
    }
    if (REVIEW && reviewKey(e)) return;
    const k = e.key;
    if (k === " ") { e.preventDefault(); togglePlay(); }
    else if (k === "ArrowLeft") skip(e.shiftKey ? -30 : -5);
    else if (k === "ArrowRight") skip(e.shiftKey ? 30 : 5);
    else if (k === "ArrowUp") { e.preventDefault(); setVolume(audio.volume + 0.1); }
    else if (k === "ArrowDown") { e.preventDefault(); setVolume(audio.volume - 0.1); }
    else if (k === ",") jumpCue(-1);
    else if (k === ".") jumpCue(1);
    else if (k === "j" || k === "J") btnJa.click();
    else if (k === "f" || k === "F") $("btnFull").click();
    else if (k === "Escape") drawer.hidden = true;
  });

  // ---------- review mode (?review=1) ----------
  const reviewBox = $("review");
  function renderReview() {
    if (!REVIEW) return;
    reviewBox.hidden = false;
    const i = activeCue;
    const c = i >= 0 ? cues[i] : null;
    reviewBox.textContent =
      `REVIEW · t=${audio.currentTime.toFixed(2)}  rate=${audio.playbackRate}\n` +
      (c ? `#${c.id}  ${c.start.toFixed(2)} → ${c.end.toFixed(2)}  [${c.speaker}]${c.flag ? "  ⚑ " + c.flag : ""}\n${c.ja}\n` : "(no line)\n") +
      `\n[ / ]  start −/+0.1   { / }  end −/+0.1\nS  set start = now   E  set end = now\nX  export JSON`;
  }
  function reviewKey(e) {
    const i = activeCue >= 0 ? activeCue : null;
    const target = i != null ? cues[i] : cues[findPrev()];
    const k = e.key;
    const adj = { "[": ["start", -0.1], "]": ["start", 0.1], "{": ["end", -0.1], "}": ["end", 0.1] }[k];
    if (adj && target) { target[adj[0]] = +(target[adj[0]] + adj[1]).toFixed(2); target.edited = true; renderReview(); return true; }
    if ((k === "s" || k === "S") && target) { target.start = +audio.currentTime.toFixed(2); target.edited = true; renderReview(); return true; }
    if ((k === "e" || k === "E") && target) { target.end = +audio.currentTime.toFixed(2); target.edited = true; renderReview(); return true; }
    if (k === "x" || k === "X") {
      const blob = new Blob([JSON.stringify({ track: CH[trackIdx].id, cues }, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `subs-${CH[trackIdx].id}-reviewed.json`;
      a.click();
      return true;
    }
    return false;
  }
  function findPrev() {
    const t = audio.currentTime;
    for (let k = cues.length - 1; k >= 0; k--) if (cues[k].start <= t) return k;
    return 0;
  }
  if (REVIEW) setInterval(renderReview, 250);

  // ---------- video background ----------
  const bgVideo = $("bgVideo");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) bgVideo.pause();
  else {
    const playBg = () => bgVideo.play().catch(() => {});  // muted autoplay; if blocked, the poster stays
    playBg();
    // tab opened in the background: the browser defers autoplay; resume once visible
    document.addEventListener("visibilitychange", () => { if (!document.hidden && bgVideo.paused) playBg(); });
  }

  // ---------- title: center of the free space between masthead and dock ----------
  const bgTitle = document.querySelector(".bg-title");
  const mast = document.querySelector(".masthead");
  const dock = document.querySelector(".dock");
  function placeTitle() {
    const top = mast.getBoundingClientRect().bottom;
    const h = bgTitle.offsetHeight || 1;
    let bottom, limit;
    if (aboutOpen()) bottom = limit = dock.offsetTop + about.offsetTop;   // offsetTop ignores the panel animation
    else {
      // exact center between masthead and player; the dialogue box only limits the size
      bottom = dock.offsetTop + $("player").offsetTop;
      const reserve = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dlg-reserve")) || 0;
      limit = bottom - reserve;
    }
    const center = top + (bottom - top) / 2;
    const room = Math.min(bottom - top, 2 * (limit - center - 8));      // height available without overlapping the dialogue box
    const scale = Math.max(0, Math.min(1, (room * 0.86) / h));
    bgTitle.style.setProperty("--ty", `${center}px`);
    bgTitle.style.setProperty("--ts", scale.toFixed(3));
    bgTitle.classList.toggle("squeezed", scale < 0.35);
  }
  const queuePlace = () => placeTitle();  // synchronous layout read; does not depend on rAF
  new ResizeObserver(queuePlace).observe(dock);
  new MutationObserver(queuePlace).observe(body, { attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", queuePlace);
  function firstPlace() {
    placeTitle();
    setTimeout(() => bgTitle.classList.add("placed"), 60);  // no slide the first time
  }
  if (bgTitle.complete) firstPlace(); else bgTitle.addEventListener("load", firstPlace, { once: true });

  // ---------- light protection: no context menu, dragging, selection or source shortcuts ----------
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dragstart", (e) => e.preventDefault());
  document.addEventListener("selectstart", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (k === "f12" || (ctrl && (k === "s" || k === "u" || k === "p")) ||
        (ctrl && e.shiftKey && (k === "i" || k === "j" || k === "c"))) e.preventDefault();
  }, true);

  // ---------- startup ----------
  const savedTrack = store.get("track", "01");
  const idx = Math.max(0, CH.findIndex((c) => c.id === savedTrack));
  loadTrack(idx);
  const pos = positions[CH[idx].id];
  if (pos > 5) $("startSub").textContent = `Continue · ${CH[idx].title}, ${fmt(pos)}`;
  if (started || params.has("skip")) {
    body.classList.remove("is-intro");
    body.classList.add("is-listening");
  }
})();
