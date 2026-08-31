const APP_VERSION = "v68";
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

/* ---- Quick Action: ปรับ/คืนค่า TU แบบทันที สำหรับคนที่ไม่แน่ใจว่าต้องแก้ตรงไหน ---- */
const quickAdjustTuButton = document.querySelector("#quickAdjustTuButton");
const quickResetTuButton = document.querySelector("#quickResetTuButton");
const DEFAULT_TU_UNIT = "min";
const DEFAULT_TU_VALUE = "1";

if (quickAdjustTuButton) {
  quickAdjustTuButton.addEventListener("click", () => {
    inputs.timeUnit.value = "ms";
    inputs.tu.value = "10";
    refreshPending();
    applyAllChanges();
  });
}

if (quickResetTuButton) {
  quickResetTuButton.addEventListener("click", () => {
    inputs.timeUnit.value = DEFAULT_TU_UNIT;
    inputs.tu.value = DEFAULT_TU_VALUE;
    refreshPending();
    applyAllChanges();
  });
}

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
    initialY: numberValue(inputs.initialY, 0),
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
const penaltyTimelineLocked = document.querySelector("#penaltyTimelineLocked");
const penaltyTimelineContent = document.querySelector("#penaltyTimelineContent");
const ptRecoveryTime = document.querySelector("#ptRecoveryTime");
const ptRecoveryLabel = document.querySelector("#ptRecoveryLabel");
const ptReadyLabel = document.querySelector("#ptReadyLabel");
const ptResumptionTime = document.querySelector("#ptResumptionTime");
const ptTotalTime = document.querySelector("#ptTotalTime");
const tripRiskWrap = document.querySelector("#tripRiskWrap");
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
const TRIP_THRESHOLD_MW = 450; // ถ้า MW ตกไปเจอ OTC Recovery ต่ำกว่านี้ = Trip จริง (ค่าที่ผู้ใช้กำหนดเอง)

function computeScenarioWithTrip(sc, rampRateCPerMin, bacRate) {
  const r = computeScenario(appliedConfig[sc.durationKey], rampRateCPerMin, 0, bacRate);

  // crossingMW = MW ณ จุดที่เส้น OTC Actual (ไหลลงจาก 572 ตอน Startup Complete) ไปเจอเส้น OTC Recovery (ไล่ขึ้นจาก 0)
  // ใช้สูตรล้วนๆ ไม่เช็คชื่อ Condition — ถ้าจุดนี้ต่ำกว่า TRIP_THRESHOLD_MW ถือว่า Trip จริง
  const crossingMW = appliedConfig.refActivePower - (appliedConfig.mwLossFactor * r.yGap) / 2;
  const willTrip = r.postEventOccurred && crossingMW < TRIP_THRESHOLD_MW;

  if (!willTrip) {
    // ไม่ Trip: ใช้ MW ที่จุดชนกัน (crossingMW) เป็นค่าต่ำสุดจริงที่ใช้คิดทั้ง DRA1 และ DSN/DDF
    // เวลา DRA1 = จาก Startup Complete จนถึง OTC Recovered (rawR.recoveryRemainingMin) + Resumption Auto 4 ชม.
    const deviation = Math.max(0, appliedConfig.refActivePower - crossingMW);
    const eventHours = r.postEventOccurred ? (r.recoveryRemainingMin / 60 + appliedConfig.resumptionHr) : 0;
    const dra1Total = bacRate * deviation * PPA_WEIGHT * eventHours;
    const draKy = bacRate * deviation * PPA_WEIGHT;
    const dsn = deviation < PPA_DEVIATION_THRESHOLD_MW ? 0 : draKy * PPA_EH;
    const ddf = r.postEventOccurred ? ddfStepFunction(deviation) * PPA_TIME_FACE : 0;
    const thresholdPenalty = Math.max(dsn, ddf);
    const estimatedPenalty = dra1Total + thresholdPenalty;
    return {
      ...r,
      mwLoss: deviation,
      predictedPower: crossingMW,
      totalPenaltyDurationHr: eventHours,
      estimatedPenalty,
      dra1Total,
      thresholdPenalty,
      willTrip: false
    };
  }

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

  compareRateNote.textContent = `Current Ramp Rate ${rate.toFixed(2)} °C/min → หลังดำเนินมาตรการ (Recovery ภายในไม่กี่วินาที)`;

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

document.querySelectorAll(".pitch-section, .pt-step, .pt-arrow, .pt-total").forEach((section) => revealObserver.observe(section));

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
  const r = computeScenarioWithTrip(meta, rate, execState.penaltyRate);
  stickyTag.textContent = `${meta.tag} START`;
  stickyValue.textContent = r.postEventOccurred ? `฿${formatBaht(r.estimatedPenalty)}` : "ไม่มีค่าปรับ";
  stickySummary.classList.add("visible");
}

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
    const actualLineColor = "#fb923c"; // OTC Actual (572°C คงที่)

    heroChartTag.textContent = isSelected
      ? `${SCENARIOS.find((s) => s.key === execState.scenario).label} · OTC Recovery`
      : "OTC Recovery · เลือก Condition ด้านบนสุด";

    const pad = { left: 46, right: 50, top: 42, bottom: 26 };
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

    /* ---- 572°C reference guide (จางๆ) ---- */
    heroCtx.setLineDash([3, 4]);
    heroCtx.strokeStyle = "#324451";
    heroCtx.lineWidth = 1;
    heroCtx.beginPath();
    heroCtx.moveTo(pad.left, yFor(curveReferenceY));
    heroCtx.lineTo(w - pad.right, yFor(curveReferenceY));
    heroCtx.stroke();
    heroCtx.setLineDash([]);

    /* ---- OTC Actual: ค้างที่ 572°C จนถึงจุด Startup Complete (จุดเดียวกับที่ MW เริ่มตก)
           แล้วค่อยไหลลงด้วยอัตราเดียวกับ OTC Recovery (curveRate) จนไปเจอกัน แล้ววิ่งขึ้นด้วยกัน ---- */
    const dropStartMin = isSelected
      ? appliedConfig[SCENARIOS.find((s) => s.key === execState.scenario).durationKey]
      : totalMin;
    heroChartMeta.dropStartMin = dropStartMin;
    const otcActualSteps = 48;
    heroCtx.beginPath();
    for (let i = 0; i <= otcActualSteps; i += 1) {
      const min = (totalMin / otcActualSteps) * i;
      const recoveryValue = Math.min(curveReferenceY, curveResetY + curveRate * min);
      let actualValue;
      if (min <= dropStartMin) {
        actualValue = curveReferenceY;
      } else {
        const declineValue = Math.max(0, curveReferenceY - curveRate * (min - dropStartMin));
        actualValue = Math.max(declineValue, recoveryValue);
      }
      const px = xFor(min);
      const py = yFor(actualValue);
      if (i === 0) heroCtx.moveTo(px, py);
      else heroCtx.lineTo(px, py);
    }
    heroCtx.strokeStyle = actualLineColor;
    heroCtx.lineWidth = 1.8;
    heroCtx.stroke();

    /* ---- Right axis: GT Active Power (MW) — คนละหน่วยกับแกนซ้าย ทำแกนแยกให้ชัด ---- */
    if (Boolean(execState.scenario)) {
      const gtFullAxis = Math.max(1, appliedConfig.refActivePower);
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

      /* ---- GT Active Power: ใช้ค่า r (จาก computeScenarioWithTrip) ตรงๆ — สูตรเดียวกับ Result Card เป๊ะ
             ไม่มีทางเพี้ยนจากกัน เพราะไม่คำนวณแยกอีกต่อไป
             Trip: ไหลลง 710->450 (จุด Trip จริง) แล้วดิ่งไป 340 ค้างจนครบ 9 ชม. แล้วกลับ 710
             ไม่ Trip: ไหลลง 710->crossingMW (ตรงจุดที่ชนกับ OTC Recovery) แล้วไล่ขึ้นตาม Recovery กลับ 710 ---- */
      const gtFull = appliedConfig.refActivePower;
      const declineRate = curveRate * appliedConfig.mwLossFactor; // ตกตามสูตรจริง: Gap(°C/min) x mwLossFactor = MW/min
      const powerYFor = (mw) => pad.top + (1 - mw / gtFull) * plotH;
      const powerPoints = [];
      let tripMinX = null;
      let tripEndX = null;

      if (r.willTrip) {
        tripMinX = Math.min(totalMin, duration + (gtFull - TRIP_THRESHOLD_MW) / declineRate);
        tripEndX = Math.min(totalMin, duration + r.totalPenaltyDurationHr * 60);
        for (let i = 0; i <= steps; i += 1) {
          const min = (totalMin / steps) * i;
          let mw;
          if (min < duration) mw = gtFull;
          else if (min < tripMinX) mw = gtFull - declineRate * (min - duration);
          else if (min < tripEndX) mw = r.predictedPower;
          else mw = gtFull;
          powerPoints.push({ min, mw });
        }
      } else if (r.postEventOccurred) {
        const crossMin = Math.min(totalMin, duration + (gtFull - r.predictedPower) / declineRate);
        for (let i = 0; i <= steps; i += 1) {
          const min = (totalMin / steps) * i;
          let mw;
          if (min < duration) mw = gtFull;
          else if (min < crossMin) mw = gtFull - declineRate * (min - duration);
          else if (min < recoveryCompleteMin) {
            mw = r.predictedPower + (gtFull - r.predictedPower) * ((min - crossMin) / Math.max(0.001, recoveryCompleteMin - crossMin));
          } else mw = gtFull;
          powerPoints.push({ min, mw });
        }
      } else {
        for (let i = 0; i <= steps; i += 1) {
          powerPoints.push({ min: (totalMin / steps) * i, mw: gtFull });
        }
      }

      heroChartMeta.powerPoints = powerPoints;
      heroChartMeta.willTrip = r.willTrip;
      heroChartMeta.tripMinX = tripMinX;
      heroChartMeta.tripEndX = tripEndX;
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

      if (r.willTrip && tripMinX !== null) {
        heroCtx.beginPath();
        heroCtx.moveTo(xFor(tripMinX), powerYFor(r.predictedPower));
        heroCtx.lineTo(xFor(tripEndX), powerYFor(r.predictedPower));
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
        heroCtx.fillText(tripLabel, tripLabelX, powerYFor(r.predictedPower) - 6);
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
      heroCtx.fillText(labelText, labelX, 34);
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

/* ============================================================
   Mini Charts: เปรียบเทียบทั้ง 3 Startup Condition พร้อมกัน
   ============================================================ */

const miniCanvases = {
  hot: document.querySelector("#miniChartHot"),
  warm: document.querySelector("#miniChartWarm"),
  cold: document.querySelector("#miniChartCold")
};
const miniBadges = {
  hot: document.querySelector("#miniBadgeHot"),
  warm: document.querySelector("#miniBadgeWarm"),
  cold: document.querySelector("#miniBadgeCold")
};
const miniMwEls = {
  hot: document.querySelector("#miniMwHot"),
  warm: document.querySelector("#miniMwWarm"),
  cold: document.querySelector("#miniMwCold")
};

function drawMiniChart(key, cycle) {
  const canvas = miniCanvases[key];
  if (!canvas || !canvas.parentElement) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(120, rect.width);
  const h = canvas.clientHeight || 108;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const sc = SCENARIOS.find((s) => s.key === key);
  const duration = appliedConfig[sc.durationKey];
  const curveRate = Math.max(0.1, currentRampRateCPerMin());
  const curveReferenceY = appliedConfig.referenceY !== 0 ? appliedConfig.referenceY : 0.01;
  const penaltyRateEffective = inputsReady() ? execState.penaltyRate : appliedConfig.penaltyRate;
  const r = computeScenarioWithTrip(sc, curveRate, penaltyRateEffective);

  const maxDurationMin = Math.max(appliedConfig.hotMin, appliedConfig.warmMin, appliedConfig.coldMin);
  const totalMin = Math.max(maxDurationMin * 1.15, (curveReferenceY / curveRate) * 1.05);

  const pad = { left: 8, right: 8, top: 12, bottom: 10 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const yFor = (val) => pad.top + (1 - val / curveReferenceY) * plotH;
  const xFor = (min) => pad.left + (min / totalMin) * plotW;
  const valAt = (min) => Math.min(curveReferenceY, curveRate * min);
  const color = SCENARIO_COLORS[key];

  /* กริดจางๆ */
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + plotH / 2);
  ctx.lineTo(w - pad.right, pad.top + plotH / 2);
  ctx.stroke();

  /* เส้น OTC Recovery */
  const steps = 48;
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const min = (totalMin / steps) * i;
    const px = xFor(min);
    const py = yFor(valAt(min));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;

  /* เส้นประ Startup Complete */
  const sx = xFor(duration);
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, pad.top);
  ctx.lineTo(sx, h - pad.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  /* แถบ GT TRIP บางๆ ถ้า Trip */
  if (r.willTrip) {
    ctx.strokeStyle = "rgba(251,93,111,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, h - pad.bottom - 2);
    ctx.lineTo(w - pad.right, h - pad.bottom - 2);
    ctx.stroke();
  }

  /* ---- เอฟเฟกต์: จุดเรืองแสงไหลไปตามเส้นแบบต่อเนื่องจริง (ไม่กระโดดจุด) ----
     0.00-0.72 ไต่ขึ้นด้วย Ease-Out (เร็ว→ช้าตอนใกล้ถึงเป้า)
     0.72-0.90 หยุดพักที่ปลายทางเป้า ให้เห็นชัดว่าไปถึงแล้ว
     0.90-1.00 จางหายแล้วเริ่มใหม่ที่จุดเริ่มต้น */
  let travel;
  let opacity = 1;
  if (cycle < 0.72) {
    const t = cycle / 0.72;
    travel = 1 - (1 - t) * (1 - t) * (1 - t); // ease-out cubic
  } else if (cycle < 0.9) {
    travel = 1;
  } else {
    travel = 1;
    opacity = 1 - (cycle - 0.9) / 0.1;
  }
  const glowMin = travel * totalMin;
  const gx = xFor(glowMin);
  const gy = yFor(valAt(glowMin));

  /* หางดาวหาง (Comet Trail): จุดจางๆ ไล่หลังตำแหน่งปัจจุบัน */
  const trailSteps = 6;
  for (let i = trailSteps; i >= 1; i -= 1) {
    const trailTravel = Math.max(0, travel - i * 0.018);
    const tMin = trailTravel * totalMin;
    const tx = xFor(tMin);
    const ty = yFor(valAt(tMin));
    const trailAlpha = (1 - i / trailSteps) * 0.35 * opacity;
    ctx.beginPath();
    ctx.arc(tx, ty, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = trailAlpha;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* จุดเรืองแสงหลัก พร้อม Pulse ขนาดเบาๆ */
  const pulse = 1 + Math.sin(cycle * Math.PI * 10) * 0.12;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 16 * pulse);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.globalAlpha = 0.85 * opacity;
  ctx.beginPath();
  ctx.arc(gx, gy, 16 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.arc(gx, gy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.globalAlpha = 1;

  const badge = miniBadges[key];
  if (badge) {
    badge.textContent = r.willTrip ? "⚠ TRIP" : "ไม่ Trip";
    badge.classList.toggle("is-trip", r.willTrip);
  }
  const mwEl = miniMwEls[key];
  if (mwEl && !mwEl.dataset.locked) mwEl.textContent = `${r.predictedPower.toFixed(0)} MW`;
}

function drawAllMiniCharts(now) {
  if (!bodyEl.classList.contains("view-executive")) {
    requestAnimationFrame(drawAllMiniCharts);
    return;
  }
  const loopDuration = 3200;
  const stagger = { hot: 0, warm: 260, cold: 520 };
  ["hot", "warm", "cold"].forEach((key) => {
    const cycle = ((now + stagger[key]) % loopDuration) / loopDuration;
    drawMiniChart(key, cycle);
  });
  requestAnimationFrame(drawAllMiniCharts);
}
requestAnimationFrame(drawAllMiniCharts);

/* ---- คลิกที่การ์ดเพื่อเลือก Condition นั้นแล้วเลื่อนขึ้นไปดูผลลัพธ์ทันที ---- */
document.querySelectorAll(".mini-chart-card").forEach((card) => {
  const key = card.dataset.mini;
  card.setAttribute("tabindex", "0");
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `เลือก ${key.toUpperCase()} Startup Condition`);
  const activate = () => {
    selectCondition(key);
    document.querySelector("#pitchHero").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  card.addEventListener("click", activate);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
});

/* ---- Reveal + นับเลข MW วิ่งขึ้นตอนเลื่อนมาเห็นครั้งแรก ---- */
const miniRevealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("in-view");
    const key = entry.target.dataset.mini;
    const mwEl = miniMwEls[key];
    if (mwEl && !mwEl.dataset.animated) {
      mwEl.dataset.animated = "1";
      mwEl.dataset.locked = "1";
      const sc = SCENARIOS.find((s) => s.key === key);
      const curveRate = Math.max(0.1, currentRampRateCPerMin());
      const penaltyRateEffective = inputsReady() ? execState.penaltyRate : appliedConfig.penaltyRate;
      const r = computeScenarioWithTrip(sc, curveRate, penaltyRateEffective);
      animateNumber(mwEl, 0, r.predictedPower, 900, (v) => `${v.toFixed(0)} MW`);
      setTimeout(() => { delete mwEl.dataset.locked; }, 950);
    }
  });
}, { threshold: 0.2 });
document.querySelectorAll(".mini-chart-card").forEach((card) => miniRevealObserver.observe(card));

function heroChartValueAt(min) {
  if (!heroChartMeta) return null;
  const { curveReferenceY, curveResetY, curveRate, isSelected, powerPoints, dropStartMin } = heroChartMeta;
  const otcTemp = Math.min(curveReferenceY, curveResetY + curveRate * min);
  let otcActual;
  if (min <= dropStartMin) {
    otcActual = curveReferenceY;
  } else {
    const declineValue = Math.max(0, curveReferenceY - curveRate * (min - dropStartMin));
    otcActual = Math.max(declineValue, otcTemp);
  }
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
    tripped = Boolean(heroChartMeta.willTrip) && min >= heroChartMeta.tripMinX && min < heroChartMeta.tripEndX;
  }
  return { otcTemp, otcActual, gtPower, tripped };
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
  html += `<div class="tt-actual">OTC Actual: ${values.otcActual.toFixed(1)}°C</div>`;
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
