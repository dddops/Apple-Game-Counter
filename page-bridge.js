(function pageBridge() {
  const BRIDGE_EVENT = "apple-game-indicator:update";
  const POLL_MS = 30;
  const INITIAL_WAIT_MS = 15000;
  const COMMIT_SETTLE_MS = 30;
  const RESET_IGNORE_MS = 1500;
  const CONTROL_HIT_PADDING = 10;

  let lastPayloadKey = "";
  let initialScanStartedAt = Date.now();
  let interactionDepth = 0;
  let holdUntil = 0;
  let pendingPayload = null;
  let tickTimer = null;
  let lastObservedStateKey = "";
  let resetIgnoreUntil = 0;
  let resetBaselineStateKey = "";

  function log(...args) {
    console.debug("[apple-game-indicator]", ...args);
  }

  function createEmptyCounts() {
    return {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
      7: 0,
      8: 0,
      9: 0
    };
  }

  function emit(payload) {
    const key = JSON.stringify(payload);
    if (key === lastPayloadKey) {
      return;
    }
    lastPayloadKey = key;

    window.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: payload }));
    window.postMessage({ source: BRIDGE_EVENT, payload }, "*");
  }

  function beginInteraction() {
    interactionDepth += 1;
  }

  function endInteraction() {
    interactionDepth = Math.max(0, interactionDepth - 1);
    if (interactionDepth === 0) {
      holdUntil = Date.now() + COMMIT_SETTLE_MS;
    }
  }

  function shouldHoldEmission() {
    if (interactionDepth > 0) {
      return true;
    }

    return Date.now() < holdUntil;
  }

  function flushPendingPayload() {
    if (!pendingPayload || shouldHoldEmission()) {
      return;
    }

    const payload = pendingPayload;
    pendingPayload = null;
    emit(payload);
  }

  function scheduleNextTick(delay = POLL_MS) {
    if (tickTimer) {
      window.clearTimeout(tickTimer);
    }

    tickTimer = window.setTimeout(() => {
      tickTimer = null;
      tick();
    }, delay);
  }

  function isVisibleDisplayObject(node) {
    let current = node;
    let guard = 0;
    while (current && guard < 25) {
      if (current.visible === false) {
        return false;
      }
      if (typeof current.alpha === "number" && current.alpha <= 0) {
        return false;
      }
      current = current.parent;
      guard += 1;
    }
    return true;
  }

  function looksLikeDigitText(node) {
    if (!node || typeof node.text !== "string") {
      return false;
    }

    const value = Number(node.text.trim());
    return Number.isInteger(value) && value >= 1 && value <= 9;
  }

  function parseDigit(value) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9) {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    const direct = Number(trimmed);
    if (Number.isInteger(direct) && direct >= 1 && direct <= 9) {
      return direct;
    }

    const match = trimmed.match(/[1-9]/);
    return match ? Number(match[0]) : null;
  }

  function findNodeByName(root, targetName, maxVisits) {
    if (!root) {
      return null;
    }

    const stack = [root];
    let visits = 0;

    while (stack.length && visits < maxVisits) {
      visits += 1;
      const current = stack.pop();
      if (!current) {
        continue;
      }

      if (current.name === targetName) {
        return current;
      }

      const children = Array.isArray(current.children) ? current.children : [];
      for (const child of children) {
        stack.push(child);
      }
    }

    return null;
  }

  function findVisibleTextNode(root, targetText, maxVisits = 8000) {
    if (!root) {
      return null;
    }

    const stack = [root];
    const normalizedTarget = targetText.toLowerCase();
    let visits = 0;

    while (stack.length && visits < maxVisits) {
      visits += 1;
      const current = stack.pop();
      if (!current) {
        continue;
      }

      if (
        typeof current.text === "string" &&
        current.text.trim().toLowerCase() === normalizedTarget &&
        isVisibleDisplayObject(current)
      ) {
        return current;
      }

      const children = Array.isArray(current.children) ? current.children : [];
      for (const child of children) {
        stack.push(child);
      }
    }

    return null;
  }

  function readMovieClipBoardCandidates() {
    const root = window.exportRoot || window.stage || null;
    const mg = findNodeByName(root, "mg", 5000);
    const cells = Array.isArray(mg?.children) ? mg.children : [];

    const values = [];

    for (const cell of cells) {
      if (!cell || cell.visible === false) {
        continue;
      }

      const wrappers = Array.isArray(cell.children) ? cell.children : [];
      const mks = wrappers.find((child) => child?.name === "mks");
      if (!mks) {
        continue;
      }

      const layers = Array.isArray(mks.children) ? mks.children : [];
      const mksa = layers.find((child) => child?.name === "mksa") || null;
      const mksb = layers.find((child) => child?.name === "mksb") || null;
      if (!mksa || mksa.visible === false) {
        continue;
      }
      if (mksb && mksb.visible === true) {
        continue;
      }

      const mksaChildren = Array.isArray(mksa.children) ? mksa.children : [];
      const txNu = mksaChildren.find((child) => child?.name === "txNu") || null;
      if (!txNu || txNu.visible === false) {
        continue;
      }

      const digit = parseDigit(txNu.text);
      if (digit) {
        values.push(digit);
      }
    }

    return values.length ? values : null;
  }

  function readStageCandidates() {
    const createjs = window.createjs;
    if (!createjs) {
      return null;
    }

    const roots = [
      window.stage,
      window.exportRoot,
      window.gameStage,
      window.gameRoot
    ].filter(Boolean);

    if (!roots.length) {
      return null;
    }

    const candidates = [];
    const seen = new Set();

    function visit(node, depth) {
      if (!node || depth > 12 || seen.has(node)) {
        return;
      }
      seen.add(node);

      if (looksLikeDigitText(node) && isVisibleDisplayObject(node)) {
        const text = Number(node.text.trim());
        const x = typeof node.x === "number" ? node.x : 0;
        const y = typeof node.y === "number" ? node.y : 0;
        const font = typeof node.font === "string" ? node.font : "";
        candidates.push({
          value: text,
          x,
          y,
          font,
          parent: node.parent || null
        });
      }

      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) {
        visit(child, depth + 1);
      }
    }

    for (const root of roots) {
      visit(root, 0);
    }

    if (candidates.length < 4) {
      return null;
    }

    const grouped = new Map();
    for (const candidate of candidates) {
      const groupKey = [
        candidate.parent && candidate.parent.name ? candidate.parent.name : "anon",
        candidate.font.replace(/\s+/g, " ").trim()
      ].join("|");
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey).push(candidate);
    }

    const bestGroup = [...grouped.values()].sort((a, b) => b.length - a.length)[0];
    if (!bestGroup || bestGroup.length < 4) {
      return null;
    }

    const deduped = new Map();
    for (const candidate of bestGroup) {
      const key = `${candidate.value}:${Math.round(candidate.x)}:${Math.round(candidate.y)}`;
      if (!deduped.has(key)) {
        deduped.set(key, candidate.value);
      }
    }

    const values = [...deduped.values()];
    if (values.length < 4) {
      return null;
    }

    return values;
  }

  function extractValue(item) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 1 && item <= 9) {
      return item;
    }

    if (!item || typeof item !== "object") {
      return null;
    }

    if (item.removed === true || item.dead === true || item.visible === false || item.alive === false) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(item, "isAlive") && item.isAlive === false) {
      return null;
    }

    const candidateKeys = ["value", "num", "number", "digit", "n"];
    for (const key of candidateKeys) {
      const value = item[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9) {
        return value;
      }
    }

    return null;
  }

  function flattenBoardArray(input, depth, limitState) {
    if (limitState.count > 1000 || depth > 5) {
      return [];
    }

    if (Array.isArray(input)) {
      const result = [];
      for (const item of input) {
        limitState.count += 1;
        result.push(...flattenBoardArray(item, depth + 1, limitState));
      }
      return result;
    }

    const directValue = extractValue(input);
    return directValue ? [directValue] : [];
  }

  function readGlobalBoardCandidates() {
    const names = [
      "board",
      "boards",
      "cells",
      "cellList",
      "appleList",
      "apples",
      "fruits",
      "fruitList",
      "game",
      "gameData",
      "state",
      "model",
      "root",
      "exportRoot"
    ];

    const candidateArrays = [];
    for (const name of names) {
      const value = window[name];
      if (!value) {
        continue;
      }

      if (Array.isArray(value)) {
        candidateArrays.push(value);
      } else if (typeof value === "object") {
        for (const key of Object.keys(value).slice(0, 25)) {
          if (Array.isArray(value[key])) {
            candidateArrays.push(value[key]);
          }
        }
      }
    }

    let best = null;
    for (const candidate of candidateArrays) {
      const values = flattenBoardArray(candidate, 0, { count: 0 });
      if (values.length >= 4 && (!best || values.length > best.length)) {
        best = values;
      }
    }

    return best;
  }

  function toBoardState(values) {
    if (!Array.isArray(values) || !values.length) {
      return null;
    }

    const counts = createEmptyCounts();
    let total = 0;
    let remaining = 0;

    for (const value of values) {
      if (!Number.isInteger(value) || value < 1 || value > 9) {
        continue;
      }
      counts[value] += 1;
      total += value;
      remaining += 1;
    }

    if (!remaining) {
      return null;
    }

    return {
      total,
      counts,
      remaining,
      fingerprint: values.join(",")
    };
  }

  function getStateKey(state) {
    return state ? state.fingerprint || JSON.stringify(state) : "";
  }

  function collectBoardState() {
    const movieClipValues = readMovieClipBoardCandidates();
    if (movieClipValues) {
      return toBoardState(movieClipValues);
    }

    const globalValues = readGlobalBoardCandidates();
    if (globalValues) {
      return toBoardState(globalValues);
    }

    const stageValues = readStageCandidates();
    if (stageValues) {
      return toBoardState(stageValues);
    }

    return null;
  }

  function isResetTrigger(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    const control = target.closest("button, input, a");
    if (!control) {
      return false;
    }

    const text = [
      control.textContent,
      control.getAttribute("value"),
      control.getAttribute("aria-label"),
      control.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();

    return text.includes("reset");
  }

  function getClientPoint(event) {
    if (typeof event.clientX === "number" && typeof event.clientY === "number") {
      return { x: event.clientX, y: event.clientY };
    }

    const touch = event.changedTouches?.[0] || event.touches?.[0] || null;
    if (touch) {
      return { x: touch.clientX, y: touch.clientY };
    }

    return null;
  }

  function getDisplayObjectBounds(node) {
    const candidates = [node?.parent || null, node].filter(Boolean);

    for (const candidate of candidates) {
      if (typeof candidate.getTransformedBounds === "function") {
        const bounds = candidate.getTransformedBounds();
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          return bounds;
        }
      }

      if (typeof candidate.getBounds === "function" && typeof candidate.localToGlobal === "function") {
        const bounds = candidate.getBounds();
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          const topLeft = candidate.localToGlobal(bounds.x, bounds.y);
          const bottomRight = candidate.localToGlobal(bounds.x + bounds.width, bounds.y + bounds.height);
          return {
            x: Math.min(topLeft.x, bottomRight.x),
            y: Math.min(topLeft.y, bottomRight.y),
            width: Math.abs(bottomRight.x - topLeft.x),
            height: Math.abs(bottomRight.y - topLeft.y)
          };
        }
      }
    }

    return null;
  }

  function isPointInsideBounds(point, bounds, padding = CONTROL_HIT_PADDING) {
    if (!point || !bounds) {
      return false;
    }

    return (
      point.x >= bounds.x - padding &&
      point.x <= bounds.x + bounds.width + padding &&
      point.y >= bounds.y - padding &&
      point.y <= bounds.y + bounds.height + padding
    );
  }

  function getRuntimeRoot() {
    return window.exportRoot || window.stage || window.gameRoot || window.gameStage || null;
  }

  function isCanvasControlHit(event, text) {
    const point = getClientPoint(event);
    const textNode = findVisibleTextNode(getRuntimeRoot(), text);
    const bounds = getDisplayObjectBounds(textNode);
    return isPointInsideBounds(point, bounds);
  }

  function startResetWindow() {
    resetIgnoreUntil = Date.now() + RESET_IGNORE_MS;
    resetBaselineStateKey = lastObservedStateKey;
    pendingPayload = null;
    lastPayloadKey = "";
    emit({
      status: "Get ready",
      state: null
    });
    scheduleNextTick(0);
  }

  function normalizeStateDuringReset(state) {
    if (Date.now() >= resetIgnoreUntil) {
      return state;
    }

    const stateKey = getStateKey(state);
    if (!state || !stateKey || stateKey === resetBaselineStateKey) {
      return null;
    }

    resetIgnoreUntil = 0;
    resetBaselineStateKey = "";
    return state;
  }

  function computeStatus(state) {
    if (state) {
      return "Counting...";
    }

    if (!window.createjs && Date.now() - initialScanStartedAt < INITIAL_WAIT_MS) {
      return "Get ready";
    }

    return "Get ready";
  }

  function tick() {
    let state = null;
    try {
      state = collectBoardState();
    } catch (error) {
      log("collector failed", error);
    }

    state = normalizeStateDuringReset(state);
    const stateKey = getStateKey(state);

    const payload = {
      status: computeStatus(state),
      state
    };

    if (state) {
      lastObservedStateKey = stateKey;
    }

    if (shouldHoldEmission()) {
      pendingPayload = payload;
      scheduleNextTick();
      return;
    }

    pendingPayload = null;
    emit(payload);
    scheduleNextTick();
  }

  window.addEventListener("mousedown", beginInteraction, true);
  window.addEventListener("touchstart", beginInteraction, true);
  window.addEventListener("pointerdown", beginInteraction, true);
  window.addEventListener("mouseup", endInteraction, true);
  window.addEventListener("touchend", endInteraction, true);
  window.addEventListener("touchcancel", endInteraction, true);
  window.addEventListener("pointerup", endInteraction, true);
  window.addEventListener("pointercancel", endInteraction, true);
  window.addEventListener("blur", () => {
    interactionDepth = 0;
    holdUntil = 0;
    flushPendingPayload();
  });
  window.addEventListener("click", (event) => {
    if (isResetTrigger(event.target)) {
      startResetWindow();
    }
  }, true);
  window.addEventListener("mouseup", (event) => {
    if (isCanvasControlHit(event, "Reset")) {
      startResetWindow();
    }
  }, true);
  window.addEventListener("touchend", (event) => {
    if (isCanvasControlHit(event, "Reset")) {
      startResetWindow();
    }
  }, true);

  tick();
  window.setInterval(flushPendingPayload, 50);
})();
