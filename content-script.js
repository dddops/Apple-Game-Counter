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
const PANEL_GAP = 16;
const VIEWPORT_MARGIN = 12;

let rootElement = null;
let panelElement = null;
let statusElement = null;
let totalElement = null;
const countElements = new Map();
const compareElements = new Map();
let lastRenderKey = "";
let positionObserver = null;

function ensureOverlay() {
  if (rootElement && document.contains(rootElement)) {
    return;
  }

  rootElement = document.createElement("div");
  rootElement.id = ROOT_ID;
  rootElement.style.setProperty("--pattern-url", `url("${chrome.runtime.getURL("assets/pattern.png")}")`);
  rootElement.style.setProperty("--live-pattern-url", `url("${chrome.runtime.getURL("assets/live-pattern.png")}")`);
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
            ${row.map((digit, index) => `
              <div class="apple-game-indicator-cell">
                <img
                  class="apple-game-indicator-fruit"
                  src="${chrome.runtime.getURL(`assets/apple-cuts/apple-${digit}.png`)}"
                  alt=""
                />
                <strong data-role="count-${digit}">-</strong>
              </div>
              ${row.length === 2 && index === 0 ? `
                <div
                  class="apple-game-indicator-compare apple-game-indicator-compare-equal"
                  data-role="compare-${row[0]}-${row[1]}"
                >=</div>
              ` : ""}
            `).join("")}
          </div>
        `).join("")}
      </div>
    </section>
  `;

  document.documentElement.appendChild(rootElement);
  panelElement = rootElement.querySelector(`#${PANEL_ID}`);
  statusElement = rootElement.querySelector(".apple-game-indicator-status");
  totalElement = rootElement.querySelector('[data-role="total"]');

  for (let digit = 1; digit <= 9; digit += 1) {
    countElements.set(digit, rootElement.querySelector(`[data-role="count-${digit}"]`));
  }

  for (const row of DIGIT_LAYOUT) {
    if (row.length === 2) {
      compareElements.set(
        `${row[0]}-${row[1]}`,
        rootElement.querySelector(`[data-role="compare-${row[0]}-${row[1]}"]`)
      );
    }
  }

  updateOverlayPosition();
}

function findGameAnchorElement() {
  const canvases = Array.from(document.querySelectorAll("canvas"));
  if (!canvases.length) {
    return null;
  }

  return canvases
    .map((canvas) => ({
      canvas,
      area: canvas.getBoundingClientRect().width * canvas.getBoundingClientRect().height
    }))
    .sort((a, b) => b.area - a.area)[0]?.canvas || null;
}

function updateOverlayPosition() {
  ensureOverlay();

  const anchor = findGameAnchorElement();
  if (!anchor || !panelElement) {
    rootElement.style.left = `${window.innerWidth - panelElement.offsetWidth - VIEWPORT_MARGIN}px`;
    rootElement.style.top = `${VIEWPORT_MARGIN}px`;
    return;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const panelWidth = panelElement.offsetWidth || 152;
  const panelHeight = panelElement.offsetHeight || 0;

  let left = anchorRect.right + PANEL_GAP;
  if (left + panelWidth > window.innerWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, anchorRect.left - panelWidth - PANEL_GAP);
  }

  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - panelHeight - VIEWPORT_MARGIN);
  const top = Math.min(Math.max(VIEWPORT_MARGIN, anchorRect.top), maxTop);

  rootElement.style.left = `${Math.round(left)}px`;
  rootElement.style.top = `${Math.round(top)}px`;
}

function registerPositionTracking() {
  if (positionObserver) {
    return;
  }

  const onPositionChange = () => {
    updateOverlayPosition();
  };

  window.addEventListener("resize", onPositionChange, { passive: true });
  window.addEventListener("scroll", onPositionChange, { passive: true });

  positionObserver = new MutationObserver(onPositionChange);
  positionObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
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
  panelElement.classList.toggle("is-live", Boolean(state));
  updateOverlayPosition();

  if (!state) {
    totalElement.textContent = "-";
    for (let digit = 1; digit <= 9; digit += 1) {
      countElements.get(digit).textContent = "-";
    }
    for (const element of compareElements.values()) {
      element.textContent = "=";
      element.className = "apple-game-indicator-compare apple-game-indicator-compare-equal";
    }
    return;
  }

  totalElement.textContent = String(state.total);

  for (let digit = 1; digit <= 9; digit += 1) {
    countElements.get(digit).textContent = String(state.counts[digit] ?? 0);
  }

  for (const row of DIGIT_LAYOUT) {
    if (row.length !== 2) {
      continue;
    }

    const [leftDigit, rightDigit] = row;
    const leftCount = state.counts[leftDigit] ?? 0;
    const rightCount = state.counts[rightDigit] ?? 0;
    const compareElement = compareElements.get(`${leftDigit}-${rightDigit}`);
    if (!compareElement) {
      continue;
    }

    if (leftCount > rightCount) {
      compareElement.textContent = ">";
      compareElement.className = "apple-game-indicator-compare apple-game-indicator-compare-left";
      continue;
    }

    if (leftCount < rightCount) {
      compareElement.textContent = "<";
      compareElement.className = "apple-game-indicator-compare apple-game-indicator-compare-right";
      continue;
    }

    compareElement.textContent = "=";
    compareElement.className = "apple-game-indicator-compare apple-game-indicator-compare-equal";
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
  registerPositionTracking();

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
