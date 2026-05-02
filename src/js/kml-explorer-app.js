import { STORAGE_KEYS, DRAFT_VERSION, generateRouteId } from "./constants.js";
import { distanceMeters } from "./geo-utils.js";
import { loadGoogleMapsApi } from "./google-maps-script.js";
import { fileToKmlString } from "./kml-read.js";
import {
  parseKmlToForest,
  collectPlacemarkNodes,
  extractPlacemarkGeometries,
  enrichKmlForest,
  pruneEmptyKmlNodes,
  countKmlForestStats,
  kmlDescriptionPlainText,
} from "./kml-xml-tree.js";

const GEOM_KINDS_OTHER = new Set(["model", "track", "unsupported", "empty"]);
const KML_TREE_DND_MIME = "application/x-kml-tree-ids";

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeDropFolderId(raw) {
  if (raw == null) {
    return null;
  }
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

/**
 * @param {DataTransfer} dt
 * @returns {string[]}
 */
function parseDragIds(dt) {
  /** Somente tipos que gravamos no dragstart — evita JSON.parse em dados estranhos de outros MIMEs. */
  const attempts = [KML_TREE_DND_MIME, "text/plain", "Text"];
  for (const mime of attempts) {
    let raw = "";
    try {
      raw = dt.getData(mime);
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "string") {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        continue;
      }
      const ids = parsed
        .map((x) => (x == null ? "" : String(x)).trim())
        .filter((x) => x.length > 0);
      if (ids.length > 0) {
        return ids;
      }
    } catch {
      continue;
    }
  }
  return [];
}

function collectDescendantFolders(folderNode) {
  const out = [];
  if (folderNode.kind !== "folder" || !folderNode.children) {
    return out;
  }
  for (const c of folderNode.children) {
    if (c.kind === "folder") {
      out.push(c);
      out.push(...collectDescendantFolders(c));
    }
  }
  return out;
}

export class KmlExplorerApp {
  constructor() {
    this.mapsApiModalLocked = false;
    this.google = null;
    this.map = null;
    this.mapReady = false;
    this.nodesById = new Map();
    this.overlaysById = new Map();
    this.streetViewService = null;
    this.streetViewPanorama = null;
    this.streetViewVisible = false;
    this.streetViewResize = { active: false, startY: 0, startHeight: 0 };

    this.elements = {
      mapEl: document.getElementById("kmlExplorerMap"),
      mapStage: document.getElementById("kmlMapStage"),
      streetViewPanel: document.getElementById("kmlStreetViewPanel"),
      streetViewPano: document.getElementById("kmlStreetViewPano"),
      closeStreetView: document.getElementById("kmlCloseStreetView"),
      streetViewResizeHandle: document.getElementById("kmlStreetViewResizeHandle"),
      treeRoot: document.getElementById("kmlTreeRoot"),
      layerFilter: document.getElementById("kmlLayerFilter"),
      fileInput: document.getElementById("kmlFileInput"),
      statusEl: document.getElementById("kmlExplorerStatus"),
      fitBoundsBtn: document.getElementById("kmlFitBoundsBtn"),
      openMapsApiModal: document.getElementById("openMapsApiModal"),
      mapsApiModal: document.getElementById("mapsApiModal"),
      closeMapsApiModal: document.getElementById("closeMapsApiModal"),
      apiKey: document.getElementById("apiKey"),
      saveApiKey: document.getElementById("saveApiKey"),
      loadMap: document.getElementById("loadMap"),
      toastEl: document.getElementById("kmlExplorerToast"),
    };

    /** @type {ReturnType<typeof setTimeout> | null} */
    this._filterDebounce = null;

    /** @type {Set<string>} */
    this.geomFilterKinds = new Set();

    /** @type {Set<string>} */
    this.selectedIds = new Set();
    /** @type {string|null} */
    this.selectionAnchorId = null;
    /** @type {import("./kml-xml-tree.js").KmlTreeNode[]|null} */
    this.forestRoots = null;
    /** @type {Document|null} */
    this.lastKmlXmlDoc = null;

    /** Evita dois drops simultâneos (listeners duplicados / bubbling). */
    this._treeMoveActive = false;

    /** Ignora o click que alguns navegadores disparam logo após um drag na árvore (evita perder multi-seleção). */
    this._suppressTreeClickAfterDrag = false;

    /** @type {ReturnType<typeof setTimeout> | null} */
    this._toastHideTimer = null;
    /** @type {string[]} */
    this._treeContextMenuIds = [];
    /** @type {HTMLDivElement|null} */
    this._treeContextMenuEl = null;
    /** @type {boolean} */
    this._treeContextMenuBound = false;

    this.attachUiEvents();
    this.restoreKeyHint();
    window.addEventListener("kml-explorer-sidebar-resize", () => this.triggerMapResize());
    void this.bootstrapMapsFlow();
  }

  triggerMapResize() {
    if (!this.google?.maps?.event) {
      return;
    }
    if (this.map) {
      this.google.maps.event.trigger(this.map, "resize");
    }
    if (this.streetViewPanorama && this.streetViewVisible) {
      this.google.maps.event.trigger(this.streetViewPanorama, "resize");
    }
  }

  attachUiEvents() {
    this.elements.openMapsApiModal.addEventListener("click", () => this.openMapsApiSettings());
    this.elements.closeMapsApiModal.addEventListener("click", () => this.elements.mapsApiModal.close());
    this.elements.mapsApiModal.addEventListener("cancel", (event) => {
      if (this.mapsApiModalLocked) {
        event.preventDefault();
      }
    });
    this.elements.mapsApiModal.addEventListener("click", (event) => {
      if (event.target === this.elements.mapsApiModal && !this.mapsApiModalLocked) {
        this.elements.mapsApiModal.close();
      }
    });
    this.elements.saveApiKey.addEventListener("click", () => this.saveApiKey());
    this.elements.loadMap.addEventListener("click", () => void this.loadMap());
    this.elements.fileInput.addEventListener("change", (event) => void this.onFileSelected(event));
    this.elements.fitBoundsBtn.addEventListener("click", () => this.fitVisibleBounds());

    this.elements.treeRoot.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-vis-toggle]");
      if (btn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        const { nodeId: id, kind } = btn.dataset;
        if (!id || !kind) {
          return;
        }
        const node = this.nodesById.get(id);
        if (!node) {
          return;
        }
        const next = btn.getAttribute("aria-pressed") !== "true";
        this.setVisToggleButtonUi(btn, next);
        if (kind === "folder") {
          this.applyFolderVisibility(node, next);
          return;
        }
        if (kind === "placemark") {
          if (next) {
            this.showPlacemark(node);
          } else {
            this.hidePlacemark(node);
          }
        }
        return;
      }

      if (this._suppressTreeClickAfterDrag) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const li = event.target.closest("li.kml-tree-item[data-node-id]");
      if (!(li instanceof HTMLLIElement)) {
        return;
      }
      if (event.target.closest(".kml-tree-chevron")) {
        return;
      }
      const nid = li.dataset.nodeId;
      if (!nid) {
        return;
      }
      const tnode = this.nodesById.get(nid);
      if (!tnode || tnode.kind === "unsupported") {
        return;
      }

      const detailsEl = li.querySelector(":scope > details.kml-tree-folder");
      if (detailsEl && event.target.closest("summary")) {
        event.preventDefault();
      }

      if (event.shiftKey) {
        this.extendSelectionTo(nid);
      } else if (event.ctrlKey || event.metaKey) {
        this.toggleSelection(nid);
        this.selectionAnchorId = nid;
      } else {
        this.selectSingle(nid);
        this.selectionAnchorId = nid;
      }
      this.syncSelectionDom();
    });

    document.addEventListener("dragend", () => {
      this.clearTreeDropHighlights();
      this.syncSelectionDom();
      this._suppressTreeClickAfterDrag = true;
      window.setTimeout(() => {
        this._suppressTreeClickAfterDrag = false;
      }, 120);
    });

    if (this.elements.layerFilter) {
      this.elements.layerFilter.addEventListener("input", () => {
        if (this._filterDebounce != null) {
          window.clearTimeout(this._filterDebounce);
          this._filterDebounce = null;
        }
        const raw = (this.elements.layerFilter.value || "").trim();
        if (raw === "") {
          this.applyTreeFilter();
          return;
        }
        this._filterDebounce = window.setTimeout(() => {
          this._filterDebounce = null;
          this.applyTreeFilter();
        }, 120);
      });
    }

    document.querySelectorAll(".kml-geom-chip[data-geom-kind]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const k = chip.dataset.geomKind;
        if (!k) {
          return;
        }
        if (this.geomFilterKinds.has(k)) {
          this.geomFilterKinds.delete(k);
          chip.classList.remove("kml-geom-chip--on");
        } else {
          this.geomFilterKinds.add(k);
          chip.classList.add("kml-geom-chip--on");
        }
        this.applyTreeFilter();
      });
    });

    this.elements.closeStreetView?.addEventListener("click", () => this.closeStreetViewPanel());
    this.elements.streetViewResizeHandle?.addEventListener("mousedown", (event) =>
      this.startStreetViewResize(event),
    );
    window.addEventListener("mousemove", (event) => this.handleStreetViewResize(event));
    window.addEventListener("mouseup", () => this.stopStreetViewResize());

    this.attachTreeContextMenu();
  }

  iconClassForGeomKind(kind) {
    const map = {
      point: "fa-map-marker-alt",
      line: "fa-grip-lines",
      polygon: "fa-draw-polygon",
      ring: "fa-vector-square",
      model: "fa-cube",
      track: "fa-location-arrow",
      unsupported: "fa-unlink",
      empty: "fa-inbox",
    };
    return map[kind] || "fa-question";
  }

  /**
   * @param {string[]} kinds
   */
  appendFolderGeomBadges(summary, kinds) {
    const wrap = document.createElement("span");
    wrap.className = "kml-folder-badges";
    const uniq = [...new Set(kinds)].sort();
    for (const k of uniq) {
      const badge = document.createElement("span");
      badge.className = `kml-folder-badge kml-folder-badge--${k}`;
      badge.title = k;
      const i = document.createElement("i");
      i.className = `fas ${this.iconClassForGeomKind(k)}`;
      i.setAttribute("aria-hidden", "true");
      badge.appendChild(i);
      wrap.appendChild(badge);
    }
    summary.appendChild(wrap);
  }

  /**
   * @param {string[]|undefined} kinds
   */
  primaryLeafIconClass(kinds) {
    const order = ["polygon", "line", "point", "ring", "model", "track", "unsupported", "empty"];
    const list = kinds || [];
    for (const o of order) {
      if (list.includes(o)) {
        return this.iconClassForGeomKind(o);
      }
    }
    return "fa-draw-polygon";
  }

  /**
   * @param {string[]} kinds
   */
  geomKindMatchesFilter(kinds) {
    if (this.geomFilterKinds.size === 0) {
      return true;
    }
    const list = kinds || [];
    if (list.length === 0) {
      return false;
    }
    for (const k of list) {
      if (this.geomFilterKinds.has(k)) {
        return true;
      }
      if (GEOM_KINDS_OTHER.has(k) && this.geomFilterKinds.has("other")) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {HTMLButtonElement} btn
   * @param {boolean} on
   */
  setVisToggleButtonUi(btn, on) {
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("kml-vis-toggle--on", on);
    const icon = btn.querySelector("i");
    if (icon) {
      icon.className = on ? "fas fa-eye" : "fas fa-eye-slash";
    }
  }

  /**
   * @param {string} nodeId
   * @param {"folder"|"placemark"} kind
   * @param {boolean} on
   */
  syncVisToggleInDom(nodeId, kind, on) {
    const btn = this.elements.treeRoot.querySelector(
      `button[data-vis-toggle][data-node-id="${nodeId}"][data-kind="${kind}"]`,
    );
    if (btn instanceof HTMLButtonElement) {
      this.setVisToggleButtonUi(btn, on);
    }
  }

  createVisToggleButton(nodeId, kind, on) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.draggable = false;
    btn.className = `kml-vis-toggle${on ? " kml-vis-toggle--on" : ""}`;
    btn.dataset.visToggle = "";
    btn.dataset.nodeId = nodeId;
    btn.dataset.kind = kind;
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute(
      "aria-label",
      kind === "folder" ? "Mostrar ou ocultar geometrias desta pasta no mapa" : "Mostrar ou ocultar este placemark no mapa",
    );
    btn.innerHTML = on
      ? "<i class=\"fas fa-eye\" aria-hidden=\"true\"></i>"
      : "<i class=\"fas fa-eye-slash\" aria-hidden=\"true\"></i>";
    return btn;
  }

  applyTreeFilter() {
    const q = (this.elements.layerFilter?.value || "").trim().toLowerCase();
    const root = this.elements.treeRoot;
    const ul = root.querySelector(":scope > ul.kml-tree-root-list");
    if (!ul) {
      return;
    }
    // Sem isto, combinacao de filtro + lazy render pode deixar `hidden` preso em nos que deixam de bater com o criterio atual.
    for (const li of root.querySelectorAll("li.kml-tree-item")) {
      li.hidden = false;
    }
    for (const li of ul.querySelectorAll(":scope > li.kml-tree-item")) {
      this.filterTreeItem(li, q);
    }
  }

  /**
   * @param {HTMLLIElement} li
   * @param {string} q
   * @returns {boolean}
   */
  filterTreeItem(li, q) {
    const name = (li.dataset.kmlSearch || "").toLowerCase();
    const textOk = !q || name.includes(q);
    const kinds = (li.dataset.geomKinds || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const geomOk = this.geomKindMatchesFilter(kinds);
    const selfMatch = textOk && geomOk;

    const details = li.querySelector(":scope > details.kml-tree-folder");
    if (!details) {
      li.hidden = !selfMatch;
      return selfMatch;
    }

    const nested = details.querySelector(":scope > ul.kml-tree-nested");
    let childMatch = false;
    if (nested) {
      for (const childLi of nested.querySelectorAll(":scope > li.kml-tree-item")) {
        childMatch ||= this.filterTreeItem(childLi, q);
      }
    }
    const show = selfMatch || childMatch;
    li.hidden = !show;
    return show;
  }

  restoreKeyHint() {
    const savedKey = localStorage.getItem(STORAGE_KEYS.apiKey);
    if (savedKey && !this.elements.apiKey.value) {
      this.elements.apiKey.value = savedKey;
    }
  }

  openMapsApiGate() {
    this.mapsApiModalLocked = true;
    this.elements.closeMapsApiModal.hidden = true;
    this.elements.mapsApiModal.showModal();
  }

  openMapsApiSettings() {
    this.mapsApiModalLocked = false;
    this.elements.closeMapsApiModal.hidden = false;
    this.elements.mapsApiModal.showModal();
  }

  saveApiKey() {
    const apiKey = this.elements.apiKey.value.trim();
    if (!apiKey) {
      this.setStatus("Informe uma chave valida antes de salvar.", true);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    this.setStatus("Chave salva no navegador.");
  }

  finalizeMapsSession(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return;
    }
    sessionStorage.setItem(STORAGE_KEYS.apiKey, trimmed);
    this.mapsApiModalLocked = false;
    if (this.elements.mapsApiModal.open) {
      this.elements.mapsApiModal.close();
    }
    this.elements.closeMapsApiModal.hidden = false;
  }

  async bootstrapMapsFlow() {
    const sessionKey = sessionStorage.getItem(STORAGE_KEYS.apiKey);
    if (sessionKey) {
      this.elements.apiKey.value = sessionKey;
      const ok = await this.loadMap();
      if (!ok) {
        sessionStorage.removeItem(STORAGE_KEYS.apiKey);
        this.openMapsApiGate();
      }
      return;
    }
    this.openMapsApiGate();
  }

  async loadMap() {
    const apiKey = this.elements.apiKey.value.trim() || localStorage.getItem(STORAGE_KEYS.apiKey) || "";
    if (!apiKey) {
      this.setStatus("Informe a API key do Google Maps.", true);
      return false;
    }

    this.setStatus("Carregando Google Maps...");
    try {
      this.google = await loadGoogleMapsApi(apiKey);
    } catch (error) {
      this.setStatus(`Falha ao carregar Google Maps: ${error.message}`, true);
      return false;
    }

    if (!this.mapReady) {
      this.initializeMap();
    }

    this.finalizeMapsSession(apiKey);
    this.setStatus("Mapa pronto. Importe um KML ou KMZ.");
    return true;
  }

  initializeMap() {
    const center = { lat: -23.55052, lng: -46.633308 };
    this.map = new this.google.maps.Map(this.elements.mapEl, {
      center,
      zoom: 8,
      mapTypeId: "roadmap",
      fullscreenControl: true,
      streetViewControl: false,
      mapTypeControl: true,
      styles: [
        { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
        { featureType: "poi", stylers: [{ visibility: "off" }] },
      ],
    });
    this.streetViewService = new this.google.maps.StreetViewService();
    this.streetViewPanorama = null;
    this.mapReady = true;
  }

  ensureStreetViewPanorama() {
    const panoEl = this.elements.streetViewPano;
    if (!this.mapReady || !panoEl || this.streetViewPanorama) {
      return;
    }
    this.streetViewPanorama = new this.google.maps.StreetViewPanorama(panoEl, {
      visible: false,
      addressControl: true,
      linksControl: true,
      panControl: true,
      enableCloseButton: false,
      fullscreenControl: false,
    });
  }

  /**
   * Abre o painel Street View junto ao ponto (como no editor principal).
   * @param {{ lat: number, lng: number }} location
   */
  applyStreetViewNear(location) {
    if (!this.mapReady || !this.streetViewService || !location) {
      return;
    }
    this.ensureStreetViewPanorama();
    if (!this.streetViewPanorama) {
      return;
    }
    const stage = this.elements.mapStage;
    const panel = this.elements.streetViewPanel;
    const handle = this.elements.streetViewResizeHandle;
    if (!stage || !panel || !handle) {
      return;
    }

    this.streetViewService.getPanorama({ location, radius: 100 }, (data, status) => {
      if (!this.mapReady || !this.streetViewPanorama) {
        return;
      }
      if (status !== this.google.maps.StreetViewStatus.OK) {
        this.setStatus("Street View indisponivel perto deste ponto.", true);
        return;
      }
      this.streetViewPanorama.setPano(data.location.pano);
      this.streetViewPanorama.setPov({ heading: 0, pitch: 0 });
      this.streetViewPanorama.setVisible(true);
      panel.hidden = false;
      handle.hidden = false;
      stage.classList.add("map-stage--split");
      const panelHeight = stage.style.getPropertyValue("--street-view-panel-height").trim();
      if (!panelHeight) {
        const h = Math.round(stage.clientHeight * 0.38);
        stage.style.setProperty("--street-view-panel-height", `${Math.max(160, Math.min(h, 520))}px`);
      }
      this.streetViewVisible = true;
      window.requestAnimationFrame(() => {
        this.google.maps.event.trigger(this.map, "resize");
        this.google.maps.event.trigger(this.streetViewPanorama, "resize");
      });
    });
  }

  closeStreetViewPanel() {
    if (this.streetViewPanorama) {
      this.streetViewPanorama.setVisible(false);
    }
    const panel = this.elements.streetViewPanel;
    const handle = this.elements.streetViewResizeHandle;
    const stage = this.elements.mapStage;
    if (panel) {
      panel.hidden = true;
    }
    if (handle) {
      handle.hidden = true;
    }
    if (stage) {
      stage.classList.remove("map-stage--split");
    }
    this.streetViewVisible = false;
    if (this.mapReady && this.google?.maps?.event) {
      window.requestAnimationFrame(() => {
        this.google.maps.event.trigger(this.map, "resize");
      });
    }
  }

  startStreetViewResize(event) {
    const panel = this.elements.streetViewPanel;
    if (!this.streetViewVisible || !panel) {
      return;
    }
    this.streetViewResize.active = true;
    this.streetViewResize.startY = event.clientY;
    this.streetViewResize.startHeight = panel.getBoundingClientRect().height;
    document.body.classList.add("is-resizing-street");
    event.preventDefault();
  }

  handleStreetViewResize(event) {
    if (!this.streetViewResize.active) {
      return;
    }
    const stage = this.elements.mapStage;
    if (!stage) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    const handleHeight = 6;
    const mapMin = 120;
    const panelMin = 120;
    const maxPanel = rect.height - mapMin - handleHeight;
    const delta = event.clientY - this.streetViewResize.startY;
    let next = this.streetViewResize.startHeight - delta;
    next = Math.max(panelMin, Math.min(maxPanel, next));
    stage.style.setProperty("--street-view-panel-height", `${Math.round(next)}px`);
    if (this.map) {
      this.google.maps.event.trigger(this.map, "resize");
    }
    if (this.streetViewPanorama) {
      this.google.maps.event.trigger(this.streetViewPanorama, "resize");
    }
  }

  stopStreetViewResize() {
    if (!this.streetViewResize.active) {
      return;
    }
    this.streetViewResize.active = false;
    document.body.classList.remove("is-resizing-street");
  }

  setStatus(message, isError = false) {
    this.elements.statusEl.textContent = message;
    this.elements.statusEl.classList.toggle("error-text", isError);
  }

  attachTreeContextMenu() {
    if (this._treeContextMenuBound) {
      return;
    }
    this._treeContextMenuBound = true;

    const menu = document.createElement("div");
    menu.id = "kmlTreeContextMenu";
    menu.className = "kml-tree-context-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    const item = document.createElement("button");
    item.type = "button";
    item.className = "kml-tree-context-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = "Exportar para historico";
    menu.appendChild(item);
    document.body.appendChild(menu);
    this._treeContextMenuEl = menu;

    const hideMenu = () => {
      menu.hidden = true;
      this._treeContextMenuIds = [];
    };

    item.addEventListener("click", () => {
      const ids = [...this._treeContextMenuIds];
      hideMenu();
      void this.exportIdsToHistoryClipboard(ids);
    });

    document.addEventListener(
      "mousedown",
      (e) => {
        if (!menu.hidden && e.target instanceof Node && !menu.contains(e.target)) {
          hideMenu();
        }
      },
      true,
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        hideMenu();
      }
    });

    window.addEventListener("blur", hideMenu);

    this.elements.treeRoot.addEventListener("contextmenu", (event) => {
      if (!this.forestRoots) {
        return;
      }
      const li = event.target.closest("li.kml-tree-item[data-node-id]");
      if (!(li instanceof HTMLLIElement)) {
        return;
      }
      const nid = (li.dataset.nodeId || "").trim();
      if (!nid) {
        return;
      }
      const tnode = this.nodesById.get(nid);
      if (!tnode || tnode.kind === "unsupported") {
        return;
      }

      event.preventDefault();

      let ids = [...this.selectedIds];
      if (!this.selectedIds.has(nid)) {
        ids = [nid];
      }
      this._treeContextMenuIds = ids;

      const x = event.clientX;
      const y = event.clientY;
      menu.hidden = false;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;

      window.requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        const pad = 8;
        let left = x;
        let top = y;
        if (rect.right > window.innerWidth - pad) {
          left = Math.max(pad, window.innerWidth - rect.width - pad);
        }
        if (rect.bottom > window.innerHeight - pad) {
          top = Math.max(pad, window.innerHeight - rect.height - pad);
        }
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
      });
    });
  }

  /**
   * @param {string[]} ids
   */
  collectPlacemarksForHistoryExport(ids) {
    /** @type {import("./kml-xml-tree.js").KmlTreeNode[]} */
    const out = [];
    const seen = new Set();
    for (const id of ids) {
      const node = this.nodesById.get(id);
      if (!node) {
        continue;
      }
      if (node.kind === "placemark") {
        if (!seen.has(node.id)) {
          seen.add(node.id);
          out.push(node);
        }
      } else if (node.kind === "folder") {
        for (const pm of collectPlacemarkNodes(node)) {
          if (!seen.has(pm.id)) {
            seen.add(pm.id);
            out.push(pm);
          }
        }
      }
    }
    return out;
  }

  /**
   * @param {import("./kml-xml-tree.js").LatLngLiteral[]} path
   */
  stripClosingLatLngRing(path) {
    if (!path || path.length < 2) {
      return path ? [...path] : [];
    }
    const first = path[0];
    const last = path[path.length - 1];
    const close =
      Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lng - last.lng) < 1e-9;
    const core = close ? path.slice(0, -1) : [...path];
    return core.filter((pt) => pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
  }

  /**
   * @param {{ type: string, path?: import("./kml-xml-tree.js").LatLngLiteral[], paths?: import("./kml-xml-tree.js").LatLngLiteral[][] }} g
   * @returns {import("./kml-xml-tree.js").LatLngLiteral[]}
   */
  flattenGeometryForHistoryExport(g) {
    if (!g?.type) {
      return [];
    }
    if (g.type === "Point" || g.type === "LineString") {
      const p = g.path || [];
      return p.filter((pt) => pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
    }
    if (g.type === "LinearRing") {
      return this.stripClosingLatLngRing(g.path || []);
    }
    if (g.type === "Polygon" && g.paths?.length) {
      return this.stripClosingLatLngRing(g.paths[0] || []);
    }
    return [];
  }

  /**
   * Monta o mesmo JSON que o editor grava em `localStorage` (`persistDraft`).
   * @param {import("./kml-xml-tree.js").KmlTreeNode[]} placemarks
   */
  buildHistoryDraftFromPlacemarks(placemarks) {
    if (!placemarks.length) {
      return null;
    }

    const sortedIds = this.sortIdsByVisibleOrder(placemarks.map((p) => p.id));
    const byId = new Map(placemarks.map((p) => [p.id, p]));
    const ordered = sortedIds.map((id) => byId.get(id)).filter(Boolean);

    /** @type {{ id: number, longitude: number, latitude: number, km: string, rodovia: string, raio: number, sentido: string, nome: string }[]} */
    const anchors = [];
    let seq = 1;
    let kmAcc = 0;
    /** @type {{ lat: number, lng: number } | null} */
    let lastCoord = null;

    const pushVertex = (lat, lng, nome) => {
      const coord = { lat: Number(lat), lng: Number(lng) };
      if (!Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) {
        return;
      }
      if (lastCoord) {
        kmAcc += distanceMeters(lastCoord, coord) / 1000;
      }
      const label = (nome || "").trim().slice(0, 240);
      anchors.push({
        id: seq++,
        longitude: coord.lng,
        latitude: coord.lat,
        km: kmAcc.toFixed(3),
        rodovia: "",
        raio: 500,
        sentido: "N",
        nome: label,
      });
      lastCoord = coord;
    };

    for (const pm of ordered) {
      if (!pm.element) {
        continue;
      }
      const { geometries, error } = extractPlacemarkGeometries(pm.element);
      if (error || !geometries?.length) {
        continue;
      }
      const nome = (pm.name || "").trim();
      for (const g of geometries) {
        const pts = this.flattenGeometryForHistoryExport(g);
        for (const pt of pts) {
          pushVertex(pt.lat, pt.lng, nome);
        }
      }
    }

    if (anchors.length === 0) {
      return null;
    }

    const route = {
      id: generateRouteId(),
      roadName: "KML",
      direction: "N",
      displayName: `Explorador (${placemarks.length} placemark(s))`,
      startKm: 0,
      endKm: 0,
      defaultRadius: 500,
      exportMode: "normal",
      anchors,
    };

    return {
      version: DRAFT_VERSION,
      activeRouteId: route.id,
      meta: { exportStepM: 100 },
      routes: [route],
    };
  }

  /** @param {string} text */
  async copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fallback */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  /**
   * @param {string[]} ids
   */
  async exportIdsToHistoryClipboard(ids) {
    if (!ids.length) {
      return;
    }
    const placemarks = this.collectPlacemarksForHistoryExport(ids);
    const draft = this.buildHistoryDraftFromPlacemarks(placemarks);
    if (!draft) {
      this.showKmlToast(
        "Nenhum ponto geometrico nos itens selecionados (apenas pastas vazias ou sem geometria plotavel).",
        true,
      );
      return;
    }
    const text = JSON.stringify(draft, null, 2);
    const ok = await this.copyTextToClipboard(text);
    if (ok) {
      const n = draft.routes[0]?.anchors?.length ?? 0;
      this.showKmlToast(
        `Historico copiado (${n} pontos). No editor: Importar → cole o JSON → \"Importar como edicao\".`,
      );
    } else {
      this.showKmlToast("Nao foi possivel copiar para a area de transferencia.", true);
    }
  }

  showKmlToast(message, isError = false) {
    let el = this.elements.toastEl;
    if (!(el instanceof HTMLElement)) {
      el = document.createElement("div");
      el.id = "kmlExplorerToast";
      el.className = "kml-explorer-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
      this.elements.toastEl = el;
    }
    if (this._toastHideTimer != null) {
      window.clearTimeout(this._toastHideTimer);
      this._toastHideTimer = null;
    }
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle("kml-explorer-toast--error", isError);
    window.requestAnimationFrame(() => {
      el.classList.add("kml-explorer-toast--visible");
    });
    this._toastHideTimer = window.setTimeout(() => {
      el.classList.remove("kml-explorer-toast--visible");
      this._toastHideTimer = window.setTimeout(() => {
        el.hidden = true;
        this._toastHideTimer = null;
      }, 220);
    }, 4500);
  }

  clearKmlState() {
    this.closeStreetViewPanel();
    this.selectedIds.clear();
    this.selectionAnchorId = null;
    this.forestRoots = null;
    this.lastKmlXmlDoc = null;
    for (const ovs of this.overlaysById.values()) {
      for (const o of ovs) {
        o.setMap(null);
      }
    }
    this.overlaysById.clear();
    this.nodesById.clear();
    this.elements.treeRoot.replaceChildren();
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Importe um arquivo para ver a arvore de pastas e placemarks.";
    this.elements.treeRoot.appendChild(hint);
  }

  async onFileSelected(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    if (!this.mapReady) {
      this.setStatus("Carregue o mapa (API key) antes de importar.", true);
      return;
    }

    this.clearKmlState();
    if (this.elements.layerFilter) {
      this.elements.layerFilter.value = "";
    }
    this.geomFilterKinds.clear();
    document.querySelectorAll(".kml-geom-chip--on").forEach((c) => c.classList.remove("kml-geom-chip--on"));
    const dt = new DataTransfer();
    dt.items.add(file);
    this.elements.fileInput.files = dt.files;

    try {
      const kmlText = await fileToKmlString(file);
      this.setStatus("Analisando KML...");
      await Promise.resolve();
      let { roots, stats, xmlDoc } = parseKmlToForest(kmlText);
      enrichKmlForest(roots, xmlDoc);
      roots = pruneEmptyKmlNodes(roots);
      this.forestRoots = roots;
      this.lastKmlXmlDoc = xmlDoc;
      this.selectedIds.clear();
      this.selectionAnchorId = null;
      this.indexNodes(roots);
      this.setStatus("Montando arvore (pastas fechadas por padrao — expanda para ver os itens)...");
      await this.renderForest(roots);
      const after = countKmlForestStats(roots);
      const droppedPm = stats.placemarks - after.placemarks;
      const droppedHint = droppedPm > 0 ? ` ${droppedPm} placemark(s) vazio(s) omitido(s).` : "";
      this.setStatus(
        `Arquivo carregado: ${after.folders} pasta(s), ${after.placemarks} placemark(s)${
          after.unsupported ? `, ${after.unsupported} item(ns) nao plotados` : ""
        }.${droppedHint} Itens sem geometria (ponto/linha/poligono) nao aparecem na lista. Ative as camadas na arvore para ver no mapa.`,
      );
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  /** @param {import("./kml-xml-tree.js").KmlTreeNode[]} roots */
  indexNodes(roots) {
    const walk = (node) => {
      this.nodesById.set(node.id, node);
      if (node.children) {
        node.children.forEach(walk);
      }
    };
    roots.forEach(walk);
  }

  /**
   * Renderiza nos em fatias para não travar o mapa / UI em KMLs enormes.
   * @param {import("./kml-xml-tree.js").KmlTreeNode[]} nodes
   * @param {HTMLUListElement} ul
   * @param {string|null} [parentFolderId] dono da lista (`null` = raiz do arquivo)
   * @returns {Promise<void>}
   */
  appendNodesChunked(nodes, ul, parentFolderId = null) {
    const FRAME_MS = 14;
    let index = 0;
    return new Promise((resolve) => {
      const step = () => {
        const t0 = performance.now();
        while (index < nodes.length && performance.now() - t0 < FRAME_MS) {
          this.renderNode(nodes[index], ul, parentFolderId);
          index += 1;
        }
        if (index < nodes.length) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** @param {import("./kml-xml-tree.js").KmlTreeNode[]} roots */
  async renderForest(roots) {
    this.elements.treeRoot.replaceChildren();
    if (roots.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Nenhuma pasta ou placemark na raiz do arquivo.";
      this.elements.treeRoot.appendChild(p);
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "kml-tree-list kml-tree-root-list";
    this.elements.treeRoot.appendChild(ul);
    this.bindTreeListDrop(ul, null);

    await this.appendNodesChunked(roots, ul, null);
    this.applyTreeFilter();
    this.syncSelectionDom();
  }

  /** @param {import("./kml-xml-tree.js").KmlTreeNode} node */
  isPlacemarkOnMap(node) {
    const ovs = this.overlaysById.get(node.id);
    return !!ovs?.some((o) => o.getMap());
  }

  /**
   * @param {import("./kml-xml-tree.js").KmlTreeNode} node
   * @param {HTMLUListElement} ul
   * @param {string|null} [parentFolderId]
   */
  renderNode(node, ul, parentFolderId = null) {
    const li = document.createElement("li");
    li.className = "kml-tree-item";
    li.dataset.kmlSearch = node.name.toLowerCase();

    if (node.kind === "unsupported") {
      li.dataset.geomKinds = "unsupported";
      const span = document.createElement("span");
      span.className = "kml-tree-muted";
      span.textContent = `${node.name} (${node.hint || "nao suportado"})`;
      const tipU = kmlDescriptionPlainText(node.element);
      if (tipU) {
        li.title = tipU;
      }
      li.appendChild(span);
      ul.appendChild(li);
      return;
    }

    li.dataset.kmlParentFolder = parentFolderId ?? "";

    if (node.kind === "folder") {
      li.dataset.nodeId = node.id;
      this.bindTreeDragSource(li, node.id);

      const details = document.createElement("details");
      details.open = false;
      details.className = "kml-tree-folder";

      const summary = document.createElement("summary");
      summary.className = "kml-tree-summary";
      summary.addEventListener("click", (e) => {
        if (!e.target.closest(".kml-tree-chevron")) {
          e.preventDefault();
        }
      });
      const tipF = kmlDescriptionPlainText(node.element);

      const fk = node.folderGeomKinds || [];
      li.dataset.geomKinds = fk.join(",");

      const chevron = document.createElement("span");
      chevron.className = "kml-tree-chevron";
      chevron.draggable = false;
      chevron.innerHTML = "<i class=\"fas fa-chevron-right\" aria-hidden=\"true\"></i>";

      summary.appendChild(chevron);
      if (node.containerHint === "document") {
        const docIc = document.createElement("i");
        docIc.className = "fas fa-globe kml-tree-doc-icon";
        docIc.setAttribute("aria-hidden", "true");
        docIc.title = "Documento KML";
        summary.appendChild(docIc);
      }
      if (fk.length > 0) {
        this.appendFolderGeomBadges(summary, fk);
      }

      const label = document.createElement("span");
      label.className = "kml-tree-label";
      const childCount = node.children?.length ?? 0;
      label.textContent = childCount ? `${node.name} (${childCount})` : node.name;
      if (tipF) {
        label.title = tipF;
      }

      const visBtn = this.createVisToggleButton(node.id, "folder", false);
      if (node.containerHint === "document") {
        visBtn.setAttribute(
          "aria-label",
          "Mostrar ou ocultar geometrias deste documento no mapa",
        );
      }

      summary.append(label, visBtn);
      details.appendChild(summary);

      const nested = document.createElement("ul");
      nested.className = "kml-tree-nested";
      this.bindTreeListDrop(nested, node.id);

      chevron.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !details.open;
        details.open = willOpen;
        if (willOpen && nested.dataset.kmlRendered !== "1") {
          nested.dataset.kmlRendered = "1";
          void this.appendNodesChunked(node.children || [], nested, node.id).then(() => this.applyTreeFilter());
        }
      });

      this.bindFolderSummaryDrop(summary, node.id);

      details.appendChild(nested);
      li.appendChild(details);
      ul.appendChild(li);
      return;
    }

    li.dataset.nodeId = node.id;
    this.bindTreeDragSource(li, node.id);

    const gk = node.geomKinds || [];
    li.dataset.geomKinds = gk.join(",");

    const row = document.createElement("div");
    row.className = "kml-tree-leaf-row";
    const tipP = kmlDescriptionPlainText(node.element);
    if (tipP) {
      row.title = tipP;
    }

    const leafIcon = document.createElement("i");
    leafIcon.className = `fas ${this.primaryLeafIconClass(gk)} kml-tree-leaf-icon`;
    leafIcon.setAttribute("aria-hidden", "true");

    const nameEl = document.createElement("span");
    nameEl.className = "kml-tree-leaf-name";
    nameEl.textContent = node.name;

    const mapOn = this.isPlacemarkOnMap(node);
    const visBtn = this.createVisToggleButton(node.id, "placemark", mapOn);

    row.append(leafIcon, nameEl, visBtn);
    li.appendChild(row);
    ul.appendChild(li);
  }

  /**
   * @param {import("./kml-xml-tree.js").KmlTreeNode} folderNode
   * @param {boolean} visible
   */
  applyFolderVisibility(folderNode, visible) {
    const placemarks = collectPlacemarkNodes(folderNode);
    const subFolders = collectDescendantFolders(folderNode);

    for (const f of subFolders) {
      this.syncVisToggleInDom(f.id, "folder", visible);
    }

    for (const pm of placemarks) {
      this.syncVisToggleInDom(pm.id, "placemark", visible);
      if (visible) {
        this.showPlacemark(pm);
      } else {
        this.hidePlacemark(pm);
      }
    }
  }

  /** @param {import("./kml-xml-tree.js").KmlTreeNode} node */
  showPlacemark(node) {
    if (node.kind !== "placemark" || !node.element) {
      return;
    }

    let ovs = this.overlaysById.get(node.id);
    if (!ovs) {
      ovs = this.buildOverlays(node);
      this.overlaysById.set(node.id, ovs);
    }
    for (const o of ovs) {
      o.setMap(this.map);
    }
  }

  /** @param {import("./kml-xml-tree.js").KmlTreeNode} node */
  hidePlacemark(node) {
    const ovs = this.overlaysById.get(node.id);
    if (!ovs) {
      return;
    }
    for (const o of ovs) {
      o.setMap(null);
    }
  }

  /** @param {import("./kml-xml-tree.js").KmlTreeNode} node */
  buildOverlays(node) {
    const { geometries, error } = extractPlacemarkGeometries(node.element);
    if (error) {
      return [];
    }

    const st = node.styleColors;
    const strokeColor = st?.stroke || "#38bdf8";
    const strokeOpacity = st?.strokeOpacity ?? 0.9;
    const strokeWeight = 2;
    const fillColor = st?.fill || st?.stroke || "#38bdf8";
    const fillOpacity = st?.fillOpacity ?? 0.15;
    const markerFill = st?.icon || st?.stroke || "#38bdf8";
    const markerFillOpacity = st?.iconOpacity ?? 1;

    const list = [];

    for (const g of geometries) {
      if (g.type === "Point" && g.path?.[0]) {
        const marker = new this.google.maps.Marker({
          position: g.path[0],
          map: null,
          title: node.name,
          icon: {
            path: this.google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: markerFill,
            fillOpacity: markerFillOpacity > 0 ? markerFillOpacity : 1,
            strokeColor: "#020617",
            strokeWeight: 1.5,
          },
        });
        marker.addListener("click", () => {
          const p = marker.getPosition();
          if (p) {
            this.applyStreetViewNear({ lat: p.lat(), lng: p.lng() });
          }
        });
        list.push(marker);
      } else if (g.type === "LineString" && g.path?.length) {
        list.push(
          new this.google.maps.Polyline({
            path: g.path,
            map: null,
            geodesic: true,
            strokeColor,
            strokeOpacity,
            strokeWeight,
          }),
        );
      } else if (g.type === "LinearRing" && g.path?.length) {
        list.push(
          new this.google.maps.Polyline({
            path: g.path,
            map: null,
            geodesic: true,
            strokeColor,
            strokeOpacity,
            strokeWeight: 1,
          }),
        );
      } else if (g.type === "Polygon" && g.paths?.length) {
        list.push(
          new this.google.maps.Polygon({
            paths: g.paths,
            map: null,
            strokeColor,
            strokeOpacity,
            strokeWeight,
            fillColor,
            fillOpacity,
          }),
        );
      }
    }

    return list;
  }

  /** @param {google.maps.LatLngBounds} bounds */
  extendBoundsWithOverlay(bounds, overlay) {
    const { Marker, Polyline, Polygon } = this.google.maps;
    if (overlay instanceof Marker) {
      const p = overlay.getPosition();
      if (p) {
        bounds.extend(p);
        return true;
      }
      return false;
    }
    if (overlay instanceof Polyline) {
      let any = false;
      overlay.getPath().forEach((latLng) => {
        bounds.extend(latLng);
        any = true;
      });
      return any;
    }
    if (overlay instanceof Polygon) {
      let any = false;
      overlay.getPaths().forEach((path) => {
        path.forEach((latLng) => {
          bounds.extend(latLng);
          any = true;
        });
      });
      return any;
    }
    return false;
  }

  fitVisibleBounds() {
    if (!this.mapReady || !this.google) {
      return;
    }
    const bounds = new this.google.maps.LatLngBounds();
    let any = false;
    for (const ovs of this.overlaysById.values()) {
      for (const o of ovs) {
        if (!o.getMap()) {
          continue;
        }
        if (this.extendBoundsWithOverlay(bounds, o)) {
          any = true;
        }
      }
    }
    if (any) {
      this.map.fitBounds(bounds, 48);
      this.setStatus("Mapa ajustado ao que esta visivel.");
    } else {
      this.setStatus("Nenhuma geometria visivel. Ative camadas na arvore.", true);
    }
  }

  clearTreeDropHighlights() {
    this.elements.treeRoot.querySelectorAll(".kml-tree-summary--drop-target").forEach((el) => {
      el.classList.remove("kml-tree-summary--drop-target");
    });
    this.elements.treeRoot.querySelectorAll(".kml-tree-list--drop-target").forEach((el) => {
      el.classList.remove("kml-tree-list--drop-target");
    });
  }

  /**
   * Lista (`ul`): soltar entre itens para reordenar ou mover para esse nível.
   * @param {HTMLUListElement} ul
   * @param {string|null} parentFolderId `null` = raiz do arquivo
   */
  bindTreeListDrop(ul, parentFolderId) {
    ul.dataset.kmlDropParent = parentFolderId != null ? String(parentFolderId) : "";
    ul.addEventListener("dragover", (e) => {
      const hitLi = e.target.closest("li.kml-tree-item");
      const directChild = !!(hitLi && hitLi.parentElement === ul);
      if (directChild && e.target.closest("summary.kml-tree-summary")) {
        return;
      }
      if (!directChild && e.target !== ul) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      ul.classList.add("kml-tree-list--drop-target");
    });
    ul.addEventListener("dragleave", (e) => {
      if (!ul.contains(/** @type {Node|null} */ (e.relatedTarget))) {
        ul.classList.remove("kml-tree-list--drop-target");
      }
    });
    ul.addEventListener("drop", (e) => {
      const hitLi = e.target.closest("li.kml-tree-item");
      const directChild = !!(hitLi && hitLi.parentElement === ul);
      if (directChild && e.target.closest("summary.kml-tree-summary")) {
        return;
      }
      if (!directChild && e.target !== ul) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      ul.classList.remove("kml-tree-list--drop-target");
      const ids = parseDragIds(e.dataTransfer);
      if (!ids.length) {
        return;
      }
      const insertBeforeId = this.computeListDropInsertBefore(ul, e.clientY, ids);
      const folderFromUl = normalizeDropFolderId(ul.dataset.kmlDropParent);
      void this.applyTreeMove(ids, folderFromUl, insertBeforeId);
    });
  }

  /**
   * @param {HTMLUListElement} ul
   * @param {number} clientY
   * @param {string[]} draggedIds
   * @returns {string|null} id do primeiro irmão antes do qual inserir; `null` = fim da lista
   */
  computeListDropInsertBefore(ul, clientY, draggedIds) {
    const dragSet = new Set(draggedIds);
    const items = [...ul.children].filter(
      (c) =>
        c instanceof HTMLLIElement &&
        c.classList.contains("kml-tree-item") &&
        !c.hidden &&
        typeof c.dataset.nodeId === "string" &&
        c.dataset.nodeId.length > 0,
    );
    for (let i = 0; i < items.length; i += 1) {
      const r = items[i].getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (clientY < mid) {
        let j = i;
        while (j < items.length) {
          const id = items[j].dataset.nodeId;
          if (id && !dragSet.has(id)) {
            return id;
          }
          j += 1;
        }
        return null;
      }
    }
    return null;
  }

  /**
   * @param {HTMLLIElement} li
   * @param {string} nodeId
   */
  bindTreeDragSource(li, nodeId) {
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      if (!this.forestRoots) {
        return;
      }
      const nid = String(nodeId ?? "").trim();
      if (!nid) {
        e.preventDefault();
        return;
      }
      let ids = [...this.selectedIds];
      if (!this.selectedIds.has(nid)) {
        this.selectSingle(nid);
        this.selectionAnchorId = nid;
        ids = [nid];
      }
      ids = this.topmostMovableSelection(ids);
      const payload = JSON.stringify(ids);
      try {
        e.dataTransfer.setData("text/plain", payload);
      } catch {
        /* alguns ambientes restringem tipos */
      }
      e.dataTransfer.setData(KML_TREE_DND_MIME, payload);
      e.dataTransfer.effectAllowed = "move";
      /* Mantém o destaque da multi-seleção: o navegador pode alterar o visual do nó em drag. */
      this.syncSelectionDom();
      window.requestAnimationFrame(() => this.syncSelectionDom());
    });
  }

  /**
   * @param {HTMLElement} summary
   * @param {string} folderNodeId
   */
  bindFolderSummaryDrop(summary, folderNodeId) {
    summary.dataset.kmlDropFolderId = folderNodeId;
    summary.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      summary.classList.add("kml-tree-summary--drop-target");
    });
    summary.addEventListener("dragleave", (e) => {
      if (!summary.contains(/** @type {Node|null} */ (e.relatedTarget))) {
        summary.classList.remove("kml-tree-summary--drop-target");
      }
    });
    summary.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      summary.classList.remove("kml-tree-summary--drop-target");
      const ids = parseDragIds(e.dataTransfer);
      if (!ids.length) {
        return;
      }
      const fid = normalizeDropFolderId(summary.dataset.kmlDropFolderId);
      void this.applyTreeMove(ids, fid, null);
    });
  }

  selectSingle(nodeId) {
    this.selectedIds.clear();
    this.selectedIds.add(nodeId);
  }

  toggleSelection(nodeId) {
    if (this.selectedIds.has(nodeId)) {
      this.selectedIds.delete(nodeId);
    } else {
      this.selectedIds.add(nodeId);
    }
  }

  extendSelectionTo(nodeId) {
    const items = this.getVisibleSelectableLis();
    const anchor = this.selectionAnchorId;
    if (!anchor || items.length === 0) {
      this.selectSingle(nodeId);
      return;
    }
    const i0 = items.findIndex((li) => li.dataset.nodeId === anchor);
    const i1 = items.findIndex((li) => li.dataset.nodeId === nodeId);
    if (i0 < 0 || i1 < 0) {
      this.selectSingle(nodeId);
      return;
    }
    const a = Math.min(i0, i1);
    const b = Math.max(i0, i1);
    this.selectedIds.clear();
    for (let i = a; i <= b; i += 1) {
      const id = items[i].dataset.nodeId;
      if (id) {
        this.selectedIds.add(id);
      }
    }
  }

  syncSelectionDom() {
    this.elements.treeRoot.querySelectorAll("li.kml-tree-item--selected").forEach((li) => {
      li.classList.remove("kml-tree-item--selected");
    });
    for (const id of this.selectedIds) {
      const li = this.elements.treeRoot.querySelector(`li.kml-tree-item[data-node-id="${id}"]`);
      if (li) {
        li.classList.add("kml-tree-item--selected");
      }
    }
  }

  /** @returns {HTMLLIElement[]} */
  getVisibleSelectableLis() {
    const ul = this.elements.treeRoot.querySelector(":scope > ul.kml-tree-root-list");
    if (!(ul instanceof HTMLUListElement)) {
      return [];
    }
    /** @param {HTMLUListElement} listUl */
    const walk = (listUl) => {
      /** @type {HTMLLIElement[]} */
      const out = [];
      for (const child of listUl.children) {
        if (!(child instanceof HTMLLIElement) || !child.classList.contains("kml-tree-item")) {
          continue;
        }
        if (child.hidden || !child.dataset.nodeId) {
          continue;
        }
        out.push(child);
        const nested = child.querySelector(":scope > details.kml-tree-folder > ul.kml-tree-nested");
        if (nested instanceof HTMLUListElement && nested.children.length > 0) {
          out.push(...walk(nested));
        }
      }
      return out;
    };
    return walk(ul);
  }

  /**
   * @param {string[]} ids
   */
  topmostMovableSelection(ids) {
    const set = new Set(ids);
    /** @type {string[]} */
    const out = [];
    for (const id of ids) {
      let under = false;
      let p = this.findParentNode(id);
      while (p) {
        if (set.has(p.id)) {
          under = true;
          break;
        }
        p = this.findParentNode(p.id);
      }
      if (!under) {
        out.push(id);
      }
    }
    return out;
  }

  /**
   * @param {string[]} ids
   */
  sortIdsByVisibleOrder(ids) {
    const vis = this.getVisibleSelectableLis().map((li) => li.dataset.nodeId);
    const idx = new Map(vis.map((id, i) => [id, i]));
    return [...ids].sort((a, b) => (idx.get(a) ?? 1e9) - (idx.get(b) ?? 1e9));
  }

  /**
   * @param {string} childId
   * @param {import("./kml-xml-tree.js").KmlTreeNode[]|null} [roots]
   * @returns {import("./kml-xml-tree.js").KmlTreeNode|null}
   */
  findParentNode(childId, roots = this.forestRoots) {
    if (!roots) {
      return null;
    }
    for (const node of roots) {
      if (node.children?.some((c) => c.id === childId)) {
        return node;
      }
      if (node.children?.length) {
        const deeper = this.findParentNode(childId, node.children);
        if (deeper) {
          return deeper;
        }
      }
    }
    return null;
  }

  /**
   * Verdadeiro se `nodeId` está em algum nível sob `ancestorFolderId`.
   * @param {string} nodeId
   * @param {string} ancestorFolderId
   */
  isUnderFolder(nodeId, ancestorFolderId) {
    let p = this.findParentNode(nodeId);
    while (p) {
      if (p.id === ancestorFolderId) {
        return true;
      }
      p = this.findParentNode(p.id);
    }
    return false;
  }

  /**
   * @param {string[]} sourceTopIds
   * @param {string|null} targetFolderId null = raiz
   * @param {string|null} insertBeforeId irmão antes do qual inserir nesta lista; `null` = inserir no fim (ex.: soltar no nome da pasta)
   */
  validateTreeDrop(sourceTopIds, targetFolderId, insertBeforeId = null) {
    if (!sourceTopIds.length) {
      return false;
    }
    const normTarget = normalizeDropFolderId(targetFolderId);
    const target = normTarget ? this.nodesById.get(normTarget) : null;
    if (normTarget && (!target || target.kind !== "folder")) {
      return false;
    }
    const dragSet = new Set(sourceTopIds);
    if (insertBeforeId != null && String(insertBeforeId).trim() !== "") {
      const insId = String(insertBeforeId).trim();
      if (dragSet.has(insId)) {
        return false;
      }
      const beforeNode = this.nodesById.get(insId);
      if (!beforeNode) {
        return false;
      }
      const esc =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(insId)
          : insId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const beforeLi = this.elements.treeRoot.querySelector(`li.kml-tree-item[data-node-id="${esc}"]`);
      const domParent = beforeLi?.dataset?.kmlParentFolder ?? "";
      const expectedParent = normTarget ?? "";
      const domOk = beforeLi != null && domParent === expectedParent;
      const modelParent = this.findParentNode(insId)?.id ?? null;
      const modelOk =
        (normTarget == null && modelParent == null) || (normTarget != null && modelParent === normTarget);
      if (!domOk && !modelOk) {
        return false;
      }
    }
    for (const sid of sourceTopIds) {
      if (normTarget != null && sid === normTarget) {
        return false;
      }
      const src = this.nodesById.get(sid);
      if (!src || (src.kind !== "folder" && src.kind !== "placemark")) {
        return false;
      }
      if (src.kind === "folder" && normTarget && this.isUnderFolder(normTarget, sid)) {
        return false;
      }
    }
    return true;
  }

  /** @returns {Set<string>} */
  captureExpandedFolderIds() {
    const ids = new Set();
    this.elements.treeRoot.querySelectorAll("details.kml-tree-folder[open]").forEach((d) => {
      const li = d.closest("li.kml-tree-item");
      const nid = li?.dataset?.nodeId;
      if (nid) {
        ids.add(nid);
      }
    });
    return ids;
  }

  /**
   * @param {Set<string>} expandedIds
   */
  async restoreExpandedFolders(expandedIds) {
    if (!expandedIds?.size) {
      return;
    }
    for (const id of expandedIds) {
      const li = this.elements.treeRoot.querySelector(`li.kml-tree-item[data-node-id="${id}"]`);
      const details = li?.querySelector(":scope > details.kml-tree-folder");
      const nested = details?.querySelector(":scope > ul.kml-tree-nested");
      const n = this.nodesById.get(id);
      if (!(details instanceof HTMLDetailsElement) || !(nested instanceof HTMLUListElement) || !n?.children?.length) {
        continue;
      }
      details.open = true;
      if (nested.dataset.kmlRendered !== "1") {
        nested.dataset.kmlRendered = "1";
        await this.appendNodesChunked(n.children, nested, n.id);
      }
    }
    this.applyTreeFilter();
  }

  /**
   * @param {string[]} sourceIds
   * @param {string|null} targetFolderId
   * @param {string|null} [insertBeforeId]
   */
  async applyTreeMove(sourceIds, targetFolderId, insertBeforeId = null) {
    if (!this.forestRoots || !this.lastKmlXmlDoc) {
      return;
    }
    if (this._treeMoveActive) {
      return;
    }
    this._treeMoveActive = true;
    try {
      let ids = this.topmostMovableSelection(sourceIds.map((x) => String(x).trim()).filter(Boolean));
      ids = this.sortIdsByVisibleOrder(ids);
      const folderTarget = normalizeDropFolderId(targetFolderId);
      const ins =
        insertBeforeId != null && String(insertBeforeId).trim() !== "" ? String(insertBeforeId).trim() : null;
      if (!this.validateTreeDrop(ids, folderTarget, ins)) {
        this.setStatus("Nao e possivel soltar nesta pasta.", true);
        return;
      }
      const nodes = ids.map((id) => this.nodesById.get(id)).filter(Boolean);
      if (nodes.length !== ids.length) {
        this.setStatus("Nao e possivel soltar nesta pasta.", true);
        return;
      }
      for (const node of nodes) {
        const parent = this.findParentNode(node.id);
        const arr = parent?.children ?? this.forestRoots;
        const ix = arr.indexOf(node);
        if (ix >= 0) {
          arr.splice(ix, 1);
        }
      }
      const target = folderTarget ? this.nodesById.get(folderTarget) : null;
      /** @type {import("./kml-xml-tree.js").KmlTreeNode[]} */
      let destArr;
      if (target) {
        if (!target.children) {
          target.children = [];
        }
        destArr = target.children;
      } else {
        destArr = this.forestRoots;
      }
      let insertIndex = destArr.length;
      if (ins) {
        const beforeNode = this.nodesById.get(ins);
        const ix = beforeNode ? destArr.indexOf(beforeNode) : -1;
        if (ix >= 0) {
          insertIndex = ix;
        }
      }
      destArr.splice(insertIndex, 0, ...nodes);
      enrichKmlForest(this.forestRoots, this.lastKmlXmlDoc);
      this.indexNodes(this.forestRoots);
      const expanded = this.captureExpandedFolderIds();
      await this.renderForest(this.forestRoots);
      await this.restoreExpandedFolders(expanded);
      this.applyTreeFilter();
      this.syncSelectionDom();
      this.setStatus(nodes.length > 1 ? `${nodes.length} itens movidos.` : "Item movido.");
    } finally {
      this._treeMoveActive = false;
    }
  }
}
