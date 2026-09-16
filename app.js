(() => {
  "use strict";

  const RING_CIRCUMFERENCE = 2 * Math.PI * 90;

  const PHASE_COLORS = {
    warmup: getCssVar("--warmup"),
    sprint: getCssVar("--sprint"),
    rest: getCssVar("--rest"),
    cooldown: getCssVar("--cooldown"),
  };

  const PRESETS = {
    classic: { warmup: 10, sprint: 20, rest: 120, rounds: 10, cooldown: 0 },
    tabata: { warmup: 10, sprint: 20, rest: 10, rounds: 8, cooldown: 0 },
    hiit30: { warmup: 10, sprint: 30, rest: 30, rounds: 12, cooldown: 60 },
  };

  const STORAGE_KEY = "sprint-timer-config-v1";

  // ---------- DOM ----------
  const setupScreen = document.getElementById("setup-screen");
  const workoutScreen = document.getElementById("workout-screen");
  const doneScreen = document.getElementById("done-screen");

  const inputs = {
    warmup: document.getElementById("warmup"),
    sprint: document.getElementById("sprint"),
    rest: document.getElementById("rest"),
    rounds: document.getElementById("rounds"),
    cooldown: document.getElementById("cooldown"),
  };
  const soundToggle = document.getElementById("sound-toggle");
  const vibrateToggle = document.getElementById("vibrate-toggle");
  const planSummary = document.getElementById("plan-summary");
  const startBtn = document.getElementById("start-btn");
  const presetBtns = document.querySelectorAll(".preset-btn");

  const phaseLabel = document.getElementById("phase-label");
  const timeDisplay = document.getElementById("time-display");
  const roundLabel = document.getElementById("round-label");
  const upNext = document.getElementById("up-next");
  const ringFg = document.getElementById("ring-fg");
  const pauseBtn = document.getElementById("pause-btn");
  const skipBtn = document.getElementById("skip-btn");
  const stopBtn = document.getElementById("stop-btn");
  const doneSummary = document.getElementById("done-summary");
  const doneRestartBtn = document.getElementById("done-restart-btn");

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------- Config persistence ----------
  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved) {
        for (const key of Object.keys(inputs)) {
          if (saved[key] !== undefined) inputs[key].value = saved[key];
        }
        if (saved.sound !== undefined) soundToggle.checked = saved.sound;
        if (saved.vibrate !== undefined) vibrateToggle.checked = saved.vibrate;
      }
    } catch (e) { /* ignore corrupt storage */ }
  }

  function saveConfig() {
    const cfg = readConfig();
    cfg.sound = soundToggle.checked;
    cfg.vibrate = vibrateToggle.checked;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function readConfig() {
    return {
      warmup: clampInt(inputs.warmup.value, 0, 600, 0),
      sprint: clampInt(inputs.sprint.value, 1, 600, 20),
      rest: clampInt(inputs.rest.value, 0, 1200, 60),
      rounds: clampInt(inputs.rounds.value, 1, 99, 1),
      cooldown: clampInt(inputs.cooldown.value, 0, 600, 0),
    };
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function fmtDuration(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}min`;
    return `${m}min ${s}s`;
  }

  function updateSummary() {
    const cfg = readConfig();
    const workSeconds = cfg.sprint * cfg.rounds;
    const restSeconds = cfg.rest * Math.max(0, cfg.rounds - 1);
    const total = cfg.warmup + workSeconds + restSeconds + cfg.cooldown;
    planSummary.textContent =
      `${cfg.rounds} rounds · ${fmtDuration(cfg.sprint)} sprint / ${fmtDuration(cfg.rest)} rest ` +
      `· total ≈ ${fmtDuration(total)}`;
  }

  Object.values(inputs).forEach((el) => el.addEventListener("input", () => {
    updateSummary();
    presetBtns.forEach((b) => b.classList.remove("selected"));
  }));

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = PRESETS[btn.dataset.preset];
      for (const key of Object.keys(preset)) {
        inputs[key].value = preset[key];
      }
      presetBtns.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      updateSummary();
    });
  });

  loadConfig();
  updateSummary();

  // ---------- Audio ----------
  let audioCtx = null;
  function ensureAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, duration, when = 0, gainLevel = 0.35) {
    if (!soundToggle.checked) return;
    const ctx = ensureAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainLevel, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function tickBeep() { beep(880, 0.09); }
  function sprintStartBeep() {
    beep(1046.5, 0.15, 0);
    beep(1318.5, 0.22, 0.16);
  }
  function restStartBeep() { beep(523.25, 0.28, 0); }
  function finalDoneBeep() {
    beep(659, 0.14, 0);
    beep(659, 0.14, 0.18);
    beep(880, 0.35, 0.36);
  }

  function vibrate(pattern) {
    if (!vibrateToggle.checked) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ---------- Wake Lock ----------
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) { /* wake lock not available, ignore */ }
  }
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && running && !paused) {
      requestWakeLock();
    }
  });

  // ---------- Timer engine ----------
  // Build a flat list of phases: {type, seconds, roundIndex}
  let plan = [];
  let planIndex = 0;
  let phaseRemaining = 0;
  let running = false;
  let paused = false;
  let rafId = null;
  let phaseStartMs = 0;
  let phaseTotalMs = 0;
  let pausedRemainingMs = 0;
  let lastTickSecond = null;
  let totalRounds = 0;

  function buildPlan(cfg) {
    const p = [];
    if (cfg.warmup > 0) p.push({ type: "warmup", seconds: cfg.warmup });
    for (let i = 0; i < cfg.rounds; i++) {
      p.push({ type: "sprint", seconds: cfg.sprint, round: i + 1 });
      if (i < cfg.rounds - 1 && cfg.rest > 0) {
        p.push({ type: "rest", seconds: cfg.rest, round: i + 1 });
      }
    }
    if (cfg.cooldown > 0) p.push({ type: "cooldown", seconds: cfg.cooldown });
    return p;
  }

  function phaseTitle(type) {
    switch (type) {
      case "warmup": return "GET READY";
      case "sprint": return "SPRINT";
      case "rest": return "REST";
      case "cooldown": return "COOL DOWN";
      default: return "";
    }
  }

  function describePhase(phase) {
    if (!phase) return "Workout complete";
    if (phase.type === "sprint") return `Sprint (round ${phase.round})`;
    if (phase.type === "rest") return `Rest (round ${phase.round})`;
    if (phase.type === "warmup") return "Warm-up";
    return "Cool-down";
  }

  function startWorkout() {
    const cfg = readConfig();
    saveConfig();
    plan = buildPlan(cfg);
    totalRounds = cfg.rounds;
    if (plan.length === 0) return;
    planIndex = 0;
    running = true;
    paused = false;

    setupScreen.classList.add("hidden");
    doneScreen.classList.add("hidden");
    workoutScreen.classList.remove("hidden");

    ensureAudioCtx();
    requestWakeLock();

    enterPhase(0, true);
    rafId = requestAnimationFrame(tick);
  }

  function enterPhase(index, isFirst) {
    planIndex = index;
    const phase = plan[planIndex];
    if (!phase) {
      finishWorkout();
      return;
    }
    phaseTotalMs = phase.seconds * 1000;
    phaseStartMs = performance.now();
    lastTickSecond = null;

    phaseLabel.textContent = phaseTitle(phase.type);
    phaseLabel.style.color = PHASE_COLORS[phase.type] || "";
    ringFg.style.stroke = PHASE_COLORS[phase.type] || "";
    roundLabel.textContent = phase.type === "sprint" || phase.type === "rest"
      ? `Round ${phase.round} / ${totalRounds}`
      : (phase.type === "warmup" ? "Warming up" : "Cooling down");

    const next = plan[planIndex + 1];
    upNext.textContent = next ? `Next: ${describePhase(next)}` : "Next: Finish";

    if (!isFirst) {
      if (phase.type === "sprint") { sprintStartBeep(); vibrate([80, 60, 120]); }
      else if (phase.type === "rest") { restStartBeep(); vibrate(150); }
      else if (phase.type === "cooldown") { restStartBeep(); vibrate(150); }
    } else {
      vibrate(80);
    }

    updateDisplay(phase.seconds);
  }

  function updateDisplay(secondsLeft) {
    timeDisplay.textContent = String(Math.max(0, secondsLeft));
    const phase = plan[planIndex];
    const fraction = phase ? secondsLeft / phase.seconds : 0;
    const offset = RING_CIRCUMFERENCE * (1 - fraction);
    ringFg.style.strokeDashoffset = String(offset);
  }

  function tick(nowMs) {
    if (!running) return;
    if (paused) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    const elapsed = nowMs - phaseStartMs;
    const remainingMs = Math.max(0, phaseTotalMs - elapsed);
    const secondsLeft = Math.ceil(remainingMs / 1000);

    if (secondsLeft !== lastTickSecond) {
      lastTickSecond = secondsLeft;
      updateDisplay(secondsLeft);
      if (secondsLeft <= 3 && secondsLeft > 0) {
        tickBeep();
      }
    }

    if (remainingMs <= 0) {
      const isLast = planIndex >= plan.length - 1;
      if (isLast) {
        finishWorkout();
        return;
      }
      enterPhase(planIndex + 1, false);
    }

    rafId = requestAnimationFrame(tick);
  }

  function finishWorkout() {
    running = false;
    finalDoneBeep();
    vibrate([100, 60, 100, 60, 200]);
    releaseWakeLock();
    cancelAnimationFrame(rafId);
    workoutScreen.classList.add("hidden");
    doneScreen.classList.remove("hidden");
    const cfg = readConfig();
    const workSeconds = cfg.sprint * cfg.rounds;
    doneSummary.textContent = `${cfg.rounds} sprints completed · ${fmtDuration(workSeconds)} of work done. Nice.`;
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      pausedRemainingMs = phaseTotalMs - (performance.now() - phaseStartMs);
      pauseBtn.textContent = "Resume";
      releaseWakeLock();
    } else {
      phaseStartMs = performance.now() - (phaseTotalMs - pausedRemainingMs);
      pauseBtn.textContent = "Pause";
      requestWakeLock();
    }
  }

  function skipPhase() {
    if (!running) return;
    if (planIndex >= plan.length - 1) {
      finishWorkout();
    } else {
      enterPhase(planIndex + 1, false);
    }
  }

  function stopWorkout() {
    running = false;
    paused = false;
    releaseWakeLock();
    cancelAnimationFrame(rafId);
    workoutScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
    pauseBtn.textContent = "Pause";
  }

  // ---------- Events ----------
  startBtn.addEventListener("click", startWorkout);
  pauseBtn.addEventListener("click", togglePause);
  skipBtn.addEventListener("click", skipPhase);
  stopBtn.addEventListener("click", () => {
    if (confirm("End this workout?")) stopWorkout();
  });
  doneRestartBtn.addEventListener("click", () => {
    doneScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
  });

  // Prevent accidental navigation away mid-workout
  window.addEventListener("beforeunload", (e) => {
    if (running) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
