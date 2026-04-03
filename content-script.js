const ROOT_ID = "apple-game-indicator-root";
const PANEL_ID = "apple-game-indicator-panel";
const BRIDGE_EVENT = "apple-game-indicator:update";

let rootElement = null;
let statusElement = null;
let totalElement = null;
let remainingElement = null;
const countElements = new Map();
let lastRenderKey = "";

function ensureOverlay() {
  if (rootElement && document.contains(rootElement)) {
    return;
  }

  rootElement = document.createElement("div");
  rootElement.id = ROOT_ID;
  rootElement.innerHTML = `
    <section id="${PANEL_ID}" aria-live="polite">
      <h1 class="apple-game-indicator-title">Apple Game Indicator</h1>
      <p class="apple-game-indicator-status">게임 시작 대기 중...</p>
      <div class="apple-game-indicator-summary">
        <div class="apple-game-indicator-card">
          <span class="apple-game-indicator-label">합계</span>
          <strong class="apple-game-indicator-value" data-role="total">-</strong>
        </div>
        <div class="apple-game-indicator-card">
          <span class="apple-game-indicator-label">남은 사과 수</span>
          <strong class="apple-game-indicator-value" data-role="remaining">-</strong>
        </div>
      </div>
      <div class="apple-game-indicator-grid">
        ${Array.from({ length: 9 }, (_, index) => {
          const digit = index + 1;
          return `
            <div class="apple-game-indicator-cell">
              ${digit}
              <strong data-role="count-${digit}">-</strong>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;

  document.documentElement.appendChild(rootElement);
  statusElement = rootElement.querySelector(".apple-game-indicator-status");
  totalElement = rootElement.querySelector('[data-role="total"]');
  remainingElement = rootElement.querySelector('[data-role="remaining"]');

  for (let digit = 1; digit <= 9; digit += 1) {
    countElements.set(digit, rootElement.querySelector(`[data-role="count-${digit}"]`));
  }
}

function renderIndicator(payload) {
  ensureOverlay();

  const state = payload?.state ?? null;
  const status = payload?.status ?? "게임 시작 대기 중...";
  const renderKey = JSON.stringify({ status, state });
  if (renderKey === lastRenderKey) {
    return;
  }
  lastRenderKey = renderKey;

  statusElement.textContent = status;

  if (!state) {
    totalElement.textContent = "-";
    remainingElement.textContent = "-";
    for (let digit = 1; digit <= 9; digit += 1) {
      countElements.get(digit).textContent = "-";
    }
    return;
  }

  totalElement.textContent = String(state.total);
  remainingElement.textContent = String(state.remaining);

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
  renderIndicator({ status: "읽는 중..." });

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
