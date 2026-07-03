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
  penaltyRate: 100000,
  annualEvents: 6,
  thresholdEnabled: false,
  rampRateAfterFix: 2
};

let draftThresholdEnabled = false;

let execState = {
  scenario: null,
  resetY: null,
  penaltyRate: null,
  annualEvents: null
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
  penaltyRate: document.querySelector("#penaltyRateInput"),
  annualEvents: document.querySelector("#annualEventsInput"),
  tuAfterFix: document.querySelector("#tuAfterFixInput"),
  window: document.querySelector("#windowInput")
};

const thresholdToggle = document.querySelector("#thresholdToggle");

const chartFrame = document.querySelector(".chart-frame");
const chart = document.querySelector("#chart");
const ctx = chart.getContext("2d");
const xReadout = document.querySelector("#xReadout");
const yReadout = document.querySelector("#yReadout");
const mwReadout = document.querySelector("#mwReadout");
const mwLossReadout = document.querySelector("#mwLossReadout");
const fineRateReadout = document.querySelector("#fineRateReadout");
const fineTotalReadout = document.querySelector("#fineTotalReadout");
const rateReadout = document.querySelector("#rateReadout");
const runToggle = document.querySelector("#runToggle");
const resetButton = document.querySelector("#resetButton");
const clearButton = document.querySelector("#clearButton");
const nudgeButtons = document.querySelectorAll("[data-x-nudge]");
const setButtons = document.querySelectorAll("[data-x-set]");
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
  accumulatedFine: 0,
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

function formatHoursMinutes(totalMinutes) {
  const safe = Math.max(0, totalMinutes);
  const h = Math.floor(safe / 60);
  const m = Math.round(safe - h * 60);
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
  { key: "penaltyRate", input: inputs.penaltyRate, min: 0 },
  { key: "annualEvents", input: inputs.annualEvents, min: 0 },
  { key: "rampRateAfterFix", input: inputs.tuAfterFix, min: 0.01 }
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

  const thresholdPending = draftThresholdEnabled !== appliedConfig.thresholdEnabled;
  if (thresholdPending) pendingCount += 1;

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
  appliedConfig.thresholdEnabled = draftThresholdEnabled;

  execState.penaltyRate = appliedConfig.penaltyRate;
  execState.annualEvents = appliedConfig.annualEvents;
  syncQuickInputsFromExecState();

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
  draftThresholdEnabled = appliedConfig.thresholdEnabled;
  thresholdToggle.classList.toggle("on", draftThresholdEnabled);
  thresholdToggle.setAttribute("aria-checked", String(draftThresholdEnabled));
  refreshPending();
}

applyButton.addEventListener("click", applyAllChanges);
discardButton.addEventListener("click", discardAllChanges);

thresholdToggle.addEventListener("click", () => {
  draftThresholdEnabled = !draftThresholdEnabled;
  thresholdToggle.classList.toggle("on", draftThresholdEnabled);
  thresholdToggle.setAttribute("aria-checked", String(draftThresholdEnabled));
  refreshPending();
});

[inputs.nrm, inputs.hotMin, inputs.warmMin, inputs.coldMin, inputs.referenceY, inputs.refActivePower,
  inputs.mwLossFactor, inputs.resumptionHr, inputs.penaltyRate, inputs.annualEvents, inputs.tuAfterFix,
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
    penaltyRate: appliedConfig.penaltyRate,
    windowSeconds: Math.max(30, numberValue(inputs.window, 180))
  };
}

function mwFromY(y, settings) {
  const gap = Math.max(0, settings.referenceY - y);
  return Math.max(0, settings.refActivePower - gap * settings.mwLossFactor);
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

function addPenalty(settings) {
  const mwLoss = Math.max(0, settings.referenceY - state.y) > 0 ? Math.max(0, settings.referenceY - state.y) : 0;
  if (mwLoss > 0) {
    state.accumulatedFine += settings.penaltyRate * (TA_SECONDS / 3600);
  }
}

function sample(settings) {
  const mw = mwFromY(state.y, settings);
  return {
    time: state.elapsed,
    x: settings.x,
    y: state.y,
    mw,
    accumulatedFine: state.accumulatedFine
  };
}

function resetAll() {
  const settings = getSettings();
  state.elapsed = 0;
  state.xTarget = settings.x;
  state.y = settings.initialY;
  state.lastYa = 0;
  state.accumulatedFine = 0;
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
  const settings = getSettings();
  syncSliderToX(settings.x);
  const frameDt = Math.min(0.25, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;

  if (state.running) {
    state.accumulator += frameDt;
    const cycles = Math.min(2000, Math.floor(state.accumulator / TA_SECONDS));
    for (let i = 0; i < cycles; i += 1) {
      stepRge(settings);
      addPenalty(settings);
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
  const liveFineRate = liveLoss > 0 ? settings.penaltyRate : 0;
  const liveRate = currentRampRate(settings);
  xReadout.textContent = `${settings.x.toFixed(2)} C`;
  yReadout.textContent = `${last.y.toFixed(3)} C`;
  mwReadout.textContent = `${liveMw.toFixed(2)} MW`;
  mwLossReadout.textContent = `${liveLoss.toFixed(2)} MW`;
  fineRateReadout.textContent = `${formatBaht(liveFineRate)}/hr`;
  fineTotalReadout.textContent = `${formatBaht(state.accumulatedFine)}`;
  rateReadout.textContent = `${liveRate.toFixed(3)} C/min`;
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
  const mwAxis = axisFor(history.map((row) => row.mw).concat([settings.refActivePower]), 2, { floor: 0 });
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

function drawReferenceLine(pane, yFor, value, label, color) {
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
  ctx.fillText(label, pane.x + pane.w - 58, y - 5);
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
nudgeButtons.forEach((button) => {
  button.addEventListener("click", () => setX(numberValue(inputs.x, 572) + Number.parseFloat(button.dataset.xNudge)));
});
setButtons.forEach((button) => {
  button.addEventListener("click", () => setX(Number.parseFloat(button.dataset.xSet)));
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

const scenarioGrid = document.querySelector("#scenarioGrid");
const bignumValue = document.querySelector("#bignumValue");
const bignumScenarioLabel = document.querySelector("#bignumScenarioLabel");
const bignumBasis = document.querySelector("#bignumBasis");
const mechGapNote = document.querySelector("#mechGapNote");
const compareBadTag = document.querySelector("#compareBadTag");
const compareGoodTag = document.querySelector("#compareGoodTag");
const compareBadValue = document.querySelector("#compareBadValue");
const compareGoodValue = document.querySelector("#compareGoodValue");
const savingsValue = document.querySelector("#savingsValue");

const quickResetY = document.querySelector("#quickResetY");
const quickPenaltyRate = document.querySelector("#quickPenaltyRate");
const quickAnnualEvents = document.querySelector("#quickAnnualEvents");
const runForecastButton = document.querySelector("#runForecastButton");
const bignumLocked = document.querySelector("#bignumLocked");
const bignumContent = document.querySelector("#bignumContent");
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

function computeScenario(durationMin, rampRateCPerMin, resetY, penaltyRate) {
  const yAtComplete = Math.min(appliedConfig.referenceY, resetY + rampRateCPerMin * durationMin);
  const yGap = Math.max(0, appliedConfig.referenceY - yAtComplete);
  const mwLoss = Math.max(0, yGap * appliedConfig.mwLossFactor);
  const predictedPower = Math.max(0, appliedConfig.refActivePower - mwLoss);
  const recoveryRemainingMin = rampRateCPerMin > 0 ? yGap / rampRateCPerMin : 0;
  const totalPenaltyDurationHr = recoveryRemainingMin / 60 + appliedConfig.resumptionHr;
  const estimatedPenalty = totalPenaltyDurationHr * penaltyRate;
  return { yAtComplete, yGap, mwLoss, predictedPower, recoveryRemainingMin, totalPenaltyDurationHr, estimatedPenalty };
}

function currentRampRateCPerMin() {
  const tuMinutes = appliedConfig.tuSeconds / 60;
  return tuMinutes > 0 ? appliedConfig.nrm / tuMinutes : 0;
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

let bignumAnimated = false;

function inputsReady() {
  return (
    Number.isFinite(Number.parseFloat(quickResetY.value)) &&
    Number.isFinite(Number.parseFloat(quickPenaltyRate.value)) &&
    Number.isFinite(Number.parseFloat(quickAnnualEvents.value))
  );
}

function flashMissingInputs() {
  [quickResetY, quickPenaltyRate, quickAnnualEvents].forEach((el) => {
    if (!Number.isFinite(Number.parseFloat(el.value))) {
      el.classList.add("field-missing");
      setTimeout(() => el.classList.remove("field-missing"), 1200);
    }
  });
}

function renderExecutive() {
  const unlocked = revealed && inputsReady();
  const rate = currentRampRateCPerMin();

  let results = {};
  let severityByKey = {};
  if (unlocked) {
    SCENARIOS.forEach((sc) => {
      results[sc.key] = computeScenario(appliedConfig[sc.durationKey], rate, execState.resetY, execState.penaltyRate);
    });
    const ranked = [...SCENARIOS].sort((a, b) => results[a.key].estimatedPenalty - results[b.key].estimatedPenalty);
    const severityClasses = ["severity-low", "severity-mid", "severity-high"];
    ranked.forEach((sc, idx) => { severityByKey[sc.key] = severityClasses[Math.min(idx, 2)]; });
  }

  scenarioGrid.innerHTML = SCENARIOS.map((sc) => {
    const selected = sc.key === execState.scenario ? "selected" : "";
    if (!unlocked) {
      return `
        <div class="scenario-card ${selected}" data-scenario-card="${sc.key}">
          <span class="tag">${sc.tag} · ${appliedConfig[sc.durationKey]} min</span>
          <h3>${sc.label}</h3>
          <div class="metric-row"><span>คลิกเพื่อดูผลกระทบ</span><strong class="value-dash">—</strong></div>
        </div>`;
    }
    const r = results[sc.key];
    return `
      <div class="scenario-card ${severityByKey[sc.key]} ${selected}" data-scenario-card="${sc.key}">
        <span class="tag">${sc.tag} · ${appliedConfig[sc.durationKey]} min</span>
        <h3>${sc.label}</h3>
        <div class="metric-row"><span>Predicted Active Power</span><strong>${r.predictedPower.toFixed(0)} MW</strong></div>
        <div class="metric-row"><span>MW Loss</span><strong>${r.mwLoss.toFixed(0)} MW</strong></div>
        <div class="metric-row"><span>Recovery Remaining</span><strong>${formatHoursMinutes(r.recoveryRemainingMin)}</strong></div>
        <div class="metric-row penalty"><span>Estimated Penalty</span><strong>฿${formatBaht(r.estimatedPenalty)}</strong></div>
      </div>`;
  }).join("");

  scenarioGrid.querySelectorAll("[data-scenario-card]").forEach((card) => {
    card.addEventListener("click", () => {
      if (!inputsReady()) {
        flashMissingInputs();
        return;
      }
      execState.scenario = card.dataset.scenarioCard;
      revealed = true;
      renderExecutive();
    });
  });

  if (!unlocked) {
    bignumLocked.hidden = false;
    bignumContent.hidden = true;
    compareLocked.hidden = false;
    compareContent.hidden = true;
    return;
  }

  bignumLocked.hidden = true;
  bignumContent.hidden = false;
  compareLocked.hidden = true;
  compareContent.hidden = false;

  const selectedResult = results[execState.scenario];
  const selectedMeta = SCENARIOS.find((sc) => sc.key === execState.scenario);

  bignumScenarioLabel.textContent = `Based on ${selectedMeta.label} scenario · ${execState.annualEvents} events / year`;
  const annualExposure = selectedResult.estimatedPenalty * execState.annualEvents;
  const targetText = `฿${formatBaht(annualExposure)}`;
  if (!bignumAnimated) {
    bignumAnimated = true;
    animateNumber(bignumValue, 0, annualExposure, 1200, (v) => `฿${formatBaht(v)}`);
  } else {
    bignumValue.textContent = targetText;
  }

  bignumBasis.innerHTML = `
    <div><span>Per-event Penalty</span><strong>฿${formatBaht(selectedResult.estimatedPenalty)}</strong></div>
    <div><span>Total Penalty Duration</span><strong>${formatHoursMinutes(selectedResult.totalPenaltyDurationHr * 60)}</strong></div>
    <div><span>MW Loss</span><strong>${selectedResult.mwLoss.toFixed(0)} MW</strong></div>
  `;

  const badRate = rate;
  const goodRate = appliedConfig.rampRateAfterFix;
  const badResult = computeScenario(appliedConfig[selectedMeta.durationKey], badRate, execState.resetY, execState.penaltyRate);
  const goodResult = computeScenario(appliedConfig[selectedMeta.durationKey], goodRate, execState.resetY, execState.penaltyRate);
  const badAnnual = badResult.estimatedPenalty * execState.annualEvents;
  const goodAnnual = goodResult.estimatedPenalty * execState.annualEvents;

  compareBadTag.textContent = `Current · ${badRate.toFixed(2)} °C/min`;
  compareGoodTag.textContent = `After Fix · ${goodRate.toFixed(2)} °C/min`;
  compareBadValue.textContent = `฿${formatBaht(badAnnual)}`;
  compareGoodValue.textContent = `฿${formatBaht(goodAnnual)}`;
  savingsValue.textContent = `฿${formatBaht(Math.max(0, badAnnual - goodAnnual))} / year`;
}

function syncQuickInputsFromExecState() {
  quickPenaltyRate.value = execState.penaltyRate;
  quickAnnualEvents.value = execState.annualEvents;
}

quickResetY.addEventListener("input", () => {
  execState.resetY = Number.parseFloat(quickResetY.value);
  renderExecutive();
});
quickPenaltyRate.addEventListener("input", () => {
  execState.penaltyRate = Number.parseFloat(quickPenaltyRate.value);
  renderExecutive();
});
quickAnnualEvents.addEventListener("input", () => {
  execState.annualEvents = Number.parseFloat(quickAnnualEvents.value);
  renderExecutive();
});

runForecastButton.addEventListener("click", () => {
  if (!inputsReady()) {
    flashMissingInputs();
    return;
  }
  if (!execState.scenario) execState.scenario = "cold";
  revealed = true;
  renderExecutive();
  scenarioGrid.scrollIntoView({ behavior: "smooth", block: "center" });
});

/* ---------- scroll reveal ---------- */

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("in-view");
  });
}, { threshold: 0.3, rootMargin: "0px 0px -8% 0px" });

document.querySelectorAll(".pitch-section").forEach((section) => revealObserver.observe(section));

/* ============================================================
   View switching
   ============================================================ */

function setView(view) {
  bodyEl.classList.toggle("view-executive", view === "executive");
  bodyEl.classList.toggle("view-technical", view === "technical");
  viewSwitchButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  if (view === "technical") render(getSettings());
}

viewSwitchButtons.forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
document.querySelector("#ctaToTechnical").addEventListener("click", () => setView("technical"));

/* ---------- Hero mini chart (always animating, decorative -> real) ---------- */

function drawHeroChart(now) {
  if (heroCtx && heroChart.parentElement) {
    const rect = heroChart.parentElement.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(200, rect.width);
    const h = Math.max(100, rect.height);
    heroChart.width = Math.round(w * scale);
    heroChart.height = Math.round(h * scale);
    heroCtx.setTransform(scale, 0, 0, scale, 0, 0);
    heroCtx.clearRect(0, 0, w, h);

    const unlocked = revealed && inputsReady() && execState.scenario;
    const curveReferenceY = appliedConfig.referenceY;
    const curveRate = Math.max(0.1, currentRampRateCPerMin());
    let curveResetY = 0;
    let curveDurationMin = 300;

    if (unlocked) {
      const sc = SCENARIOS.find((s) => s.key === execState.scenario);
      curveResetY = execState.resetY;
      curveDurationMin = appliedConfig[sc.durationKey];
      heroChartTag.textContent = `${sc.label} · Y Recovery`;
    } else {
      heroChartTag.textContent = "Y Recovery · illustrative";
    }

    const totalMin = Math.max(curveDurationMin * 1.35, (curveReferenceY - curveResetY) / curveRate * 1.05);
    const pad = { left: 12, right: 12, top: 16, bottom: 16 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const yFor = (val) => pad.top + (1 - (val - curveResetY) / (curveReferenceY - curveResetY)) * plotH;
    const xFor = (min) => pad.left + (min / totalMin) * plotW;
    const lineColor = unlocked ? "#f5a524" : "#2dd9c2";

    heroCtx.beginPath();
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const min = (totalMin / steps) * i;
      const y = Math.min(curveReferenceY, curveResetY + curveRate * min);
      const px = xFor(min);
      const py = yFor(y);
      if (i === 0) heroCtx.moveTo(px, py);
      else heroCtx.lineTo(px, py);
    }
    heroCtx.strokeStyle = lineColor;
    heroCtx.lineWidth = 2.2;
    heroCtx.stroke();

    heroCtx.setLineDash([3, 4]);
    heroCtx.strokeStyle = "#324451";
    heroCtx.lineWidth = 1;
    heroCtx.beginPath();
    heroCtx.moveTo(pad.left, yFor(curveReferenceY));
    heroCtx.lineTo(w - pad.right, yFor(curveReferenceY));
    heroCtx.stroke();
    heroCtx.setLineDash([]);

    const markerX = xFor(Math.min(curveDurationMin, totalMin));
    heroCtx.strokeStyle = "#58202b";
    heroCtx.lineWidth = 1;
    heroCtx.beginPath();
    heroCtx.moveTo(markerX, pad.top);
    heroCtx.lineTo(markerX, h - pad.bottom);
    heroCtx.stroke();

    const loopMs = 3200;
    const t = (now % loopMs) / loopMs;
    const dotMin = t * totalMin;
    const dotY = Math.min(curveReferenceY, curveResetY + curveRate * dotMin);
    heroCtx.beginPath();
    heroCtx.arc(xFor(dotMin), yFor(dotY), 4, 0, Math.PI * 2);
    heroCtx.fillStyle = lineColor;
    heroCtx.shadowColor = lineColor;
    heroCtx.shadowBlur = 10;
    heroCtx.fill();
    heroCtx.shadowBlur = 0;
  }
  requestAnimationFrame(drawHeroChart);
}
requestAnimationFrame(drawHeroChart);

/* ============================================================
   Boot
   ============================================================ */

discardAllChanges();
renderExecutive();
resetAll();
requestAnimationFrame(tick);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
