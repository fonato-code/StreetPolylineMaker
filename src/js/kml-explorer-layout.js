import { STORAGE_KEYS } from "./constants.js";

const MIN_SIDEBAR = 200;
const MIN_MAP = 240;
const DEFAULT_SIDEBAR = 360;
const MAX_SIDEBAR_CAP = 720;

/**
 * @param {number} px
 * @param {number} maxPx
 */
function clampSidebar(px, maxPx) {
  const lo = MIN_SIDEBAR;
  const hi = Math.max(lo, maxPx);
  return Math.min(hi, Math.max(lo, Math.round(px)));
}

/**
 * Largura máxima da sidebar para ainda caber o mapa com `MIN_MAP`.
 */
function maxSidebarForViewport() {
  return Math.min(MAX_SIDEBAR_CAP, Math.max(MIN_SIDEBAR, window.innerWidth - MIN_MAP));
}

/**
 * @param {HTMLElement} bodyEl
 * @param {HTMLElement} resizer
 */
function applySidebarWidth(bodyEl, resizer, px) {
  const maxPx = maxSidebarForViewport();
  const w = clampSidebar(px, maxPx);
  bodyEl.style.setProperty("--kml-sidebar-width", `${w}px`);
  resizer.setAttribute("aria-valuemax", String(maxPx));
  resizer.setAttribute("aria-valuenow", String(w));
  return w;
}

/**
 * Arrastar o separador entre camadas e mapa; largura persistida.
 * @param {{ bodyEl: HTMLElement | null; sidebar: HTMLElement | null; resizer: HTMLElement | null }} opts
 */
export function initKmlExplorerSidebarResize(opts) {
  const { bodyEl, sidebar, resizer } = opts;
  if (!bodyEl || !sidebar || !resizer) {
    return;
  }

  const stored = parseInt(localStorage.getItem(STORAGE_KEYS.kmlExplorerSidebarWidthPx) || "", 10);
  const initial = Number.isFinite(stored) ? stored : DEFAULT_SIDEBAR;
  applySidebarWidth(bodyEl, resizer, initial);

  const notify = () => {
    window.dispatchEvent(new CustomEvent("kml-explorer-sidebar-resize"));
  };

  let dragStartX = 0;
  let dragStartW = 0;
  /** @type {number | null} */
  let activePointer = null;

  const onWindowResize = () => {
    const rect = sidebar.getBoundingClientRect();
    applySidebarWidth(bodyEl, resizer, rect.width);
    notify();
  };
  window.addEventListener("resize", onWindowResize);

  resizer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    activePointer = e.pointerId;
    dragStartX = e.clientX;
    dragStartW = sidebar.getBoundingClientRect().width;
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add("kml-explorer-resizer--dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  resizer.addEventListener("pointermove", (e) => {
    if (activePointer !== e.pointerId) {
      return;
    }
    const dx = e.clientX - dragStartX;
    applySidebarWidth(bodyEl, resizer, dragStartW + dx);
    notify();
  });

  const endDrag = (e) => {
    if (activePointer !== e.pointerId) {
      return;
    }
    if (resizer.hasPointerCapture(e.pointerId)) {
      resizer.releasePointerCapture(e.pointerId);
    }
    activePointer = null;
    resizer.classList.remove("kml-explorer-resizer--dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const w = sidebar.getBoundingClientRect().width;
    localStorage.setItem(STORAGE_KEYS.kmlExplorerSidebarWidthPx, String(Math.round(w)));
    notify();
  };

  resizer.addEventListener("pointerup", endDrag);
  resizer.addEventListener("pointercancel", endDrag);

  resizer.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
      return;
    }
    e.preventDefault();
    const w = sidebar.getBoundingClientRect().width;
    const next = e.key === "ArrowRight" ? w + step : w - step;
    const applied = applySidebarWidth(bodyEl, resizer, next);
    localStorage.setItem(STORAGE_KEYS.kmlExplorerSidebarWidthPx, String(applied));
    notify();
  });
}
