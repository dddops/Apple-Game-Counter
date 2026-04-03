(function pageBridge() {
  const BRIDGE_EVENT = "apple-game-indicator:update";
  const POLL_MS = 250;
  const INITIAL_WAIT_MS = 15000;

  let lastPayloadKey = "";
  let initialScanStartedAt = Date.now();

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

    return { total, counts, remaining };
  }

  function collectBoardState() {
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

  function computeStatus(state) {
    if (state) {
      return "실시간 분석 중";
    }

    if (!window.createjs && Date.now() - initialScanStartedAt < INITIAL_WAIT_MS) {
      return "게임 시작 대기 중...";
    }

    return "분석 실패: 런타임 보드 상태를 찾지 못했습니다";
  }

  function tick() {
    let state = null;
    try {
      state = collectBoardState();
    } catch (error) {
      log("collector failed", error);
    }

    emit({
      status: computeStatus(state),
      state
    });
  }

  tick();
  window.setInterval(tick, POLL_MS);
})();
