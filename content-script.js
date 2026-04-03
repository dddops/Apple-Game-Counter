const ROOT_ID = "apple-game-indicator-root";
const PANEL_ID = "apple-game-indicator-panel";
const BRIDGE_EVENT = "apple-game-indicator:update";
const DIGIT_LAYOUT = [
  [1, 9],
  [2, 8],
  [3, 7],
  [4, 6],
  [5]
];

let rootElement = null;
let statusElement = null;
let totalElement = null;
const countElements = new Map();
let lastRenderKey = "";

function ensureOverlay() {
  if (rootElement && document.contains(rootElement)) {
    return;
  }

  rootElement = document.createElement("div");
  rootElement.id = ROOT_ID;
  rootElement.style.setProperty("--pattern-url", `url("${chrome.runtime.getURL("assets/pattern.png")}")`);
  rootElement.innerHTML = `
    <section id="${PANEL_ID}" aria-live="polite">
      <h1 class="apple-game-indicator-title">Apple Counter</h1>
      <p class="apple-game-indicator-status">Get ready</p>
      <div class="apple-game-indicator-summary">
        <div class="apple-game-indicator-card">
          <span class="apple-game-indicator-label">Total</span>
          <strong class="apple-game-indicator-value" data-role="total">-</strong>
        </div>
      </div>
      <div class="apple-game-indicator-grid">
        ${DIGIT_LAYOUT.map((row) => `
          <div class="apple-game-indicator-row apple-game-indicator-row-${row.length}">
            ${row.map((digit) => `
              <div class="apple-game-indicator-cell">
                <img
                  class="apple-game-indicator-fruit"
                  src="${chrome.runtime.getURL(`assets/apple-cuts/apple-${digit}.png`)}"
                  alt=""
                />
                <strong data-role="count-${digit}">-</strong>
              </div>
            `).join("")}
          </div>
        `).join("")}
      </div>
    </section>
  `;

  document.documentElement.appendChild(rootElement);
  statusElement = rootElement.querySelector(".apple-game-indicator-status");
  totalElement = rootElement.querySelector('[data-role="total"]');

  for (let digit = 1; digit <= 9; digit += 1) {
    countElements.set(digit, rootElement.querySelector(`[data-role="count-${digit}"]`));
  }
}

function renderIndicator(payload) {
  ensureOverlay();

  const state = payload?.state ?? null;
  const status = payload?.status ?? "Get ready";
  const renderKey = JSON.stringify({ status, state });
  if (renderKey === lastRenderKey) {
    return;
  }
  lastRenderKey = renderKey;

  statusElement.textContent = status;

  if (!state) {
    totalElement.textContent = "-";
    for (let digit = 1; digit <= 9; digit += 1) {
      countElements.get(digit).textContent = "-";
    }
    return;
  }

  totalElement.textContent = String(state.total);

  for (let digit = 1; digit <= 9; digit += 1) {
    countElements.get(digit).textContent = String(state.counts[digit] ?? 0);
  }
}

function injectBridgeScript() {
  if (document.querySelector('script[data-apple-game-indicator-bridge="true"]')) {
    return;
  }

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.dataset.appleGameIndicatorBridge = "true";
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function startBoardWatcher() {
  ensureOverlay();
  renderIndicator({ status: "Loading" });

  window.addEventListener(BRIDGE_EVENT, (event) => {
    renderIndicator(event.detail);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== BRIDGE_EVENT) {
      return;
    }
    renderIndicator(event.data.payload);
  });

  injectBridgeScript();
}

startBoardWatcher();
