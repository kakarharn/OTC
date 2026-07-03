const TA_SECONDS = 0.008;
const MW_PER_DEG = 1;

const inputs = {
  initialY: document.querySelector("#initialYInput"),
  x: document.querySelector("#xInput"),
  xSlider: document.querySelector("#xSlider"),
  tu: document.querySelector("#tuInput"),
  td: document.querySelector("#tdInput"),
  timeUnit: document.querySelector("#timeUnitInput"),
  nrm: document.querySelector("#nrmInput"),
  normalTemp: document.querySelector("#normalTempInput"),
  baseMw: document.querySelector("#baseMwInput"),
  fineRate: document.querySelector("#fineRateInput"),
  window: document.querySelector("#windowInput")
};

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

let history = [];
let currentTimeUnit = "min";
let state = {
  running: true,
  elapsed: 0,
  xTarget: 573.4,
  y: 573.4,
  lastYa: 0,
  accumulatedFine: 0,
  lastFrame: performance.now(),
  accumulator: 0
};

function numberValue(input, fallback) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSettings() {
  const unit = inputs.timeUnit.value;
  const multiplier = secondsPerUnit(unit);
  return {
    initialY: numberValue(inputs.initialY, 573.4),
    x: state.xTarget,
    tuValue: Math.max(0.001, numberValue(inputs.tu, 1)),
    tdValue: Math.max(0.001, numberValue(inputs.td, 1)),
    timeUnit: unit,
    tuSeconds: Math.max(0.001, numberValue(inputs.tu, 1)) * multiplier,
    tdSeconds: Math.max(0.001, numberValue(inputs.td, 1)) * multiplier,
    nrm: Math.max(0.01, numberValue(inputs.nrm, 1)),
    normalTemp: numberValue(inputs.normalTemp, 573.4),
    baseMw: numberValue(inputs.baseMw, 230),
    fineRate: Math.max(0, numberValue(inputs.fineRate, 2500)),
    windowSeconds: Math.max(30, numberValue(inputs.window, 180))
  };
}

function secondsPerUnit(unit) {
  if (unit === "ms") return 0.001;
  if (unit === "sec") return 1;
  return 60;
}

function convertTimeInputs(nextUnit) {
  const prevMultiplier = secondsPerUnit(currentTimeUnit);
  const nextMultiplier = secondsPerUnit(nextUnit);
  const tuSeconds = numberValue(inputs.tu, 1) * prevMultiplier;
  const tdSeconds = numberValue(inputs.td, 1) * prevMultiplier;
  inputs.tu.value = Math.max(0.001, tuSeconds / nextMultiplier).toFixed(nextUnit === "ms" ? 0 : 3);
  inputs.td.value = Math.max(0.001, tdSeconds / nextMultiplier).toFixed(nextUnit === "ms" ? 0 : 3);
  currentTimeUnit = nextUnit;
}

function mwFromY(y, settings) {
  return settings.baseMw + (y - settings.normalTemp) * MW_PER_DEG;
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
  const mwLoss = Math.max(0, settings.baseMw - mwFromY(state.y, settings));
  state.accumulatedFine += mwLoss * (TA_SECONDS / 3600) * settings.fineRate;
}

function sample(settings) {
  const mw = mwFromY(state.y, settings);
  return {
    time: state.elapsed,
    x: settings.x,
  y: state.y,
  mw,
  mwLoss: Math.max(0, settings.baseMw - mw),
  mwChange: mw - settings.baseMw,
  accumulatedFine: state.accumulatedFine,
  ya: state.lastYa
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
  const liveLoss = Math.max(0, settings.baseMw - liveMw);
  const liveFineRate = liveLoss * settings.fineRate;
  const liveRate = currentRampRate(settings);
  xReadout.textContent = `${settings.x.toFixed(2)} C`;
  yReadout.textContent = `${last.y.toFixed(3)} C`;
  mwReadout.textContent = `${liveMw.toFixed(2)} MW`;
  mwLossReadout.textContent = `${liveLoss.toFixed(2)} MW`;
  fineRateReadout.textContent = `${formatBaht(liveFineRate)}/hr`;
  fineTotalReadout.textContent = `${formatBaht(state.accumulatedFine)}`;
  rateReadout.textContent = `${liveRate.toFixed(3)} C/min`;
  renderRgeBlock(settings, last, liveMw);
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
  const rect = chart.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  chart.width = Math.max(720, Math.round(rect.width * scale));
  chart.height = Math.max(420, Math.round(rect.height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const width = chart.width / scale;
  const height = chart.height / scale;
  const pad = { left: 62, right: 18, top: 18, bottom: 36 };
  const gap = 32;
  const paneH = (height - pad.top - pad.bottom - gap) / 2;
  const tempPane = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: paneH };
  const mwPane = { x: pad.left, y: pad.top + paneH + gap, w: width - pad.left - pad.right, h: paneH };
  const windowStart = Math.max(0, state.elapsed - settings.windowSeconds);
  const windowEnd = windowStart + settings.windowSeconds;

  const tempAxis = axisFor(history.flatMap((row) => [row.x, row.y, 0, settings.normalTemp]), 2);
  const mwAxis = axisFor(history.map((row) => row.mw), 2, { floor: 0 });
  const xFor = (time) => tempPane.x + ((time - windowStart) / settings.windowSeconds) * tempPane.w;
  const tempY = (value) => tempPane.y + (1 - (value - tempAxis.min) / (tempAxis.max - tempAxis.min)) * tempPane.h;
  const mwY = (value) => mwPane.y + (1 - (value - mwAxis.min) / (mwAxis.max - mwAxis.min)) * mwPane.h;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f7f9fa";
  ctx.fillRect(0, 0, width, height);
  drawGrid(tempPane, windowStart, windowEnd, tempAxis, "Temperature C");
  drawGrid(mwPane, windowStart, windowEnd, mwAxis, "GT MW");
  drawReferenceLine(tempPane, tempY, 0, "0 C", "#aeb9bf");
  drawReferenceLine(tempPane, tempY, settings.normalTemp, `${settings.normalTemp.toFixed(1)} C`, "#8aa0aa");
  drawReferenceLine(mwPane, mwY, 0, "0 MW", "#aeb9bf");
  drawSeries(history, xFor, tempY, "x", "#3347b7", [8, 6], 2.2);
  drawSeries(history, xFor, tempY, "y", "#df7e24", [], 3);
  drawSeries(history, xFor, mwY, "mw", "#0b8f72", [], 3);
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
  ctx.strokeStyle = "#d9e1e5";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#607078";
  ctx.font = "12px Segoe UI, Arial";

  for (let i = 0; i <= 4; i += 1) {
    const y = pane.y + (pane.h / 4) * i;
    const value = axis.max - ((axis.max - axis.min) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pane.x, y);
    ctx.lineTo(pane.x + pane.w, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(2), 8, y + 4);
  }

  for (let i = 0; i <= 5; i += 1) {
    const x = pane.x + (pane.w / 5) * i;
    const time = windowStart + ((windowEnd - windowStart) / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, pane.y);
    ctx.lineTo(x, pane.y + pane.h);
    ctx.stroke();
    ctx.fillText(`${time.toFixed(0)}s`, x - 10, pane.y + pane.h + 18);
  }

  ctx.strokeStyle = "#85939a";
  ctx.strokeRect(pane.x, pane.y, pane.w, pane.h);
  ctx.fillStyle = "#1c2529";
  ctx.font = "700 12px Segoe UI, Arial";
  ctx.fillText(label, pane.x + 8, pane.y + 16);
  ctx.restore();
}

function drawReferenceLine(pane, yFor, value, label, color) {
  if (value < 0 && label.endsWith("MW")) return;
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
  ctx.font = "11px Segoe UI, Arial";
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

function formatBaht(value) {
  return value.toLocaleString("th-TH", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  });
}

function formatTimeValue(value, unit) {
  if (unit === "ms") return `${value.toFixed(0)} ms`;
  if (value >= 100) return `${value.toFixed(0)} ${unit}`;
  return `${value.toFixed(3).replace(/\.?0+$/, "")} ${unit}`;
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
inputs.timeUnit.addEventListener("change", () => {
  convertTimeInputs(inputs.timeUnit.value);
});
nudgeButtons.forEach((button) => {
  button.addEventListener("click", () => setX(numberValue(inputs.x, 573.4) + Number.parseFloat(button.dataset.xNudge)));
});
setButtons.forEach((button) => {
  button.addEventListener("click", () => setX(Number.parseFloat(button.dataset.xSet)));
});

runToggle.addEventListener("click", () => {
  state.running = !state.running;
  state.lastFrame = performance.now();
  runToggle.textContent = state.running ? "Pause" : "Run";
});
resetButton.addEventListener("click", resetAll);
clearButton.addEventListener("click", clearTrace);
inputs.fineRate.addEventListener("input", () => render(getSettings()));
window.addEventListener("resize", () => render(getSettings()));

resetAll();
requestAnimationFrame(tick);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
