import { STORAGE_KEYS } from "./constants.js";
import { loadGoogleMapsApi } from "./google-maps-script.js";
import { fileToKmlString } from "./kml-read.js";
import {
  parseKmlToForest,
  collectPlacemarkNodes,
  extractPlacemarkGeometries,
} from "./kml-xml-tree.js";

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

    this.elements = {
      mapEl: document.getElementById("kmlExplorerMap"),
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
    };

    /** @type {ReturnType<typeof setTimeout> | null} */
    this._filterDebounce = null;

    this.attachUiEvents();
    this.restoreKeyHint();
    void this.bootstrapMapsFlow();
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
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
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
    });

    if (this.elements.layerFilter) {
      this.elements.layerFilter.addEventListener("input", () => {
        if (this._filterDebounce != null) {
          window.clearTimeout(this._filterDebounce);
        }
        this._filterDebounce = window.setTimeout(() => {
          this._filterDebounce = null;
          this.applyTreeFilter();
        }, 120);
      });
    }
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
    btn.addEventListener("click", (e) => e.stopPropagation());
    return btn;
  }

  applyTreeFilter() {
    const q = (this.elements.layerFilter?.value || "").trim().toLowerCase();
    const root = this.elements.treeRoot;
    const ul = root.querySelector(":scope > ul.kml-tree-root-list");
    if (!ul) {
      return;
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
    const selfMatch = !q || name.includes(q);

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
    this.mapReady = true;
  }

  setStatus(message, isError = false) {
    this.elements.statusEl.textContent = message;
    this.elements.statusEl.classList.toggle("error-text", isError);
  }

  clearKmlState() {
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
    const dt = new DataTransfer();
    dt.items.add(file);
    this.elements.fileInput.files = dt.files;

    try {
      const kmlText = await fileToKmlString(file);
      this.setStatus("Analisando KML...");
      await Promise.resolve();
      const { roots, stats } = parseKmlToForest(kmlText);
      this.indexNodes(roots);
      this.setStatus("Montando arvore (pastas fechadas por padrao — expanda para ver os itens)...");
      await this.renderForest(roots);
      this.setStatus(
        `Arquivo carregado: ${stats.folders} pasta(s), ${stats.placemarks} placemark(s)${
          stats.unsupported ? `, ${stats.unsupported} item(ns) nao plotados` : ""
        }. Ative as camadas na arvore para ver no mapa.`,
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
   * @returns {Promise<void>}
   */
  appendNodesChunked(nodes, ul) {
    const FRAME_MS = 14;
    let index = 0;
    return new Promise((resolve) => {
      const step = () => {
        const t0 = performance.now();
        while (index < nodes.length && performance.now() - t0 < FRAME_MS) {
          this.renderNode(nodes[index], ul);
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
    await this.appendNodesChunked(roots, ul);
    this.applyTreeFilter();
  }

  /** @param {import("./kml-xml-tree.js").KmlTreeNode} node */
  isPlacemarkOnMap(node) {
    const ovs = this.overlaysById.get(node.id);
    return !!ovs?.some((o) => o.getMap());
  }

  /**
   * @param {import("./kml-xml-tree.js").KmlTreeNode} node
   * @param {HTMLUListElement} ul
   */
  renderNode(node, ul) {
    const li = document.createElement("li");
    li.className = "kml-tree-item";
    li.dataset.kmlSearch = node.name.toLowerCase();

    if (node.kind === "unsupported") {
      const span = document.createElement("span");
      span.className = "kml-tree-muted";
      span.textContent = `${node.name} (${node.hint || "nao suportado"})`;
      li.appendChild(span);
      ul.appendChild(li);
      return;
    }

    if (node.kind === "folder") {
      const details = document.createElement("details");
      details.open = false;
      details.className = "kml-tree-folder";

      const summary = document.createElement("summary");
      summary.className = "kml-tree-summary";

      const chevron = document.createElement("span");
      chevron.className = "kml-tree-chevron";
      chevron.innerHTML = "<i class=\"fas fa-chevron-right\" aria-hidden=\"true\"></i>";

      const label = document.createElement("span");
      label.className = "kml-tree-label";
      const childCount = node.children?.length ?? 0;
      label.textContent = childCount ? `${node.name} (${childCount})` : node.name;

      const visBtn = this.createVisToggleButton(node.id, "folder", false);

      summary.append(chevron, label, visBtn);
      details.appendChild(summary);

      const nested = document.createElement("ul");
      nested.className = "kml-tree-nested";

      details.addEventListener("toggle", () => {
        if (!details.open || nested.dataset.kmlRendered === "1") {
          return;
        }
        nested.dataset.kmlRendered = "1";
        void this.appendNodesChunked(node.children || [], nested).then(() => this.applyTreeFilter());
      });

      details.appendChild(nested);
      li.appendChild(details);
      ul.appendChild(li);
      return;
    }

    const row = document.createElement("div");
    row.className = "kml-tree-leaf-row";

    const leafIcon = document.createElement("i");
    leafIcon.className = "fas fa-draw-polygon kml-tree-leaf-icon";
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

    const list = [];
    const strokeColor = "#38bdf8";
    const strokeOpacity = 0.9;
    const strokeWeight = 2;
    const fillColor = "#38bdf8";
    const fillOpacity = 0.15;

    for (const g of geometries) {
      if (g.type === "Point" && g.path?.[0]) {
        list.push(
          new this.google.maps.Marker({
            position: g.path[0],
            map: null,
            title: node.name,
          }),
        );
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
}
