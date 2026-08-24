const APP_VERSION = "v54";
const TA_SECONDS = 0.008;

/* ============================================================
   Config model: appliedConfig is the committed source of truth.
   pendingConfig is derived live from sidebar inputs / RGE pins
   and only written into appliedConfig when Apply is clicked.
   ============================================================ */

let appliedConfig = {
  tuSeconds: 60,
  tdSeconds: 60,
  nrm: 1,
  hotMin: 180,
  warmMin: 270,
  coldMin: 450,
  referenceY: 572,
  refActivePower: 710,
  mwLossFactor: 1.5,
  resumptionHr: 4,
  penaltyRate: 428.6801,
  rampRateAfterFix: 6000,
  tripFloorMw: 340,
  tripRestartMin: 300
};

let execState = {
  scenario: null,
  resetY: 0,
  penaltyRate: 428.6801
};

let revealed = false;

/* ---------- DOM: shared ---------- */

const bodyEl = document.body;
const viewSwitchButtons = document.querySelectorAll(".view-switch button");

/* ---------- DOM: technical ---------- */

const inputs = {
  initialY: document.querySelector("#initialYInput"),
  x: document.querySelector("#xInput"),
  xSlider: document.querySelector("#xSlider"),
  tu: document.querySelector("#tuInput"),
  td: document.querySelector("#tdInput"),
  timeUnit: document.querySelector("#timeUnitInput"),
  nrm: document.querySelector("#nrmInput"),
  hotMin: document.querySelector("#hotMinInput"),
  warmMin: document.querySelector("#warmMinInput"),
  coldMin: document.querySelector("#coldMinInput"),
  referenceY: document.querySelector("#referenceYInput"),
  refActivePower: document.querySelector("#refActivePowerInput"),
  mwLossFactor: document.querySelector("#mwLossFactorInput"),
  resumptionHr: document.querySelector("#resumptionHrInput"),
  tuAfterFix: document.querySelector("#tuAfterFixInput"),
  tripFloorMw: document.querySelector("#tripFloorMwInput"),
  tripRestartMin: document.querySelector("#tripRestartMinInput"),
  window: document.querySelector("#windowInput")
};

const chartFrame = document.querySelector(".chart-frame");
const chart = document.querySelector("#chart");
const ctx = chart.getContext("2d");
const xReadout = document.querySelector("#xReadout");
const yReadout = document.querySelector("#yReadout");
const mwReadout = document.querySelector("#mwReadout");
const mwLossReadout = document.querySelector("#mwLossReadout");
const rateReadout = document.querySelector("#rateReadout");
const countdownReadout = document.querySelector("#countdownReadout");
const runToggle = document.querySelector("#runToggle");
const resetButton = document.querySelector("#resetButton");
const clearButton = document.querySelector("#clearButton");
const blockX = document.querySelector("#blockX");
const blockNrm = document.querySelector("#blockNrm");
const blockTu = document.querySelector("#blockTu");
const blockTd = document.querySelector("#blockTd");
const blockY = document.querySelector("#blockY");
const blockYa = document.querySelector("#blockYa");
const blockRate = document.querySelector("#blockRate");
const rgeDiagram = document.querySelector(".rge-diagram");

const controlsPanel = document.querySelector("#controlsPanel");
const controlsBackdrop = document.querySelector("#controlsBackdrop");
const controlsClose = document.querySelector("#controlsClose");
const mobileMenuToggle = document.querySelector("#mobileMenuToggle");
const mobileRunToggle = document.querySelector("#mobileRunToggle");
const mobileResetButton = document.querySelector("#mobileResetButton");

const applyBar = document.querySelector("#applyBar");
const applyBarText = document.querySelector("#applyBarText");
const applyButton = document.querySelector("#applyButton");
const discardButton = document.querySelector("#discardButton");

let history = [];
let currentTimeUnit = "min";
let state = {
  running: true,
  elapsed: 0,
  xTarget: 572,
  y: 572,
  lastYa: 0,
  lastFrame: performance.now(),
  accumulator: 0
};

/* ---------- helpers ---------- */

function numberValue(input, fallback) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function secondsPerUnit(unit) {
  if (unit === "ms") return 0.001;
  if (unit === "sec") return 1;
  return 60;
}

function formatBaht(value) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: value >= 100 ? 0 : 2 });
}

function formatBahtCompact(value) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return value.toFixed(0);
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.substring(0, 2), 16);
  const g = Number.parseInt(clean.substring(2, 4), 16);
  const b = Number.parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatHoursMinutes(totalMinutes) {
  const safe = Math.max(0, totalMinutes);
  let h = Math.floor(safe / 60);
  let m = Math.round(safe - h * 60);
  if (m === 60) {
    m = 0;
    h += 1;
  }
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatCountdown(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  if (safe < 60) return `${safe.toFixed(1)}s`;
  if (safe < 3600) {
    const m = Math.floor(safe / 60);
    const s = Math.round(safe - m * 60);
    if (s === 60) return `${m + 1}m 00s`;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(safe / 3600);
  let m = Math.round((safe - h * 3600) / 60);
  if (m === 60) return `${h + 1}h 00m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatTimeValue(value, unit) {
  if (unit === "ms") return `${value.toFixed(0)} ms`;
  if (value >= 100) return `${value.toFixed(0)} ${unit}`;
  return `${value.toFixed(3).replace(/\.?0+$/, "")} ${unit}`;
}

/* ============================================================
   Pending / Apply flow
   ============================================================ */

const PENDING_FIELDS = [
  { key: "nrm", input: inputs.nrm, min: 0.01 },
  { key: "hotMin", input: inputs.hotMin, min: 1 },
  { key: "warmMin", input: inputs.warmMin, min: 1 },
  { key: "coldMin", input: inputs.coldMin, min: 1 },
  { key: "referenceY", input: inputs.referenceY, min: -1000 },
  { key: "refActivePower", input: inputs.refActivePower, min: 0 },
  { key: "mwLossFactor", input: inputs.mwLossFactor, min: 0 },
  { key: "resumptionHr", input: inputs.resumptionHr, min: 0 },
  { key: "rampRateAfterFix", input: inputs.tuAfterFix, min: 0.01 },
  { key: "tripFloorMw", input: inputs.tripFloorMw, min: 0 },
  { key: "tripRestartMin", input: inputs.tripRestartMin, min: 0 }
];

function typedTuSeconds() {
  return Math.max(0.001, numberValue(inputs.tu, 1)) * secondsPerUnit(inputs.timeUnit.value);
}

function typedTdSeconds() {
  return Math.max(0.001, numberValue(inputs.td, 1)) * secondsPerUnit(inputs.timeUnit.value);
}

function refreshPending() {
  let pendingCount = 0;

  const tuPending = Math.abs(typedTuSeconds() - appliedConfig.tuSeconds) > 0.0005;
  const tdPending = Math.abs(typedTdSeconds() - appliedConfig.tdSeconds) > 0.0005;
  setFieldPendingUI(inputs.tu, tuPending);
  setFieldPendingUI(inputs.td, tdPending);
  setPinPendingUI("tu", tuPending);
  setPinPendingUI("td", tdPending);
  if (tuPending) pendingCount += 1;
  if (tdPending) pendingCount += 1;

  PENDING_FIELDS.forEach((field) => {
    const typed = Math.max(field.min, numberValue(field.input, appliedConfig[field.key]));
    const isPending = Math.abs(typed - appliedConfig[field.key]) > 0.0005;
    setFieldPendingUI(field.input, isPending);
    if (field.key === "nrm") setPinPendingUI("nrm", isPending);
    if (isPending) pendingCount += 1;
  });

  if (pendingCount > 0) {
    applyBar.classList.add("visible");
    applyBarText.textContent = `${pendingCount} ค่ายังไม่ยืนยัน — คลิก Apply เพื่อนำไปใช้`;
  } else {
    applyBar.classList.remove("visible");
  }
}

function setFieldPendingUI(input, isPending) {
  if (!input) return;
  input.classList.toggle("field-pending", isPending);
}

function setPinPendingUI(pinKey, isPending) {
  const pin = rgeDiagram.querySelector(`.pin[data-pin="${pinKey}"]`);
  if (pin) pin.classList.toggle("pending", isPending);
}

function applyAllChanges() {
  appliedConfig.tuSeconds = typedTuSeconds();
  appliedConfig.tdSeconds = typedTdSeconds();
  PENDING_FIELDS.forEach((field) => {
    appliedConfig[field.key] = Math.max(field.min, numberValue(field.input, appliedConfig[field.key]));
  });

  execState.penaltyRate = appliedConfig.penaltyRate;

  refreshPending();
  renderExecutive();
  render(getSettings());
}

function discardAllChanges() {
  currentTimeUnit = inputs.timeUnit.value;
  inputs.tu.value = (appliedConfig.tuSeconds / secondsPerUnit(currentTimeUnit)).toFixed(currentTimeUnit === "ms" ? 0 : 3);
  inputs.td.value = (appliedConfig.tdSeconds / secondsPerUnit(currentTimeUnit)).toFixed(currentTimeUnit === "ms" ? 0 : 3);
  PENDING_FIELDS.forEach((field) => {
    field.input.value = appliedConfig[field.key];
  });
  refreshPending();
}

applyButton.addEventListener("click", applyAllChanges);
discardButton.addEventListener("click", discardAllChanges);

[inputs.nrm, inputs.hotMin, inputs.warmMin, inputs.coldMin, inputs.referenceY, inputs.refActivePower,
  inputs.mwLossFactor, inputs.resumptionHr, inputs.tuAfterFix,
  inputs.tripFloorMw, inputs.tripRestartMin,
  inputs.tu, inputs.td].forEach((el) => el.addEventListener("input", refreshPending));

inputs.timeUnit.addEventListener("change", () => {
  convertTimeInputs(inputs.timeUnit.value);
  refreshPending();
});

function convertTimeInputs(nextUnit) {
  const prevMultiplier = secondsPerUnit(currentTimeUnit);
  const nextMultiplier = secondsPerUnit(nextUnit);
  const tuSeconds = numberValue(inputs.tu, 1) * prevMultiplier;
  const tdSeconds = numberValue(inputs.td, 1) * prevMultiplier;
  inputs.tu.value = Math.max(0.001, tuSeconds / nextMultiplier).toFixed(nextUnit === "ms" ? 0 : 3);
  inputs.td.value = Math.max(0.001, tdSeconds / nextMultiplier).toFixed(nextUnit === "ms" ? 0 : 3);
  currentTimeUnit = nextUnit;
}

/* ============================================================
   RGE sandbox simulation (X / initial Y are immediate, no Apply)
   ============================================================ */

function getSettings() {
  return {
    initialY: numberValue(inputs.initialY, 572),
    x: state.xTarget,
    tuSeconds: appliedConfig.tuSeconds,
    tdSeconds: appliedConfig.tdSeconds,
    tuValue: appliedConfig.tuSeconds / secondsPerUnit(inputs.timeUnit.value),
    tdValue: appliedConfig.tdSeconds / secondsPerUnit(inputs.timeUnit.value),
    timeUnit: inputs.timeUnit.value,
    nrm: Math.max(0.01, appliedConfig.nrm),
    referenceY: appliedConfig.referenceY,
    refActivePower: appliedConfig.refActivePower,
    mwLossFactor: appliedConfig.mwLossFactor,
    tripFloorMw: appliedConfig.tripFloorMw,
    windowSeconds: Math.max(30, numberValue(inputs.window, 180))
  };
}

function mwFromY(y, settings) {
  const gap = Math.max(0, settings.referenceY - y);
  const rawLoss = gap * settings.mwLossFactor;
  const maxLoss = Math.max(0, settings.refActivePower - settings.tripFloorMw);
  const loss = Math.min(rawLoss, maxLoss);
  return settings.refActivePower - loss;
}

function stepRge(settings) {
  const error = settings.x - state.y;
  if (Math.abs(error) < 0.0000001) {
    state.lastYa = 0;
    return;
  }
  const timeConstant = error > 0 ? settings.tuSeconds : settings.tdSeconds;
  const maxStep = (TA_SECONDS / timeConstant) * settings.nrm;
  const ya = clamp(error, -maxStep, maxStep);
  state.y += ya;
  state.lastYa = ya;
}

function sample(settings) {
  const mw = mwFromY(state.y, settings);
  return {
    time: state.elapsed,
    x: settings.x,
    y: state.y,
    mw
  };
}

function resetAll() {
  const settings = getSettings();
  state.elapsed = 0;
  state.xTarget = settings.x;
  state.y = settings.initialY;
  state.lastYa = 0;
  state.accumulator = 0;
  state.lastFrame = performance.now();
  history = [sample(settings)];
  render(settings);
}

function clearTrace() {
  const settings = getSettings();
  state.elapsed = 0;
  state.accumulator = 0;
  state.lastFrame = performance.now();
  history = [sample(settings)];
  render(settings);
}

function tick(now) {
  if (!bodyEl.classList.contains("view-technical")) {
    state.lastFrame = now;
    requestAnimationFrame(tick);
    return;
  }
  const settings = getSettings();
  syncSliderToX(settings.x);
  const frameDt = Math.min(0.25, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;

  if (state.running) {
    state.accumulator += frameDt;
    const cycles = Math.min(2000, Math.floor(state.accumulator / TA_SECONDS));
    for (let i = 0; i < cycles; i += 1) {
      stepRge(settings);
      state.elapsed += TA_SECONDS;
      history.push(sample(settings));
    }
    state.accumulator -= cycles * TA_SECONDS;
  }

  trimHistory(settings.windowSeconds);
  render(settings);
  requestAnimationFrame(tick);
}

function trimHistory(windowSeconds) {
  const start = Math.max(0, state.elapsed - windowSeconds);
  while (history.length > 2 && history[1].time < start) history.shift();
}

function render(settings) {
  if (history.length === 0) history = [sample(settings)];
  const last = history[history.length - 1];
  const liveMw = mwFromY(state.y, settings);
  const liveLoss = Math.max(0, settings.refActivePower - liveMw);
  const liveRate = currentRampRate(settings);
  xReadout.textContent = `${settings.x.toFixed(2)} C`;
  yReadout.textContent = `${last.y.toFixed(3)} C`;
  mwReadout.textContent = `${liveMw.toFixed(2)} MW`;
  mwLossReadout.textContent = `${liveLoss.toFixed(2)} MW`;
  rateReadout.textContent = `${liveRate.toFixed(3)} C/min`;

  const errorNow = settings.x - state.y;
  const absErrorNow = Math.abs(errorNow);
  if (absErrorNow < 0.0005) {
    countdownReadout.textContent = "ถึง X Target แล้ว";
    countdownReadout.classList.add("reached");
  } else {
    const timeConstantNow = errorNow > 0 ? settings.tuSeconds : settings.tdSeconds;
    const secondsRemaining = (absErrorNow * timeConstantNow) / settings.nrm;
    countdownReadout.textContent = `~${formatCountdown(secondsRemaining)}`;
    countdownReadout.classList.remove("reached");
  }

  renderRgeBlock(settings);
  renderChart(settings);
}

function renderRgeBlock(settings) {
  blockX.textContent = `${settings.x.toFixed(2)} C`;
  blockNrm.textContent = `${settings.nrm.toFixed(2)} C`;
  blockTu.textContent = formatTimeValue(settings.tuValue, settings.timeUnit);
  blockTd.textContent = formatTimeValue(settings.tdValue, settings.timeUnit);
  blockY.textContent = `${state.y.toFixed(3)} C`;
  blockYa.textContent = `${state.lastYa.toFixed(9)} C`;
  blockRate.textContent = `${currentRampRate(settings).toFixed(3)} C/min`;
}

function currentRampRate(settings) {
  const error = settings.x - state.y;
  if (Math.abs(error) < 0.0000001) return 0;
  const seconds = error > 0 ? settings.tuSeconds : settings.tdSeconds;
  const direction = error > 0 ? 1 : -1;
  return direction * (settings.nrm / seconds) * 60;
}

function renderChart(settings) {
  const rect = chartFrame.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(280, rect.width);
  const height = Math.max(220, rect.height);
  chart.width = Math.round(width * scale);
  chart.height = Math.round(height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const pad = { left: 58, right: 16, top: 16, bottom: 32 };
  const gap = 26;
  const paneH = (height - pad.top - pad.bottom - gap) / 2;
  const tempPane = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: paneH };
  const mwPane = { x: pad.left, y: pad.top + paneH + gap, w: width - pad.left - pad.right, h: paneH };
  const windowStart = Math.max(0, state.elapsed - settings.windowSeconds);
  const windowEnd = windowStart + settings.windowSeconds;

  const tempAxis = axisFor(history.flatMap((row) => [row.x, row.y, 0, settings.referenceY]), 2);
  const mwAxis = axisFor(history.map((row) => row.mw).concat([settings.refActivePower, settings.tripFloorMw]), 2, { floor: 0 });
  const xFor = (time) => tempPane.x + ((time - windowStart) / settings.windowSeconds) * tempPane.w;
  const tempY = (value) => tempPane.y + (1 - (value - tempAxis.min) / (tempAxis.max - tempAxis.min)) * tempPane.h;
  const mwY = (value) => mwPane.y + (1 - (value - mwAxis.min) / (mwAxis.max - mwAxis.min)) * mwPane.h;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1319";
  ctx.fillRect(0, 0, width, height);
  drawGrid(tempPane, windowStart, windowEnd, tempAxis, "Temperature C");
  drawGrid(mwPane, windowStart, windowEnd, mwAxis, "Predicted MW");
  drawReferenceLine(tempPane, tempY, settings.referenceY, `${settings.referenceY.toFixed(1)} C`, "#3f5560");
  drawReferenceLine(mwPane, mwY, settings.refActivePower, `${settings.refActivePower.toFixed(0)} MW`, "#3f5560");
  const latestMw = history.length > 0 ? history[history.length - 1].mw : mwFromY(state.y, settings);
  if (Math.abs(latestMw - settings.tripFloorMw) < 0.5) {
    drawReferenceLine(mwPane, mwY, settings.tripFloorMw, "Trip Floor", "#fb5d6f", "left");
  }
  drawSeries(history, xFor, tempY, "x", "#2dd9c2", [8, 6], 2);
  drawSeries(history, xFor, tempY, "y", "#f5a524", [], 2.6);
  drawSeries(history, xFor, mwY, "mw", "#35d68f", [], 2.6);
}

function axisFor(values, minSpan, options = {}) {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const mid = (minValue + maxValue) / 2;
  const span = Math.max(minSpan, maxValue - minValue);
  let min = mid - span * 0.62;
  let max = mid + span * 0.62;
  if (Number.isFinite(options.floor)) {
    min = Math.max(options.floor, min);
    max = Math.max(max, options.floor + minSpan);
  }
  return { min, max };
}

function drawGrid(pane, windowStart, windowEnd, axis, label) {
  ctx.save();
  ctx.strokeStyle = "#1c2a34";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#6d828f";
  ctx.font = "11px IBM Plex Mono, monospace";

  for (let i = 0; i <= 4; i += 1) {
    const y = pane.y + (pane.h / 4) * i;
    const value = axis.max - ((axis.max - axis.min) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pane.x, y);
    ctx.lineTo(pane.x + pane.w, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), 6, y + 4);
  }

  for (let i = 0; i <= 5; i += 1) {
    const x = pane.x + (pane.w / 5) * i;
    const time = windowStart + ((windowEnd - windowStart) / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, pane.y);
    ctx.lineTo(x, pane.y + pane.h);
    ctx.stroke();
    ctx.fillText(`${time.toFixed(0)}s`, x - 10, pane.y + pane.h + 16);
  }

  ctx.strokeStyle = "#324451";
  ctx.strokeRect(pane.x, pane.y, pane.w, pane.h);
  ctx.fillStyle = "#dfe9ec";
  ctx.font = "700 11px IBM Plex Sans, sans-serif";
  ctx.fillText(label, pane.x + 8, pane.y + 15);
  ctx.restore();
}

function drawReferenceLine(pane, yFor, value, label, color, align = "right") {
  const y = yFor(value);
  if (y < pane.y || y > pane.y + pane.h) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  ctx.moveTo(pane.x, y);
  ctx.lineTo(pane.x + pane.w, y);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "10px IBM Plex Mono, monospace";
  const labelX = align === "left" ? pane.x + 8 : pane.x + pane.w - 58;
  ctx.fillText(label, labelX, y - 5);
  ctx.restore();
}

function drawSeries(rows, xFor, yFor, key, color, dash, lineWidth) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash);
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = xFor(row.time);
    const y = yFor(row[key]);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function setX(value) {
  if (!Number.isFinite(value)) return;
  state.xTarget = value;
  inputs.x.value = value.toFixed(1);
  syncSliderToX(value);
}

function syncSliderToX(x) {
  const minX = Number.parseFloat(inputs.xSlider.min);
  const maxX = Number.parseFloat(inputs.xSlider.max);
  if (document.activeElement !== inputs.xSlider) {
    inputs.xSlider.value = clamp(x, minX, maxX);
  }
}

inputs.xSlider.addEventListener("input", () => setX(Number.parseFloat(inputs.xSlider.value)));
inputs.x.addEventListener("input", () => {
  const value = Number.parseFloat(inputs.x.value);
  if (Number.isFinite(value)) state.xTarget = value;
});
inputs.x.addEventListener("change", () => setX(numberValue(inputs.x, state.xTarget)));
inputs.x.addEventListener("keydown", (event) => {
  if (event.key === "Enter") setX(numberValue(inputs.x, state.xTarget));
});
inputs.initialY.addEventListener("change", resetAll);
inputs.initialY.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resetAll();
});

function setRunning(running) {
  state.running = running;
  state.lastFrame = performance.now();
  const label = state.running ? "Pause" : "Run";
  runToggle.textContent = label;
  if (mobileRunToggle) mobileRunToggle.textContent = label;
}

function openControls() {
  controlsPanel.classList.add("open");
  controlsBackdrop.classList.add("open");
}
function closeControls() {
  controlsPanel.classList.remove("open");
  controlsBackdrop.classList.remove("open");
}

runToggle.addEventListener("click", () => setRunning(!state.running));
resetButton.addEventListener("click", resetAll);
clearButton.addEventListener("click", clearTrace);
window.addEventListener("resize", () => render(getSettings()));
if (mobileRunToggle) mobileRunToggle.addEventListener("click", () => setRunning(!state.running));
if (mobileResetButton) mobileResetButton.addEventListener("click", resetAll);
if (mobileMenuToggle) mobileMenuToggle.addEventListener("click", openControls);
if (controlsClose) controlsClose.addEventListener("click", closeControls);
if (controlsBackdrop) controlsBackdrop.addEventListener("click", closeControls);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeControls();
});

/* ---------- RGE pin inline editing ---------- */

function getPinRawValue(key) {
  switch (key) {
    case "x": return state.xTarget;
    case "y": return state.y;
    case "nrm": return numberValue(inputs.nrm, appliedConfig.nrm);
    case "tu": return numberValue(inputs.tu, appliedConfig.tuSeconds / secondsPerUnit(currentTimeUnit));
    case "td": return numberValue(inputs.td, appliedConfig.tdSeconds / secondsPerUnit(currentTimeUnit));
    default: return 0;
  }
}

function applyPinValue(key, val) {
  switch (key) {
    case "x": setX(val); break;
    case "y": state.y = val; state.lastYa = 0; break;
    case "nrm": inputs.nrm.value = val; refreshPending(); break;
    case "tu": inputs.tu.value = val; refreshPending(); break;
    case "td": inputs.td.value = val; refreshPending(); break;
    default: break;
  }
}

function startPinEdit(pin) {
  if (pin.querySelector("input")) return;
  const key = pin.dataset.pin;
  const strong = pin.querySelector(".pin-value");
  const rawVal = getPinRawValue(key);
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.01";
  input.className = "pin-input";
  input.value = Number.isFinite(rawVal) ? rawVal.toFixed(2) : "0";
  strong.replaceWith(input);
  input.focus();
  input.select();

  const finish = () => {
    const val = Number.parseFloat(input.value);
    if (input.isConnected) input.replaceWith(strong);
    if (Number.isFinite(val)) applyPinValue(key, val);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") {
      input.value = rawVal;
      input.blur();
    }
  });
  input.addEventListener("blur", finish, { once: true });
}

rgeDiagram.addEventListener("click", (event) => {
  const pin = event.target.closest(".pin.editable");
  if (!pin) return;
  startPinEdit(pin);
});

/* ============================================================
   Executive pitch calculations & rendering
   ============================================================ */

const conditionSelect = document.querySelector("#conditionSelect");
const condHotMin = document.querySelector("#condHotMin");
const condWarmMin = document.querySelector("#condWarmMin");
const condColdMin = document.querySelector("#condColdMin");
const resultLocked = document.querySelector("#resultLocked");
const resultCard = document.querySelector("#resultCard");
const resultTag = document.querySelector("#resultTag");
const resRefPower = document.querySelector("#resRefPower");
const resActivePower = document.querySelector("#resActivePower");
const resMwLoss = document.querySelector("#resMwLoss");
const resAdditionalRecovery = document.querySelector("#resAdditionalRecovery");
const resAdditionalRecoveryLabel = document.querySelector("#resAdditionalRecoveryLabel");
const resPenaltyDuration = document.querySelector("#resPenaltyDuration");
const resPenalty = document.querySelector("#resPenalty");
const detailToggle = document.querySelector("#detailToggle");
const detailPanel = document.querySelector("#detailPanel");
const detailYAtComplete = document.querySelector("#detailYAtComplete");
const detailReferenceY = document.querySelector("#detailReferenceY");
const detailRampRate = document.querySelector("#detailRampRate");
const detailDuration = document.querySelector("#detailDuration");
const detailDra1 = document.querySelector("#detailDra1");
const detailThreshold = document.querySelector("#detailThreshold");
const penaltyTimelineLocked = document.querySelector("#penaltyTimelineLocked");
const penaltyTimelineContent = document.querySelector("#penaltyTimelineContent");
const ptRecoveryTime = document.querySelector("#ptRecoveryTime");
const ptRecoveryLabel = document.querySelector("#ptRecoveryLabel");
const ptReadyLabel = document.querySelector("#ptReadyLabel");
const ptResumptionTime = document.querySelector("#ptResumptionTime");
const ptTotalTime = document.querySelector("#ptTotalTime");
const tripRiskWrap = document.querySelector("#tripRiskWrap");
const narrativeLocked = document.querySelector("#narrativeLocked");
const narrativeText = document.querySelector("#narrativeText");
const mechGapNote = document.querySelector("#mechGapNote");
const compareRateNote = document.querySelector("#compareRateNote");
const savingsLabel = document.querySelector("#savingsLabel");
const compareCells = {
  hot: { bad: document.querySelector("#compareBadHot"), good: document.querySelector("#compareGoodHot") },
  warm: { bad: document.querySelector("#compareBadWarm"), good: document.querySelector("#compareGoodWarm") },
  cold: { bad: document.querySelector("#compareBadCold"), good: document.querySelector("#compareGoodCold") }
};
const comparePctCells = {
  hot: document.querySelector("#comparePctHot"),
  warm: document.querySelector("#comparePctWarm"),
  cold: document.querySelector("#comparePctCold")
};
const savingsValue = document.querySelector("#savingsValue");
const savingsVizTitle = document.querySelector("#savingsVizTitle");
const savingsTimeSaved = document.querySelector("#savingsTimeSaved");
const savingsOldValue = document.querySelector("#savingsOldValue");
const savingsStampMark = document.querySelector("#savingsStampMark");

const compareLocked = document.querySelector("#compareLocked");
const compareContent = document.querySelector("#compareContent");
const heroChart = document.querySelector("#heroChart");
const heroChartTag = document.querySelector("#heroChartTag");
const heroCtx = heroChart ? heroChart.getContext("2d") : null;

const SCENARIOS = [
  { key: "hot", label: "Hot Start", tag: "HOT", durationKey: "hotMin" },
  { key: "warm", label: "Warm Start", tag: "WARM", durationKey: "warmMin" },
  { key: "cold", label: "Cold Start", tag: "COLD", durationKey: "coldMin" }
];

const SCENARIO_COLORS = { hot: "#fb5d6f", warm: "#f2c94c", cold: "#38bdf8" };
const NO_PENALTY_COLOR = "#35d68f";
const AXIS_LABEL_COLOR = "#8298a6";
const AXIS_LINE_COLOR = "#28414d";
const POWER_LINE_COLOR = "#e8a53d";
const GT_ILLUSTRATIVE_FULL = 240; // สเกลภาพประกอบของกราฟ Hero Chart เท่านั้น ไม่ผูกกับตัวเลขค่าปรับจริง
const GT_ILLUSTRATIVE_DECLINE_RATE = 1;
const RESTORATION_LINE_COLOR = "#7dd3fc";

// ============================================================
// PPA Deduction constants — อ้างอิงจากไฟล์ BPK-C5_PPA_Deduction001.xls
// (Sheet: DSN_DDF, คำนวณค่าปรับต่อ 1 เหตุการณ์)
// สมมติฐานสำหรับเคส OTC Controller Reset:
//   - Declare/Dispatch ก่อนเกิดเหตุ = DCC เต็ม (710 MW) เสมอ
//   - แจ้งศูนย์ล่วงหน้า 0 นาทีเสมอ (เป็น Auto Reset ไม่ทันตั้งตัว)
//     -> Time Face (DDF) = (30-0)^2/900 = 1 เสมอ
//   - เวลาที่เกิด Event ใช้ Worst Case เสมอ (T1=2) -> EH = T1(2)+T2(5) = 7 ชม. เสมอ
//   - Weight ก่อน/ระหว่างเหตุการณ์ = 1 (ตามค่าเริ่มต้นของ Sheet คำนวณต่อเหตุการณ์)
// ============================================================
const PPA_EH = 7; // Effective Hours multiplier (Worst Case: T1=2 + T2=5)
const PPA_TIME_FACE = 1; // (30 - นาทีแจ้งล่วงหน้า)^2 / 900 เมื่อแจ้งล่วงหน้า 0 นาที
const PPA_DEVIATION_THRESHOLD_MW = 20; // DSN/DDF เริ่มมีผลเมื่อ Deviation >= 20 MW
const PPA_WEIGHT = 1;

function ddfStepFunction(deviationMw) {
  if (deviationMw < PPA_DEVIATION_THRESHOLD_MW) return 0;
  if (deviationMw <= 100) return deviationMw * 5000;
  if (deviationMw <= 400) return (deviationMw - 100) * 10000 + 500000;
  return (deviationMw - 400) * 15000 + 3500000;
}

function computeScenario(durationMin, rampRateCPerMin, resetY, bacRate) {
  const yAtComplete = Math.min(appliedConfig.referenceY, resetY + rampRateCPerMin * durationMin);
  const yGap = Math.max(0, appliedConfig.referenceY - yAtComplete);
  const rawMwLoss = Math.max(0, yGap * appliedConfig.mwLossFactor);
  const maxRealisticLoss = Math.max(0, appliedConfig.refActivePower - appliedConfig.tripFloorMw);
  const mwLoss = Math.min(rawMwLoss, maxRealisticLoss);
  const predictedPower = appliedConfig.refActivePower - mwLoss;
  const recoveryRemainingMin = rampRateCPerMin > 0 ? yGap / rampRateCPerMin : 0;
  const postEventOccurred = yGap > 0;

  // ---- สูตรค่าปรับจริง: Total Deduction = DRA1 + MAX(DSN, DDF) ----
  // ระยะเวลาที่โดนค่าปรับ = ลากยาวที่ MW ต่ำสุด ตั้งแต่เกิดเหตุจนกว่า OTC จะ Recovered แล้ว
  // บวก Resumption Auto (Worst Case: ศูนย์รับคืนอัตโนมัติ 4 ชม.)
  const eventHours = postEventOccurred ? (recoveryRemainingMin / 60 + appliedConfig.resumptionHr) : 0;
  const deviation = mwLoss; // Declare = Dispatch = DCC เต็ม จึง Deviation = MW Loss ตรงๆ

  // DRA1: คิดทุกกรณีที่มี Gap เกิดขึ้น ไม่มีเกณฑ์ขั้นต่ำ — อัตรา(บาท/ชม.) x จำนวนชั่วโมงรวม
  const dra1Rate = bacRate * deviation * PPA_WEIGHT;
  const dra1Total = dra1Rate * eventHours;

  // DSN: ค่าปรับเพิ่มเมื่อ Deviation >= 20 MW คูณด้วย EH (ตัวคูณความไม่ทันตั้งตัว)
  const draKy = bacRate * (appliedConfig.refActivePower - predictedPower) * PPA_WEIGHT;
  const dsn = deviation < PPA_DEVIATION_THRESHOLD_MW ? 0 : draKy * PPA_EH;

  // DDF: ค่าปรับเพิ่มแบบขั้นบันไดตาม Deviation คูณด้วย Time Face
  const ddf = postEventOccurred ? ddfStepFunction(deviation) * PPA_TIME_FACE : 0;

  const thresholdPenalty = Math.max(dsn, ddf);
  const estimatedPenalty = dra1Total + thresholdPenalty;

  // Timeline การปฏิบัติงาน = ชั่วโมงเดียวกับที่ใช้คิดค่าปรับ (Recovery + Resumption Auto)
  const totalPenaltyDurationHr = eventHours;

  return {
    yAtComplete, yGap, mwLoss, predictedPower, recoveryRemainingMin,
    totalPenaltyDurationHr, estimatedPenalty, postEventOccurred,
    dra1Total, thresholdPenalty, dsn, ddf
  };
}

function computeTripScenario(bacRate) {
  const mwLoss = Math.max(0, appliedConfig.refActivePower - appliedConfig.tripFloorMw);
  // ลากยาวที่ Trip Floor ตั้งแต่ Trip จนกว่า Restart จะเสร็จ บวก Resumption Auto (Worst Case)
  const eventHours = appliedConfig.tripRestartMin / 60 + appliedConfig.resumptionHr;
  const deviation = mwLoss;

  const dra1Rate = bacRate * deviation * PPA_WEIGHT;
  const dra1Total = dra1Rate * eventHours;

  const draKy = bacRate * (appliedConfig.refActivePower - appliedConfig.tripFloorMw) * PPA_WEIGHT;
  const dsn = deviation < PPA_DEVIATION_THRESHOLD_MW ? 0 : draKy * PPA_EH;
  const ddf = ddfStepFunction(deviation) * PPA_TIME_FACE;
  const thresholdPenalty = Math.max(dsn, ddf);

  const estimatedPenalty = dra1Total + thresholdPenalty;
  const totalPenaltyDurationHr = eventHours;
  return { floorMw: appliedConfig.tripFloorMw, mwLoss, totalPenaltyDurationHr, estimatedPenalty, dra1Total, thresholdPenalty };
}

// HOT/WARM มีโอกาส Trip จาก Loss of Flame จริง (OTC กดลึกเกิน Trip Floor ทั้งคู่ตามข้อมูลจริง)
// ฟังก์ชันนี้รวม Logic การสลับไปใช้ตัวเลข Trip Scenario (340 MW คงที่ + Restart/Resumption 9 ชม.คงที่)
// เป็นค่าหลักสำหรับทุกจุดในแอปที่ต้องอ้างอิงผลลัพธ์ของ HOT/WARM ให้ตรงกันหมด
function computeScenarioWithTrip(sc, rampRateCPerMin, bacRate) {
  const r = computeScenario(appliedConfig[sc.durationKey], rampRateCPerMin, 0, bacRate);
  const isHotWarm = sc.key === "hot" || sc.key === "warm";
  const rawMwLoss = r.yGap * appliedConfig.mwLossFactor;
  const maxRealisticLoss = Math.max(0, appliedConfig.refActivePower - appliedConfig.tripFloorMw);
  const wouldHitFloor = rawMwLoss > maxRealisticLoss;
  const willTrip = isHotWarm && wouldHitFloor;
  if (!willTrip) return { ...r, willTrip };
  const tripR = computeTripScenario(bacRate);
  return {
    ...r,
    mwLoss: tripR.mwLoss,
    predictedPower: appliedConfig.refActivePower - tripR.mwLoss,
    recoveryRemainingMin: appliedConfig.tripRestartMin,
    totalPenaltyDurationHr: tripR.totalPenaltyDurationHr,
    estimatedPenalty: tripR.estimatedPenalty,
    dra1Total: tripR.dra1Total,
    thresholdPenalty: tripR.thresholdPenalty,
    postEventOccurred: true,
    willTrip: true
  };
}

function currentRampRateCPerMin() {
  const tuMinutes = appliedConfig.tuSeconds / 60;
  return tuMinutes > 0 ? appliedConfig.nrm / tuMinutes : 0;
}

function setKpiValue(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove("kpi-flash");
  void el.offsetWidth;
  el.classList.add("kpi-flash");
}

function animateNumber(el, from, to, duration, formatter) {
  const start = performance.now();
  function frame(now) {
    const t = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = from + (to - from) * eased;
    el.textContent = formatter(value);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function animateMinutesNumber(el, targetMinutes) {
  animateNumber(el, 0, Math.max(0, targetMinutes), 900, (v) => formatHoursMinutes(v));
}

function animateSavingsValue(target, finalText) {
  savingsOldValue.classList.remove("struck");
  savingsStampMark.classList.remove("stamping");
  void savingsStampMark.offsetWidth;
  savingsOldValue.classList.add("struck");
  savingsStampMark.classList.add("stamping");
  savingsValue.textContent = finalText;
  setTimeout(() => savingsStampMark.classList.remove("stamping"), 950);
}

let lastSavingsValue = null;

function inputsReady() {
  return true;
}

function selectCondition(key) {
  execState.scenario = key;
  revealed = true;
  renderExecutive();
}

conditionSelect.querySelectorAll("[data-scenario]").forEach((btn) => {
  btn.addEventListener("click", () => selectCondition(btn.dataset.scenario));
});

function animateDetailNumber(el, toValue, formatter) {
  const to = Number.parseFloat(toValue);
  if (!Number.isFinite(to)) return;
  animateNumber(el, 0, to, 700, formatter);
}

detailToggle.addEventListener("click", () => {
  const isOpen = detailToggle.getAttribute("aria-expanded") === "true";
  detailToggle.setAttribute("aria-expanded", String(!isOpen));
  detailPanel.hidden = isOpen;
  detailToggle.classList.toggle("open", !isOpen);

  if (!isOpen && execState.scenario) {
    const meta = SCENARIOS.find((sc) => sc.key === execState.scenario);
    const rate = currentRampRateCPerMin();
    const r = computeScenario(appliedConfig[meta.durationKey], rate, execState.resetY, execState.penaltyRate);
    animateDetailNumber(detailYAtComplete, r.yAtComplete, (v) => `${v.toFixed(0)}°C`);
    animateDetailNumber(detailReferenceY, appliedConfig.referenceY, (v) => `${v.toFixed(0)}°C`);
    animateDetailNumber(detailRampRate, rate, (v) => `${v.toFixed(2)} °C/min`);
    animateDetailNumber(detailDuration, appliedConfig[meta.durationKey], (v) => `${v.toFixed(0)} min`);
  }
});

function buildNarrative(meta, r, willTrip) {
  if (willTrip) {
    const totalText = formatHoursMinutes(r.totalPenaltyDurationHr * 60);
    return `${meta.label}: คาดว่า GT จะ Trip จาก Loss of Flame (Firing Temperature ต่ำต่อเนื่องขณะ IGV ค้างที่ 100%) กำลังผลิตจะเหลือ ${r.predictedPower.toFixed(0)} MW จนกว่าจะ Restart และผ่าน Resumption รวม ${totalText} คาดว่าค่าปรับอยู่ที่ ฿${formatBaht(r.estimatedPenalty)}`;
  }

  if (!r.postEventOccurred) {
    return `${meta.label}: OTC Controller Recovery ทันเวลาก่อน Startup เสร็จ ไม่มี MW Loss และไม่มีค่าปรับ Post Event`;
  }

  const recoveryText = formatHoursMinutes(r.recoveryRemainingMin);
  const postEventText = formatHoursMinutes(r.totalPenaltyDurationHr * 60);

  return `${meta.label}: OTC Recovery ไม่ทัน Startup ทำให้กำลังผลิตต่ำกว่าอ้างอิงประมาณ ${r.mwLoss.toFixed(0)} MW ต้องรอ Recovery เพิ่ม ${recoveryText} รวม Resumption อีก ${appliedConfig.resumptionHr} ชม. เป็น Post Event รวม ${postEventText} คาดว่าค่าปรับอยู่ที่ ฿${formatBaht(r.estimatedPenalty)}`;
}

function renderExecutive() {
  const unlocked = revealed && inputsReady() && execState.scenario;
  const rate = currentRampRateCPerMin();

  if (typeof updateStickySummary === "function") updateStickySummary();

  condHotMin.textContent = `${appliedConfig.hotMin} min`;
  condWarmMin.textContent = `${appliedConfig.warmMin} min`;
  condColdMin.textContent = `${appliedConfig.coldMin} min`;
  conditionSelect.querySelectorAll("[data-scenario]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.scenario === execState.scenario);
  });

  if (!inputsReady()) {
    compareLocked.hidden = false;
    compareContent.hidden = true;
  } else {
    compareLocked.hidden = true;
    compareContent.hidden = false;
    renderCompareTable(rate);
  }

  if (!unlocked) {
    resultLocked.hidden = false;
    resultCard.hidden = true;
    narrativeLocked.hidden = false;
    narrativeText.hidden = true;
    penaltyTimelineLocked.hidden = false;
    penaltyTimelineContent.hidden = true;
    tripRiskWrap.hidden = true;
    return;
  }

  const meta = SCENARIOS.find((sc) => sc.key === execState.scenario);
  const r = computeScenarioWithTrip(meta, rate, execState.penaltyRate);
  const willTrip = r.willTrip;

  resultLocked.hidden = true;
  resultCard.hidden = false;
  resultCard.dataset.condition = meta.key;
  resultTag.textContent = `ผลการประเมิน ${meta.tag} START`;
  tripBadge.hidden = !willTrip;
  setKpiValue(resRefPower, `${appliedConfig.refActivePower.toFixed(0)} MW`);
  setKpiValue(resActivePower, `${r.predictedPower.toFixed(0)} MW`);
  setKpiValue(resMwLoss, `${r.mwLoss.toFixed(0)} MW`);
  resAdditionalRecoveryLabel.textContent = willTrip ? "ระยะเวลา Restart หลัง Trip" : "เวลา Recovery เพิ่มเติม";
  setKpiValue(resAdditionalRecovery, formatHoursMinutes(r.recoveryRemainingMin));
  setKpiValue(resPenaltyDuration, formatHoursMinutes(r.totalPenaltyDurationHr * 60));
  setKpiValue(resPenalty, `฿${formatBaht(r.estimatedPenalty)}`);

  detailYAtComplete.textContent = `${r.yAtComplete.toFixed(0)}°C`;
  detailReferenceY.textContent = `${appliedConfig.referenceY.toFixed(0)}°C`;
  detailRampRate.textContent = `${rate.toFixed(2)} °C/min`;
  detailDuration.textContent = `${appliedConfig[meta.durationKey]} min`;
  detailDra1.textContent = `฿${formatBaht(r.dra1Total)}`;
  detailThreshold.textContent = `฿${formatBaht(r.thresholdPenalty)}`;

  narrativeLocked.hidden = true;
  narrativeText.hidden = false;
  narrativeText.textContent = buildNarrative(meta, r, willTrip);

  penaltyTimelineLocked.hidden = true;
  penaltyTimelineContent.hidden = false;
  const resumptionMinForDisplay = r.postEventOccurred ? appliedConfig.resumptionHr * 60 : 0;
  ptRecoveryLabel.textContent = willTrip ? "GT Restart" : "Additional OTC Recovery";
  ptReadyLabel.textContent = willTrip ? "Restart Complete" : "OTC Controller Ready";
  animateMinutesNumber(ptRecoveryTime, r.recoveryRemainingMin);
  animateMinutesNumber(ptResumptionTime, resumptionMinForDisplay);
  animateMinutesNumber(ptTotalTime, r.totalPenaltyDurationHr * 60);

  tripRiskWrap.hidden = !willTrip;
}

function renderCompareTable(rate) {
  const goodRate = appliedConfig.rampRateAfterFix;
  const penaltyRate = execState.penaltyRate;
  let maxPenaltyCut = 0;
  let selectedCut = null;
  let maxCutScenario = SCENARIOS[0];
  let maxCutBad = 0;
  let maxCutGood = 0;
  let maxCutMinutes = 0;
  let selectedBad = null;
  let selectedGood = null;
  let selectedMinutes = null;

  SCENARIOS.forEach((sc) => {
    const badResult = computeScenarioWithTrip(sc, rate, penaltyRate);
    const goodResult = computeScenarioWithTrip(sc, goodRate, penaltyRate);
    const badAnnual = badResult.estimatedPenalty;
    const goodAnnual = goodResult.estimatedPenalty;
    const cut = Math.max(0, badAnnual - goodAnnual);
    const minutesCut = Math.max(0, badResult.recoveryRemainingMin - goodResult.recoveryRemainingMin);
    if (cut > maxPenaltyCut) {
      maxPenaltyCut = cut;
      maxCutScenario = sc;
      maxCutBad = badAnnual;
      maxCutGood = goodAnnual;
      maxCutMinutes = minutesCut;
    }
    if (execState.scenario === sc.key) {
      selectedCut = cut;
      selectedBad = badAnnual;
      selectedGood = goodAnnual;
      selectedMinutes = minutesCut;
    }

    const cells = compareCells[sc.key];
    cells.bad.textContent = `฿${formatBaht(badAnnual)}`;
    if (goodAnnual <= 0) {
      cells.good.textContent = "฿0 · ไม่มีค่าปรับ";
      cells.good.classList.add("zero");
    } else {
      cells.good.textContent = `฿${formatBaht(goodAnnual)}`;
      cells.good.classList.remove("zero");
    }

    const pctEl = comparePctCells[sc.key];
    pctEl.textContent = minutesCut > 0 ? `-${formatHoursMinutes(minutesCut)}` : "—";
  });

  compareRateNote.textContent = `Current Ramp Rate ${rate.toFixed(2)} °C/min → Adjust TU Override (เทียบเท่า TU=10ms)`;

  const displayCut = selectedCut !== null ? selectedCut : maxPenaltyCut;
  const displayScenario = execState.scenario ? SCENARIOS.find((s) => s.key === execState.scenario) : maxCutScenario;
  const displayBad = selectedBad !== null ? selectedBad : maxCutBad;
  const displayGood = selectedGood !== null ? selectedGood : maxCutGood;
  const displayMinutes = selectedMinutes !== null ? selectedMinutes : maxCutMinutes;

  const scopeLabel = execState.scenario ? "" : " (สูงสุด · แต่ละ Startup Condition ไม่ได้รวมกัน)";
  savingsLabel.textContent = `ค่าปรับ Post Event ที่ตัดออกได้ทั้งหมดต่อครั้ง${scopeLabel}`;

  savingsVizTitle.textContent = `สำหรับ ${displayScenario.tag} START`;
  savingsOldValue.textContent = `฿${formatBaht(displayBad)}`;
  savingsTimeSaved.textContent = displayMinutes > 0 ? `-${formatHoursMinutes(displayMinutes)}` : "ไม่มีเวลาให้ลด";

  const savingsText = displayGood > 0 ? `฿${formatBaht(displayGood)}` : "฿0 · ไม่มีค่าปรับ";
  if (lastSavingsValue !== displayCut) {
    lastSavingsValue = displayCut;
    animateSavingsValue(displayCut, savingsText);
  }
}


/* ---------- scroll reveal ---------- */

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("in-view");
  });
}, { threshold: 0.3, rootMargin: "0px 0px -8% 0px" });

document.querySelectorAll(".pitch-section, .mech-step, .pt-step, .pt-arrow, .pt-total").forEach((section) => revealObserver.observe(section));

/* ---------- sticky summary bar ---------- */

const stickySummary = document.querySelector("#stickySummary");
const stickyTag = document.querySelector("#stickyTag");
const stickyValue = document.querySelector("#stickyValue");
let heroInView = true;

const heroObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      heroInView = entry.isIntersecting;
      updateStickySummary();
    });
  },
  { threshold: 0.15 }
);
const pitchHeroEl = document.querySelector("#pitchHero");
if (pitchHeroEl) heroObserver.observe(pitchHeroEl);

function updateStickySummary() {
  const ready = Boolean(execState.scenario) && inputsReady();
  if (!ready || heroInView) {
    stickySummary.classList.remove("visible");
    return;
  }
  const meta = SCENARIOS.find((sc) => sc.key === execState.scenario);
  const rate = currentRampRateCPerMin();
  const r = computeScenario(appliedConfig[meta.durationKey], rate, execState.resetY, execState.penaltyRate);
  stickyTag.textContent = `${meta.tag} START`;
  stickyValue.textContent = r.postEventOccurred ? `฿${formatBaht(r.estimatedPenalty)}` : "ไม่มีค่าปรับ";
  stickySummary.classList.add("visible");
}

document.querySelectorAll(".mech-step").forEach((step) => {
  const toggle = () => {
    const wasActive = step.classList.contains("active");
    document.querySelectorAll(".mech-step.active").forEach((s) => {
      s.classList.remove("active");
      s.setAttribute("aria-expanded", "false");
    });
    if (!wasActive) {
      step.classList.add("active");
      step.setAttribute("aria-expanded", "true");
    }
  };
  step.addEventListener("click", toggle);
  step.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
});

/* ============================================================
   View switching
   ============================================================ */

const viewScan = document.querySelector("#viewScan");
let viewTransitioning = false;

function setView(view) {
  const currentView = bodyEl.classList.contains("view-technical") ? "technical" : "executive";
  if (view === currentView || viewTransitioning) return;
  viewTransitioning = true;

  const outgoingEl = document.querySelector(currentView === "technical" ? "#view-technical" : "#view-executive");
  const incomingEl = document.querySelector(view === "technical" ? "#view-technical" : "#view-executive");

  viewSwitchButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));

  viewScan.classList.remove("sweeping");
  void viewScan.offsetWidth;
  viewScan.classList.add("sweeping");

  outgoingEl.classList.add("view-out");
  setTimeout(() => {
    outgoingEl.classList.remove("view-out");
    bodyEl.classList.toggle("view-executive", view === "executive");
    bodyEl.classList.toggle("view-technical", view === "technical");
    if (view === "technical") render(getSettings());
    incomingEl.classList.add("view-in");
    setTimeout(() => {
      incomingEl.classList.remove("view-in");
      viewScan.classList.remove("sweeping");
      viewTransitioning = false;
    }, 500);
  }, 260);
}

viewSwitchButtons.forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
const ctaToTechnicalButton = document.querySelector("#ctaToTechnical");
if (ctaToTechnicalButton) ctaToTechnicalButton.addEventListener("click", () => setView("technical"));

/* ---------- Hero mini chart (always animating, decorative -> real) ---------- */

const heroChartTooltip = document.querySelector("#heroChartTooltip");
let heroChartMeta = null;
let heroHoverMin = null;

function drawHeroChart(now) {
  if (!bodyEl.classList.contains("view-executive")) {
    requestAnimationFrame(drawHeroChart);
    return;
  }
  if (heroCtx && heroChart.parentElement) {
    const rect = heroChart.parentElement.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(200, rect.width);
    const h = Math.max(100, rect.height);
    heroChart.width = Math.round(w * scale);
    heroChart.height = Math.round(h * scale);
    heroCtx.setTransform(scale, 0, 0, scale, 0, 0);
    heroCtx.clearRect(0, 0, w, h);

    const curveReferenceY = appliedConfig.referenceY !== 0 ? appliedConfig.referenceY : 0.01;
    const curveResetY = 0;
    const curveRate = Math.max(0.1, currentRampRateCPerMin());
    const penaltyRateEffective = inputsReady() ? execState.penaltyRate : appliedConfig.penaltyRate;
    const maxDurationMin = Math.max(appliedConfig.hotMin, appliedConfig.warmMin, appliedConfig.coldMin);
    const totalMin = Math.max(maxDurationMin * 1.15, (curveReferenceY - curveResetY) / curveRate * 1.05);

    const isSelected = Boolean(execState.scenario);
    const riskColor = isSelected ? SCENARIO_COLORS[execState.scenario] : "#38bdf8";
    const tempLineColor = "#38bdf8"; // OTC Recovery (เส้นไต่ขึ้น 0→572°C)

    heroChartTag.textContent = isSelected
      ? `${SCENARIOS.find((s) => s.key === execState.scenario).label} · OTC Recovery`
      : "OTC Recovery · เลือก Condition ด้านบนสุด";

    const pad = { left: 46, right: 50, top: 30, bottom: 26 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const yFor = (val) => pad.top + (1 - (val - curveResetY) / (curveReferenceY - curveResetY)) * plotH;
    const xFor = (min) => pad.left + (min / totalMin) * plotW;

    heroChartMeta = {
      totalMin, curveRate, curveReferenceY, curveResetY, pad, plotW,
      isSelected, powerPoints: null, gtFull: null
    };

    heroCtx.textBaseline = "middle";
    heroCtx.font = "500 9.5px 'IBM Plex Mono', monospace";

    /* ---- Y axis: temperature, 572°C highlighted ---- */
    heroCtx.strokeStyle = AXIS_LINE_COLOR;
    heroCtx.lineWidth = 1;
    heroCtx.beginPath();
    heroCtx.moveTo(pad.left, pad.top);
    heroCtx.lineTo(pad.left, h - pad.bottom);
    heroCtx.stroke();

    heroCtx.fillStyle = AXIS_LABEL_COLOR;
    heroCtx.textAlign = "right";
    heroCtx.fillText(`${curveResetY.toFixed(0)}°C`, pad.left - 6, yFor(curveResetY));

    heroCtx.fillStyle = "#c9d8de";
    heroCtx.font = "600 10px 'IBM Plex Mono', monospace";
    heroCtx.fillText(`${curveReferenceY.toFixed(0)}°C`, pad.left - 6, yFor(curveReferenceY));
    heroCtx.font = "500 9.5px 'IBM Plex Mono', monospace";

    /* ---- X axis: time in minutes ---- */
    heroCtx.strokeStyle = AXIS_LINE_COLOR;
    heroCtx.beginPath();
    heroCtx.moveTo(pad.left, h - pad.bottom);
    heroCtx.lineTo(w - pad.right, h - pad.bottom);
    heroCtx.stroke();

    heroCtx.fillStyle = AXIS_LABEL_COLOR;
    heroCtx.textAlign = "center";
    heroCtx.textBaseline = "top";
    const xTicks = 4;
    for (let i = 0; i <= xTicks; i += 1) {
      const min = (totalMin / xTicks) * i;
      heroCtx.fillText(`${min.toFixed(0)}m`, xFor(min), h - pad.bottom + 6);
    }
    heroCtx.textBaseline = "middle";

    /* ---- 572°C reference line ---- */
    heroCtx.setLineDash([3, 4]);
    heroCtx.strokeStyle = "#324451";
    heroCtx.lineWidth = 1;
    heroCtx.beginPath();
    heroCtx.moveTo(pad.left, yFor(curveReferenceY));
    heroCtx.lineTo(w - pad.right, yFor(curveReferenceY));
    heroCtx.stroke();
    heroCtx.setLineDash([]);

    /* ---- Right axis: GT Active Power (MW) — คนละหน่วยกับแกนซ้าย ทำแกนแยกให้ชัด ---- */
    if (Boolean(execState.scenario)) {
      const gtFullAxis = Math.max(1, GT_ILLUSTRATIVE_FULL);
      const powerAxisYFor = (mw) => pad.top + (1 - mw / gtFullAxis) * plotH;

      heroCtx.strokeStyle = hexToRgba(POWER_LINE_COLOR, 0.5);
      heroCtx.lineWidth = 1;
      heroCtx.beginPath();
      heroCtx.moveTo(w - pad.right, pad.top);
      heroCtx.lineTo(w - pad.right, h - pad.bottom);
      heroCtx.stroke();

      heroCtx.fillStyle = POWER_LINE_COLOR;
      heroCtx.textAlign = "left";
      heroCtx.font = "500 9px 'IBM Plex Mono', monospace";
      heroCtx.fillText("0 MW", w - pad.right + 6, powerAxisYFor(0));
      heroCtx.font = "600 9.5px 'IBM Plex Mono', monospace";
      heroCtx.fillText(`${gtFullAxis.toFixed(0)} MW`, w - pad.right + 6, powerAxisYFor(gtFullAxis));
      heroCtx.font = "500 9.5px 'IBM Plex Mono', monospace";
      heroCtx.textAlign = "center";
    }

    const steps = 48;

    /* ---- Loss triangle: เฉพาะ Condition ที่เลือก (สียังตาม Condition เพื่อสื่อความเสี่ยง) ---- */
    if (isSelected) {
      const sc = SCENARIOS.find((s) => s.key === execState.scenario);
      const duration = appliedConfig[sc.durationKey];
      const rawR = computeScenario(duration, curveRate, curveResetY, penaltyRateEffective);
      const r = computeScenarioWithTrip(sc, curveRate, penaltyRateEffective);
      const noPenalty = !r.postEventOccurred;
      const recoveryCompleteMin = Math.min(totalMin, (curveReferenceY - curveResetY) / curveRate);

      if (!noPenalty) {
        const p1x = xFor(Math.min(duration, totalMin));
        const p1y = yFor(rawR.yAtComplete);
        const topY = yFor(curveReferenceY);
        const p3x = xFor(recoveryCompleteMin);

        heroCtx.beginPath();
        heroCtx.moveTo(p1x, p1y);
        heroCtx.lineTo(p1x, topY);
        heroCtx.lineTo(p3x, topY);
        heroCtx.closePath();
        heroCtx.fillStyle = hexToRgba(riskColor, 0.16);
        heroCtx.fill();

        heroCtx.setLineDash([4, 3]);
        heroCtx.strokeStyle = riskColor;
        heroCtx.lineWidth = 1.4;
        heroCtx.beginPath();
        heroCtx.moveTo(p1x, pad.top);
        heroCtx.lineTo(p1x, h - pad.bottom);
        heroCtx.stroke();
        heroCtx.setLineDash([]);
      }

      /* ---- GT Active Power (หน่วยเดียว): เต็ม 240 MW จนถึง Startup Complete แล้วลด 1 MW/min
             จนกว่าจะ "ชน" เส้น OTC ที่ไต่ขึ้น (สัดส่วนเดียวกันบนกราฟ) แล้วไหลตามขึ้นไปจบที่ 240 พร้อม OTC ที่ 572°C
             ถ้าลงถึง 0 ก่อนจะชนกัน ให้ค้างที่ 0 = GT Trip ---- */
      const gtFull = GT_ILLUSTRATIVE_FULL;
      const declineRate = GT_ILLUSTRATIVE_DECLINE_RATE;
      const powerYFor = (mw) => pad.top + (1 - mw / gtFull) * plotH;

      let crossed = false;
      let tripped = false;
      let tripMinX = null;
      const powerPoints = [];

      for (let i = 0; i <= steps; i += 1) {
        const min = (totalMin / steps) * i;
        let mw;
        if (min < duration) {
          mw = gtFull;
        } else if (tripped) {
          mw = 0;
        } else if (crossed) {
          const tempNow = Math.min(curveReferenceY, curveResetY + curveRate * min);
          mw = gtFull * (tempNow / curveReferenceY);
        } else {
          const decline = Math.max(0, gtFull - (min - duration) * declineRate);
          const tempNow = Math.min(curveReferenceY, curveResetY + curveRate * min);
          const tracked = gtFull * (tempNow / curveReferenceY);
          if (tracked >= decline) {
            crossed = true;
            mw = tracked;
          } else if (decline <= 0) {
            tripped = true;
            tripMinX = min;
            mw = 0;
          } else {
            mw = decline;
          }
        }
        powerPoints.push({ min, mw });
      }

      heroChartMeta.powerPoints = powerPoints;
      heroChartMeta.gtFull = gtFull;

      heroCtx.beginPath();
      powerPoints.forEach((p, i) => {
        const px = xFor(p.min);
        const py = powerYFor(p.mw);
        if (i === 0) heroCtx.moveTo(px, py);
        else heroCtx.lineTo(px, py);
      });
      heroCtx.strokeStyle = POWER_LINE_COLOR;
      heroCtx.lineWidth = 2;
      heroCtx.stroke();

      if (tripped && tripMinX !== null) {
        heroCtx.beginPath();
        heroCtx.moveTo(xFor(tripMinX), powerYFor(0));
        heroCtx.lineTo(xFor(totalMin), powerYFor(0));
        heroCtx.strokeStyle = "#fb5d6f";
        heroCtx.lineWidth = 2.4;
        heroCtx.stroke();

        heroCtx.font = "700 9.5px 'IBM Plex Mono', monospace";
        heroCtx.fillStyle = "#fb5d6f";
        const tripLabel = "GT TRIP";
        const tripLabelWidth = heroCtx.measureText(tripLabel).width;
        const tripLabelX = clamp(xFor(tripMinX) + 6 + tripLabelWidth / 2, pad.left + tripLabelWidth / 2 + 2, w - pad.right - tripLabelWidth / 2 - 2);
        heroCtx.textAlign = "center";
        heroCtx.textBaseline = "alphabetic";
        heroCtx.fillText(tripLabel, tripLabelX, powerYFor(0) - 6);
        heroCtx.textBaseline = "middle";
      }

      /* ---- Restoration Time marker: จุดที่ OTC กลับถึง 572°C พร้อม GT Active Power กลับเต็ม ---- */
      if (!noPenalty) {
        const restoreX = xFor(recoveryCompleteMin);
        heroCtx.setLineDash([2, 3]);
        heroCtx.strokeStyle = RESTORATION_LINE_COLOR;
        heroCtx.lineWidth = 1.2;
        heroCtx.beginPath();
        heroCtx.moveTo(restoreX, pad.top);
        heroCtx.lineTo(restoreX, h - pad.bottom);
        heroCtx.stroke();
        heroCtx.setLineDash([]);

        const restoreLabel = `OTC Ready (572°C) +${rawR.recoveryRemainingMin.toFixed(0)}m`;
        heroCtx.font = "600 9px 'IBM Plex Mono', monospace";
        heroCtx.fillStyle = RESTORATION_LINE_COLOR;
        const restoreWidth = heroCtx.measureText(restoreLabel).width;
        const restoreLabelX = clamp(restoreX, pad.left + restoreWidth / 2 + 2, w - pad.right - restoreWidth / 2 - 2);
        heroCtx.textAlign = "center";
        heroCtx.textBaseline = "alphabetic";
        heroCtx.fillText(restoreLabel, restoreLabelX, pad.top + 22);
        heroCtx.textBaseline = "middle";
      }

      const labelText = noPenalty ? "ไม่เสียค่าปรับ ฿0" : `฿${formatBahtCompact(r.estimatedPenalty)}`;
      heroCtx.font = "700 10.5px 'IBM Plex Mono', monospace";
      heroCtx.fillStyle = noPenalty ? NO_PENALTY_COLOR : riskColor;
      const labelWidth = heroCtx.measureText(labelText).width;
      const labelX = clamp(xFor(Math.min(duration, totalMin)), pad.left + labelWidth / 2 + 2, w - pad.right - labelWidth / 2 - 2);
      heroCtx.textAlign = "center";
      heroCtx.textBaseline = "alphabetic";
      heroCtx.fillText(labelText, labelX, pad.top - 8);
      heroCtx.textBaseline = "middle";
    }

    /* ---- Recovery curve (0°C -> 572°C ตาม Ramp Rate ปัจจุบัน) — สีคงที่ ไม่เปลี่ยนตาม Condition ---- */
    heroCtx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const min = (totalMin / steps) * i;
      const y = Math.min(curveReferenceY, curveResetY + curveRate * min);
      const px = xFor(min);
      const py = yFor(y);
      if (i === 0) heroCtx.moveTo(px, py);
      else heroCtx.lineTo(px, py);
    }
    heroCtx.strokeStyle = tempLineColor;
    heroCtx.lineWidth = 2.2;
    heroCtx.stroke();

    /* ---- animated leading dot ---- */
    const loopMs = 3200;
    const t = (now % loopMs) / loopMs;
    const dotMin = t * totalMin;
    const dotY = Math.min(curveReferenceY, curveResetY + curveRate * dotMin);
    heroCtx.beginPath();
    heroCtx.arc(xFor(dotMin), yFor(dotY), 4, 0, Math.PI * 2);
    heroCtx.fillStyle = tempLineColor;
    heroCtx.shadowColor = tempLineColor;
    heroCtx.shadowBlur = 10;
    heroCtx.fill();
    heroCtx.shadowBlur = 0;

    /* ---- Crosshair ตอน Hover/Touch: วาดทับบนสุดพร้อมจุดแสดงค่าแต่ละเส้น ---- */
    if (heroHoverMin !== null) {
      const hx = xFor(heroHoverMin);
      heroCtx.save();
      heroCtx.strokeStyle = "rgba(238, 244, 246, 0.35)";
      heroCtx.lineWidth = 1;
      heroCtx.setLineDash([3, 3]);
      heroCtx.beginPath();
      heroCtx.moveTo(hx, pad.top);
      heroCtx.lineTo(hx, h - pad.bottom);
      heroCtx.stroke();
      heroCtx.setLineDash([]);

      const hOtc = Math.min(curveReferenceY, curveResetY + curveRate * heroHoverMin);
      heroCtx.beginPath();
      heroCtx.arc(hx, yFor(hOtc), 4, 0, Math.PI * 2);
      heroCtx.fillStyle = tempLineColor;
      heroCtx.fill();
      heroCtx.strokeStyle = "#06231f";
      heroCtx.lineWidth = 1.5;
      heroCtx.stroke();

      if (isSelected && heroChartMeta.powerPoints) {
        let nearest = heroChartMeta.powerPoints[0];
        let nearestDist = Math.abs(nearest.min - heroHoverMin);
        heroChartMeta.powerPoints.forEach((p) => {
          const d = Math.abs(p.min - heroHoverMin);
          if (d < nearestDist) { nearest = p; nearestDist = d; }
        });
        const powerYForHover = (mw) => pad.top + (1 - mw / heroChartMeta.gtFull) * plotH;
        heroCtx.beginPath();
        heroCtx.arc(hx, powerYForHover(nearest.mw), 4, 0, Math.PI * 2);
        heroCtx.fillStyle = POWER_LINE_COLOR;
        heroCtx.fill();
        heroCtx.strokeStyle = "#2a1c05";
        heroCtx.lineWidth = 1.5;
        heroCtx.stroke();
      }
      heroCtx.restore();
    }
  }
  requestAnimationFrame(drawHeroChart);
}
requestAnimationFrame(drawHeroChart);

function heroChartValueAt(min) {
  if (!heroChartMeta) return null;
  const { curveReferenceY, curveResetY, curveRate, isSelected, powerPoints } = heroChartMeta;
  const otcTemp = Math.min(curveReferenceY, curveResetY + curveRate * min);
  let gtPower = null;
  let tripped = false;
  if (isSelected && powerPoints && powerPoints.length) {
    let nearest = powerPoints[0];
    let nearestDist = Math.abs(nearest.min - min);
    powerPoints.forEach((p) => {
      const d = Math.abs(p.min - min);
      if (d < nearestDist) { nearest = p; nearestDist = d; }
    });
    gtPower = nearest.mw;
    tripped = gtPower <= 0.05;
  }
  return { otcTemp, gtPower, tripped };
}

function updateHeroTooltip(clientX, clientY) {
  if (!heroChartMeta) return;
  const rect = heroChart.getBoundingClientRect();
  const frameRect = heroChart.parentElement.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const { pad, plotW, totalMin } = heroChartMeta;
  if (mouseX < pad.left - 4 || mouseX > pad.left + plotW + 4) {
    heroHoverMin = null;
    heroChartTooltip.hidden = true;
    return;
  }
  const min = clamp(((mouseX - pad.left) / plotW) * totalMin, 0, totalMin);
  heroHoverMin = min;
  const values = heroChartValueAt(min);
  if (!values) return;

  const timeLabel = min < 60 ? `${min.toFixed(1)} นาที` : `${(min / 60).toFixed(1)} ชม.`;
  let html = `<strong>เวลา: ${timeLabel} หลัง Reset</strong>`;
  html += `<div class="tt-otc">OTC Recovery: ${values.otcTemp.toFixed(1)}°C</div>`;
  if (values.gtPower !== null) {
    html += `<div class="tt-power">GT Active Power: ${values.gtPower.toFixed(0)} MW</div>`;
    if (values.tripped) html += `<div class="tt-trip">⚠ GT TRIP</div>`;
  }
  heroChartTooltip.innerHTML = html;
  heroChartTooltip.hidden = false;

  const localX = clientX - frameRect.left;
  const localY = clientY - frameRect.top;
  const clampedX = clamp(localX, 40, frameRect.width - 40);
  heroChartTooltip.style.left = `${clampedX}px`;
  heroChartTooltip.style.top = `${Math.max(localY, 30)}px`;
}

if (heroChart) {
  heroChart.addEventListener("mousemove", (e) => updateHeroTooltip(e.clientX, e.clientY));
  heroChart.addEventListener("mouseleave", () => {
    heroHoverMin = null;
    heroChartTooltip.hidden = true;
  });
  heroChart.addEventListener("touchstart", (e) => {
    if (e.touches[0]) updateHeroTooltip(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  heroChart.addEventListener("touchmove", (e) => {
    if (e.touches[0]) {
      updateHeroTooltip(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }
  }, { passive: false });
  heroChart.addEventListener("touchend", () => {
    heroHoverMin = null;
    heroChartTooltip.hidden = true;
  });
}

/* ============================================================
   Boot
   ============================================================ */

discardAllChanges();
renderExecutive();
resetAll();
requestAnimationFrame(tick);

const appVersionEl = document.querySelector("#appVersion");
if (appVersionEl) appVersionEl.textContent = APP_VERSION;

requestAnimationFrame(() => {
  viewScan.classList.add("sweeping");
  setTimeout(() => viewScan.classList.remove("sweeping"), 600);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
