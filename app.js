const STORAGE_KEYS = {
  apiKey: "streetPolylineMaker.apiKey",
  draft: "streetPolylineMaker.draft",
};

const DRAFT_VERSION = 2;

function generateRouteId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `route_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

class StreetPolylineMakerApp {
  constructor() {
    this.google = null;
    this.map = null;
    this.mapReady = false;
    this.anchorPoints = [];
    this.anchorMarkers = [];
    this.anchorCircles = [];
    this.importedMarkers = [];
    this.importedCircles = [];
    this.previewExportMarkers = [];
    this.previewExportCircles = [];
    this.previewLine = null;
    this.previewRadius = null;
    this.historyInfoWindow = null;
    this.lastCoordinate = null;
    this.currentKm = 0;
    this.importedVisible = true;
    this.exportPreviewVisible = false;
    this.radiusPresets = [50, 100, 150, 250, 500];
    this.rotationDrag = { active: false, lastX: 0, wasGestureHandling: "auto" };
    this.sidebarResize = { active: false, startX: 0, startWidth: 320 };
    this.mapsApiModalLocked = false;
    this.streetViewService = null;
    this.streetViewPanorama = null;
    this.streetViewVisible = false;
    this.streetViewFocusedIndex = null;
    this.streetViewFocusedPreviewIndex = null;
    this.previewExportPoints = [];
    this.streetViewResize = { active: false, startY: 0, startHeight: 0 };
    this.anchorsOnMapVisible = true;
    this.routes = [];
    this.activeRouteId = null;

    this.elements = {
      appShell: document.getElementById("appShell"),
      sidebar: document.getElementById("sidebar"),
      sidebarResizeHandle: document.getElementById("sidebarResizeHandle"),
      toggleSidebar: document.getElementById("toggleSidebar"),
      mapsApiModal: document.getElementById("mapsApiModal"),
      openMapsApiModal: document.getElementById("openMapsApiModal"),
      closeMapsApiModal: document.getElementById("closeMapsApiModal"),
      apiKey: document.getElementById("apiKey"),
      saveApiKey: document.getElementById("saveApiKey"),
      loadMap: document.getElementById("loadMap"),
      mapStatus: document.getElementById("mapStatus"),
      roadName: document.getElementById("roadName"),
      direction: document.getElementById("direction"),
      startKm: document.getElementById("startKm"),
      displayName: document.getElementById("displayName"),
      defaultRadius: document.getElementById("defaultRadius"),
      exportStepM: document.getElementById("exportStepM"),
      autoHideAnchors: document.getElementById("autoHideAnchors"),
      exportData: document.getElementById("exportData"),
      toggleExportPreview: document.getElementById("toggleExportPreview"),
      openImportModal: document.getElementById("openImportModal"),
      loadHistory: document.getElementById("loadHistory"),
      toggleImported: document.getElementById("toggleImported"),
      toggleAnchors: document.getElementById("toggleAnchors"),
      clearAll: document.getElementById("clearAll"),
      exportModal: document.getElementById("exportModal"),
      closeExportModal: document.getElementById("closeExportModal"),
      importModal: document.getElementById("importModal"),
      closeImportModal: document.getElementById("closeImportModal"),
      importFile: document.getElementById("importFile"),
      importText: document.getElementById("importText"),
      importJson: document.getElementById("importJson"),
      useJsonAsHistory: document.getElementById("useJsonAsHistory"),
      summaryText: document.getElementById("summaryText"),
      cursorDistance: document.getElementById("cursorDistance"),
      nextKm: document.getElementById("nextKm"),
      sqlOutput: document.getElementById("sqlOutput"),
      jsonOutput: document.getElementById("jsonOutput"),
      copySql: document.getElementById("copySql"),
      copyJson: document.getElementById("copyJson"),
      map: document.getElementById("map"),
      mapStage: document.getElementById("mapStage"),
      mapTypeSelect: document.getElementById("mapTypeSelect"),
      toggleStreetView: document.getElementById("toggleStreetView"),
      closeStreetView: document.getElementById("closeStreetView"),
      streetViewPanel: document.getElementById("streetViewPanel"),
      streetViewPano: document.getElementById("streetViewPano"),
      streetViewResizeHandle: document.getElementById("streetViewResizeHandle"),
      routesModal: document.getElementById("routesModal"),
      openRoutesModal: document.getElementById("openRoutesModal"),
      closeRoutesModal: document.getElementById("closeRoutesModal"),
      routesTableBody: document.getElementById("routesTableBody"),
      addRouteBtn: document.getElementById("addRouteBtn"),
    };

    this.hydrateRoutesFromLocalStorage();
    this.attachUiEvents();
    this.restorePreferences();
    this.updateSummary();
    this.updateExportPreviewToggleUi();
    this.updateImportedToggleUi();
    this.updateAnchorsToggleUi();
    void this.bootstrapMapsFlow();
  }

  attachUiEvents() {
    this.elements.toggleSidebar.addEventListener("click", () => this.toggleSidebar());
    this.elements.sidebarResizeHandle.addEventListener("mousedown", (event) => this.startSidebarResize(event));
    this.elements.openMapsApiModal.addEventListener("click", () => this.openMapsApiSettings());
    this.elements.closeMapsApiModal.addEventListener("click", () => this.elements.mapsApiModal.close());
    this.elements.mapsApiModal.addEventListener("cancel", (event) => {
      if (this.mapsApiModalLocked) {
        event.preventDefault();
      }
    });
    this.elements.saveApiKey.addEventListener("click", () => this.saveApiKey());
    this.elements.loadMap.addEventListener("click", () => void this.loadMap());
    this.elements.exportData.addEventListener("click", () => this.exportAll());
    this.elements.toggleExportPreview.addEventListener("click", () => this.toggleExportPreview());
    this.elements.openImportModal.addEventListener("click", () => this.openModal(this.elements.importModal));
    this.elements.closeImportModal.addEventListener("click", () => this.elements.importModal.close());
    this.elements.closeExportModal.addEventListener("click", () => this.elements.exportModal.close());
    this.elements.loadHistory.addEventListener("click", () => this.loadDraftFromStorage());
    this.elements.toggleImported.addEventListener("click", () => this.toggleImportedVisibility());
    this.elements.toggleAnchors.addEventListener("click", () => this.toggleAnchorsOnMap());
    this.elements.clearAll.addEventListener("click", () => this.clearAll());
    this.elements.autoHideAnchors.addEventListener("change", () => this.updateAnchorVisibility());
    this.elements.importJson.addEventListener("click", () => this.importFromInputs(false));
    this.elements.useJsonAsHistory.addEventListener("click", () => this.importFromInputs(true));
    this.elements.importFile.addEventListener("change", (event) => this.loadImportFile(event));
    this.elements.defaultRadius.addEventListener("change", () => this.syncPreviewRadius());
    this.elements.exportStepM.addEventListener("change", () => this.refreshExportPreview());
    this.elements.copySql.addEventListener("click", () => this.copyOutput(this.elements.sqlOutput));
    this.elements.copyJson.addEventListener("click", () => this.copyOutput(this.elements.jsonOutput));
    this.elements.mapTypeSelect.addEventListener("change", () => this.applyMapTypeFromSelect());
    this.elements.toggleStreetView.addEventListener("click", () => this.toggleStreetViewPanel());
    this.elements.closeStreetView.addEventListener("click", () => this.closeStreetViewPanel());
    this.elements.streetViewResizeHandle.addEventListener("mousedown", (event) => this.startStreetViewResize(event));

    document.addEventListener("keydown", (event) => this.handleKeydown(event));
    document.addEventListener("mousemove", (event) => {
      this.handleSidebarResize(event);
      this.handleStreetViewResize(event);
    });
    document.addEventListener("mouseup", () => {
      this.stopSidebarResize();
      this.stopStreetViewResize();
    });

    [this.elements.importModal, this.elements.exportModal].forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.close();
        }
      });
    });

    this.elements.mapsApiModal.addEventListener("click", (event) => {
      if (event.target === this.elements.mapsApiModal && !this.mapsApiModalLocked) {
        this.elements.mapsApiModal.close();
      }
    });

    this.elements.openRoutesModal.addEventListener("click", () => this.openRoutesManager());
    this.elements.closeRoutesModal.addEventListener("click", () => this.elements.routesModal.close());
    this.elements.addRouteBtn.addEventListener("click", () => this.addNewRoute());

    this.elements.routesModal.addEventListener("click", (event) => {
      if (event.target === this.elements.routesModal) {
        this.elements.routesModal.close();
      }
    });
  }

  cloneAnchors(anchors) {
    return (anchors || []).map((p) => ({ ...p }));
  }

  createEmptyRoute() {
    return {
      id: generateRouteId(),
      roadName: "",
      direction: "N",
      displayName: "",
      startKm: 0,
      defaultRadius: 500,
      exportMode: "normal",
      anchors: [],
    };
  }

  normalizeRoute(raw) {
    return {
      id: raw.id || generateRouteId(),
      roadName: raw.roadName ?? raw.rodovia ?? "",
      direction: raw.direction ?? raw.sentido ?? "N",
      displayName: raw.displayName ?? raw.nome ?? "",
      startKm: this.parseNumber(raw.startKm, 0),
      defaultRadius: this.parseNumber(raw.defaultRadius, 500),
      exportMode: raw.exportMode || "normal",
      anchors: this.cloneAnchors(raw.anchors || []),
    };
  }

  getActiveRoute() {
    return this.routes.find((r) => r.id === this.activeRouteId) || null;
  }

  getRouteById(id) {
    return this.routes.find((r) => r.id === id) || null;
  }

  getActiveStartKm() {
    const route = this.getActiveRoute();
    return route ? this.parseNumber(route.startKm, 0) : 0;
  }

  syncConfigBarFromRoute(route) {
    if (!route) {
      return;
    }
    this.elements.roadName.value = route.roadName || "";
    this.elements.direction.value = route.direction === "" ? "" : (route.direction || "N");
    this.elements.displayName.value = route.displayName || "";
    this.elements.startKm.value = Number(route.startKm ?? 0).toFixed(3);
  }

  syncConfigBarFromActiveRoute() {
    this.syncConfigBarFromRoute(this.getActiveRoute());
  }

  syncActiveAnchorsWithRouteMetadata(route) {
    if (!route || route.id !== this.activeRouteId) {
      return;
    }
    this.anchorPoints.forEach((p) => {
      p.rodovia = route.roadName || "";
      p.sentido = route.direction ?? "";
      p.nome = route.displayName || "";
    });
    this.refreshAnchorMarkerMeta();
    this.syncConfigBarFromActiveRoute();
  }

  recomputeAnchorKmsAlongPolyline(anchors, startKm) {
    if (!anchors?.length) {
      return;
    }
    const base = this.parseNumber(startKm, 0);
    anchors[0].km = this.roundKm(base).toFixed(3);
    for (let i = 1; i < anchors.length; i += 1) {
      const prev = anchors[i - 1];
      const curr = anchors[i];
      const deltaKm = this.distanceMeters(prev, curr) / 1000;
      const nextKm = this.roundKm(this.parseNumber(prev.km, 0) + deltaKm);
      curr.km = nextKm.toFixed(3);
    }
  }

  applyStartKmToRoute(route, rawKm) {
    if (!route) {
      return;
    }
    route.startKm = this.parseNumber(rawKm, route.startKm);
    const targets = route.id === this.activeRouteId ? this.anchorPoints : route.anchors;
    if (targets.length > 0) {
      this.recomputeAnchorKmsAlongPolyline(targets, route.startKm);
    }
    if (route.id === this.activeRouteId) {
      this.refreshAnchorMarkerMeta();
      this.refreshExportPreview();
    }
    this.persistDraft();
    this.updateSummary();
    this.renderRoutesTable();
    this.syncConfigBarFromActiveRoute();
  }

  refreshAnchorMarkerMeta() {
    if (!this.mapReady) {
      return;
    }
    this.anchorPoints.forEach((point, index) => {
      const marker = this.anchorMarkers[index];
      const circle = this.anchorCircles[index];
      if (!marker) {
        return;
      }
      const color = this.colorForPoint(point.km);
      marker.setTitle(`${point.rodovia || "Rodovia"} ${point.sentido} km ${point.km}`);
      marker.setIcon(this.markerIcon(color));
      if (circle) {
        circle.setOptions({
          fillColor: color,
          strokeColor: "#111827",
        });
      }
    });
  }

  applyMetaExportStep(meta) {
    if (!meta) {
      return;
    }
    if (meta.exportStepM != null && meta.exportStepM !== "") {
      this.elements.exportStepM.value = String(Math.round(this.parseNumber(meta.exportStepM, 100)));
    } else if (meta.exportStepKm != null) {
      this.elements.exportStepM.value = String(Math.round(this.parseNumber(meta.exportStepKm, 0.1) * 1000));
    }
  }

  applyRouteToForm(route) {
    this.syncConfigBarFromRoute(route);
    if (route) {
      this.elements.defaultRadius.value = route.defaultRadius || 500;
    }
  }

  hydrateRoutesFromLocalStorage() {
    const raw = localStorage.getItem(STORAGE_KEYS.draft);
    if (!raw) {
      const r = this.createEmptyRoute();
      this.routes = [r];
      this.activeRouteId = r.id;
      this.anchorPoints = [];
      this.applyRouteToForm(r);
      return;
    }

    try {
      const draft = JSON.parse(raw);
      this.applyPersistedDraft(draft);
    } catch (_error) {
      const r = this.createEmptyRoute();
      this.routes = [r];
      this.activeRouteId = r.id;
      this.anchorPoints = [];
      this.applyRouteToForm(r);
    }
  }

  applyPersistedDraft(draft) {
    if (draft.version === DRAFT_VERSION && Array.isArray(draft.routes) && draft.routes.length > 0) {
      this.routes = draft.routes.map((r) => this.normalizeRoute(r));
      this.activeRouteId = draft.activeRouteId && this.getRouteById(draft.activeRouteId)
        ? draft.activeRouteId
        : this.routes[0].id;
      this.applyMetaExportStep(draft.meta);
      const active = this.getActiveRoute();
      this.anchorPoints = this.cloneAnchors(active.anchors);
      this.applyRouteToForm(active);
      if (this.anchorPoints.length > 0) {
        this.recomputeAnchorKmsAlongPolyline(this.anchorPoints, active.startKm);
        active.anchors = this.cloneAnchors(this.anchorPoints);
      }
      this.currentKm = this.anchorPoints.length
        ? this.parseNumber(this.anchorPoints[this.anchorPoints.length - 1].km, 0)
        : this.getActiveStartKm();
      this.lastCoordinate = null;
      return;
    }

    const r = this.createEmptyRoute();
    if (draft.meta) {
      r.roadName = draft.meta.roadName || "";
      r.direction = draft.meta.direction !== undefined && draft.meta.direction !== null
        ? draft.meta.direction
        : "N";
      r.displayName = draft.meta.displayName || "";
      r.defaultRadius = this.parseNumber(draft.meta.defaultRadius, 500);
      r.startKm = this.parseNumber(draft.meta.startKm, 0);
      this.applyMetaExportStep(draft.meta);
    }
    r.anchors = this.cloneAnchors(Array.isArray(draft.anchors) ? draft.anchors : []);
    this.routes = [r];
    this.activeRouteId = r.id;
    this.anchorPoints = this.cloneAnchors(r.anchors);
    this.applyRouteToForm(r);
    if (this.anchorPoints.length > 0) {
      this.recomputeAnchorKmsAlongPolyline(this.anchorPoints, r.startKm);
      r.anchors = this.cloneAnchors(this.anchorPoints);
    }
    const lastPt = this.anchorPoints[this.anchorPoints.length - 1];
    if (lastPt) {
      this.lastCoordinate = { lat: lastPt.latitude, lng: lastPt.longitude };
      this.currentKm = this.parseNumber(lastPt.km, 0);
    } else {
      this.currentKm = r.startKm;
      this.lastCoordinate = null;
    }
  }

  commitActiveRouteToState() {
    const route = this.getActiveRoute();
    if (!route) {
      return;
    }
    route.anchors = this.cloneAnchors(this.anchorPoints);
    route.defaultRadius = this.getDefaultRadius();
    if (this.anchorPoints.length > 0) {
      route.startKm = this.parseNumber(this.anchorPoints[0].km, route.startKm);
    }
  }

  switchActiveRoute(routeId) {
    if (!this.getRouteById(routeId)) {
      return;
    }
    this.commitActiveRouteToState();
    this.activeRouteId = routeId;
    const route = this.getActiveRoute();
    this.applyRouteToForm(route);
    const snapshot = this.cloneAnchors(route.anchors);
    if (this.mapReady) {
      this.replaceAnchorPoints(snapshot);
    } else {
      this.anchorPoints = snapshot;
      if (this.anchorPoints.length > 0) {
        this.recomputeAnchorKmsAlongPolyline(this.anchorPoints, route.startKm);
      }
      const lastPt = this.anchorPoints[this.anchorPoints.length - 1];
      if (lastPt) {
        this.lastCoordinate = { lat: lastPt.latitude, lng: lastPt.longitude };
        this.currentKm = this.parseNumber(lastPt.km, 0);
      } else {
        this.lastCoordinate = null;
        this.currentKm = this.parseNumber(route.startKm, 0);
      }
    }
    this.streetViewFocusedIndex = null;
    this.refreshAnchorVisuals();
    this.persistDraft();
    this.updateSummary();
    this.updateAnchorsToggleUi();
    this.renderRoutesTable();
  }

  openRoutesManager() {
    this.commitActiveRouteToState();
    this.renderRoutesTable();
    this.openModal(this.elements.routesModal);
  }

  renderRoutesTable() {
    const tbody = this.elements.routesTableBody;
    if (!tbody) {
      return;
    }
    tbody.replaceChildren();

    this.routes.forEach((route) => {
      const tr = document.createElement("tr");
      if (route.id === this.activeRouteId) {
        tr.classList.add("routes-row-active");
      }

      const tdRoad = document.createElement("td");
      const inpRoad = document.createElement("input");
      inpRoad.type = "text";
      inpRoad.value = route.roadName;
      inpRoad.placeholder = "BR-116";
      inpRoad.addEventListener("change", () => {
        route.roadName = inpRoad.value.trim();
        this.syncActiveAnchorsWithRouteMetadata(route);
        this.persistDraft();
        this.renderRoutesTable();
      });
      tdRoad.appendChild(inpRoad);

      const tdDir = document.createElement("td");
      const sel = document.createElement("select");
      [["", "Todos"], ["N", "Norte"], ["S", "Sul"], ["L", "Leste"], ["O", "Oeste"]].forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        sel.appendChild(opt);
      });
      sel.value = route.direction === "" ? "" : (route.direction || "N");
      sel.addEventListener("change", () => {
        route.direction = sel.value;
        this.syncActiveAnchorsWithRouteMetadata(route);
        this.persistDraft();
        this.renderRoutesTable();
      });
      tdDir.appendChild(sel);

      const tdName = document.createElement("td");
      const inpName = document.createElement("input");
      inpName.type = "text";
      inpName.value = route.displayName;
      inpName.placeholder = "Descricao";
      inpName.addEventListener("change", () => {
        route.displayName = inpName.value.trim();
        this.syncActiveAnchorsWithRouteMetadata(route);
        this.persistDraft();
        this.renderRoutesTable();
      });
      tdName.appendChild(inpName);

      const tdKm = document.createElement("td");
      tdKm.className = "routes-col-km";
      const inpKm = document.createElement("input");
      inpKm.type = "number";
      inpKm.step = "0.001";
      inpKm.value = Number(route.startKm ?? 0).toFixed(3);
      inpKm.addEventListener("change", () => {
        this.applyStartKmToRoute(route, inpKm.value);
      });
      tdKm.appendChild(inpKm);

      const tdExp = document.createElement("td");
      tdExp.className = "routes-col-export";
      const selExp = document.createElement("select");
      [["normal", "Normal"]].forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        selExp.appendChild(opt);
      });
      selExp.value = route.exportMode || "normal";
      selExp.addEventListener("change", () => {
        route.exportMode = selExp.value;
        this.persistDraft();
        if (route.id === this.activeRouteId) {
          this.refreshExportPreview();
        }
        this.renderRoutesTable();
      });
      tdExp.appendChild(selExp);

      const tdPts = document.createElement("td");
      tdPts.className = "routes-col-points";
      tdPts.textContent = String(route.anchors.length);

      const tdAct = document.createElement("td");
      tdAct.className = "routes-col-actions";

      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "nav-icon-btn nav-icon-btn--on routes-action-icon";
      btnEdit.title = "Editar trecho";
      btnEdit.setAttribute("aria-label", "Editar trecho");
      btnEdit.innerHTML = '<i class="fas fa-pen" aria-hidden="true"></i>';
      btnEdit.addEventListener("click", () => {
        this.switchActiveRoute(route.id);
        this.elements.routesModal.close();
        this.setMapStatus(`Editando trecho: ${route.roadName || "sem nome"}.`);
      });

      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "nav-icon-btn nav-icon-btn--danger routes-action-icon";
      btnDel.title = "Excluir trecho";
      btnDel.setAttribute("aria-label", "Excluir trecho");
      btnDel.innerHTML = '<i class="fas fa-trash-alt" aria-hidden="true"></i>';
      btnDel.disabled = this.routes.length <= 1;
      btnDel.addEventListener("click", () => {
        if (this.routes.length <= 1) {
          return;
        }
        if (!window.confirm("Excluir esta rodovia e todos os pontos do trecho?")) {
          return;
        }
        this.commitActiveRouteToState();
        this.routes = this.routes.filter((r) => r.id !== route.id);
        if (this.activeRouteId === route.id) {
          this.activeRouteId = this.routes[0].id;
        }
        this.switchActiveRoute(this.activeRouteId);
      });

      tdAct.appendChild(btnEdit);
      tdAct.appendChild(btnDel);

      tr.appendChild(tdRoad);
      tr.appendChild(tdDir);
      tr.appendChild(tdName);
      tr.appendChild(tdKm);
      tr.appendChild(tdExp);
      tr.appendChild(tdPts);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  }

  addNewRoute() {
    this.commitActiveRouteToState();
    const r = this.createEmptyRoute();
    this.routes.push(r);
    this.switchActiveRoute(r.id);
    this.setMapStatus("Nova rodovia criada. Marque o trecho no mapa.");
  }

  openMapsApiGate() {
    this.mapsApiModalLocked = true;
    this.elements.closeMapsApiModal.hidden = true;
    this.openModal(this.elements.mapsApiModal);
  }

  openMapsApiSettings() {
    this.mapsApiModalLocked = false;
    this.elements.closeMapsApiModal.hidden = false;
    this.openModal(this.elements.mapsApiModal);
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

  finalizeMapsSession(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return;
    }
    sessionStorage.setItem(STORAGE_KEYS.apiKey, trimmed);
    this.mapsApiModalLocked = false;
    if (this.elements.mapsApiModal.hasAttribute("open")) {
      this.elements.mapsApiModal.close();
    }
  }

  handleKeydown(event) {
    if (event.ctrlKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.undoLastPoint();
      return;
    }

    if (!event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "1") {
      event.preventDefault();
      this.adjustRadiusByPreset(1);
      return;
    }
    if (key === "2") {
      event.preventDefault();
      this.adjustRadiusByPreset(-1);
      return;
    }
    if (key === "q") {
      event.preventDefault();
      this.adjustRadiusByStep(50);
      return;
    }
    if (key === "w") {
      event.preventDefault();
      this.adjustRadiusByStep(-50);
    }
  }

  restorePreferences() {
    const savedKey = localStorage.getItem(STORAGE_KEYS.apiKey);
    if (savedKey) {
      this.elements.apiKey.value = savedKey;
      this.setMapStatus("Chave da API restaurada do navegador.");
    }
  }

  saveApiKey() {
    const apiKey = this.elements.apiKey.value.trim();
    if (!apiKey) {
      this.setMapStatus("Informe uma chave valida antes de salvar.", true);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    this.setMapStatus("Chave salva no navegador.");
  }

  async loadMap() {
    const apiKey = this.elements.apiKey.value.trim() || localStorage.getItem(STORAGE_KEYS.apiKey) || "";
    if (!apiKey) {
      this.setMapStatus("A pagina precisa de uma API key do Google Maps para carregar o mapa.", true);
      return false;
    }

    if (!this.google) {
      this.setMapStatus("Carregando Google Maps...");
      try {
        await this.injectGoogleMaps(apiKey);
      } catch (error) {
        this.setMapStatus(`Falha ao carregar Google Maps: ${error.message}`, true);
        return false;
      }
    }

    if (this.mapReady) {
      this.setMapStatus("O mapa ja esta carregado.");
      this.finalizeMapsSession(apiKey);
      return true;
    }

    this.initializeMap();
    this.setMapStatus("Mapa carregado. Clique para comecar a marcar a rodovia.");
    if (this.anchorPoints.length > 0) {
      const snapshot = this.cloneAnchors(this.anchorPoints);
      this.anchorPoints = [];
      this.replaceAnchorPoints(snapshot);
    } else {
      this.updateSummary();
      this.refreshExportPreview();
    }
    this.renderRoutesTable();
    this.finalizeMapsSession(apiKey);
    return true;
  }

  injectGoogleMaps(apiKey) {
    return new Promise((resolve, reject) => {
      if (window.google?.maps) {
        this.google = window.google;
        resolve();
        return;
      }

      const callbackName = `initStreetPolylineMaker_${Date.now()}`;
      window[callbackName] = () => {
        this.google = window.google;
        delete window[callbackName];
        resolve();
      };

      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${callbackName}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        delete window[callbackName];
        reject(new Error("script nao carregado"));
      };
      document.head.appendChild(script);
    });
  }

  initializeMap() {
    const center = { lat: -23.55052, lng: -46.633308 };
    this.map = new this.google.maps.Map(this.elements.map, {
      center,
      zoom: 8,
      heading: 0,
      tilt: 0,
      mapTypeId: "roadmap",
      renderingType: this.google.maps.RenderingType.VECTOR,
      headingInteractionEnabled: true,
      tiltInteractionEnabled: true,
      gestureHandling: "auto",
      fullscreenControl: false,
      streetViewControl: false,
      mapTypeControl: false,
      styles: [
        { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
      ],
    });

    this.previewLine = new this.google.maps.Polyline({
      path: [center, center],
      geodesic: true,
      strokeColor: "#f59e0b",
      strokeOpacity: 0.95,
      strokeWeight: 3,
      map: this.map,
    });

    this.previewRadius = new this.google.maps.Circle({
      strokeColor: "#f59e0b",
      strokeOpacity: 0.55,
      strokeWeight: 1.5,
      fillColor: "#f59e0b",
      fillOpacity: 0.12,
      center,
      radius: this.getDefaultRadius(),
      map: this.map,
    });

    this.map.addListener("click", (event) => this.handleMapClick(event.latLng));
    this.map.addListener("mousemove", (event) => this.handleMapMove(event.latLng));
    this.previewLine.addListener("click", (event) => this.handleMapClick(event.latLng));
    this.previewRadius.addListener("click", (event) => this.handleMapClick(event.latLng));
    this.previewLine.addListener("mousemove", (event) => this.handleMapMove(event.latLng));
    this.previewRadius.addListener("mousemove", (event) => this.handleMapMove(event.latLng));

    this.historyInfoWindow = new this.google.maps.InfoWindow();
    this.streetViewService = new this.google.maps.StreetViewService();
    this.streetViewPanorama = null;
    this.attachRotationHandlers();
    this.mapReady = true;
    this.elements.mapTypeSelect.disabled = false;
    this.elements.toggleStreetView.disabled = false;
    this.elements.mapTypeSelect.value = this.map.getMapTypeId();
    this.updateStreetViewToggleUi();
    this.updateAnchorsToggleUi();
  }

  applyMapTypeFromSelect() {
    if (!this.mapReady) {
      return;
    }
    const typeId = this.elements.mapTypeSelect.value;
    if (typeId) {
      this.map.setMapTypeId(typeId);
    }
  }

  ensureStreetViewPanorama() {
    if (!this.mapReady || this.streetViewPanorama) {
      return;
    }
    this.streetViewPanorama = new this.google.maps.StreetViewPanorama(this.elements.streetViewPano, {
      visible: false,
      addressControl: true,
      linksControl: true,
      panControl: true,
      enableCloseButton: false,
      fullscreenControl: false,
    });
  }

  applyStreetViewNear(location, options = {}) {
    const focusAnchorIndexOpt = options.focusAnchorIndex;
    const focusPreviewIndexOpt = options.focusPreviewIndex;
    if (!this.mapReady || !this.streetViewService) {
      return;
    }
    this.ensureStreetViewPanorama();
    this.streetViewService.getPanorama({ location, radius: 100 }, (data, status) => {
      if (!this.mapReady || !this.streetViewPanorama) {
        return;
      }
      if (status !== this.google.maps.StreetViewStatus.OK) {
        this.setMapStatus("Street View indisponivel perto deste ponto. Mova o mapa ou marque um ponto na via.", true);
        return;
      }
      this.streetViewPanorama.setPano(data.location.pano);
      this.streetViewPanorama.setPov({ heading: 0, pitch: 0 });
      this.streetViewPanorama.setVisible(true);
      this.elements.streetViewPanel.hidden = false;
      this.elements.streetViewResizeHandle.hidden = false;
      this.elements.mapStage.classList.add("map-stage--split");
      const panelHeight = this.elements.mapStage.style.getPropertyValue("--street-view-panel-height").trim();
      if (!panelHeight) {
        const stage = this.elements.mapStage;
        const h = Math.round(stage.clientHeight * 0.38);
        this.elements.mapStage.style.setProperty("--street-view-panel-height", `${Math.max(160, Math.min(h, 520))}px`);
      }
      this.streetViewVisible = true;
      if (typeof focusAnchorIndexOpt === "number" && focusAnchorIndexOpt >= 0 && focusAnchorIndexOpt < this.anchorPoints.length) {
        this.streetViewFocusedIndex = focusAnchorIndexOpt;
        this.streetViewFocusedPreviewIndex = null;
      } else if (typeof focusPreviewIndexOpt === "number" && focusPreviewIndexOpt >= 0 && focusPreviewIndexOpt < this.previewExportMarkers.length) {
        this.streetViewFocusedPreviewIndex = focusPreviewIndexOpt;
        this.streetViewFocusedIndex = null;
      } else {
        this.streetViewFocusedIndex = null;
        this.streetViewFocusedPreviewIndex = null;
      }
      this.refreshAnchorVisuals();
      this.refreshExportPreviewVisuals();
      this.updateStreetViewToggleUi();
      window.requestAnimationFrame(() => {
        this.google.maps.event.trigger(this.map, "resize");
        this.google.maps.event.trigger(this.streetViewPanorama, "resize");
      });
    });
  }

  openStreetViewPanel() {
    if (!this.mapReady || !this.streetViewService) {
      this.setMapStatus("Carregue o mapa antes de usar o Street View.", true);
      return;
    }
    const location = this.lastCoordinate
      ? { lat: this.lastCoordinate.lat, lng: this.lastCoordinate.lng }
      : this.map.getCenter();
    this.applyStreetViewNear(location);
  }

  closeStreetViewPanel() {
    if (this.streetViewPanorama) {
      this.streetViewPanorama.setVisible(false);
    }
    this.elements.streetViewPanel.hidden = true;
    this.elements.streetViewResizeHandle.hidden = true;
    this.elements.mapStage.classList.remove("map-stage--split");
    this.streetViewVisible = false;
    this.streetViewFocusedIndex = null;
    this.streetViewFocusedPreviewIndex = null;
    this.refreshAnchorVisuals();
    this.refreshExportPreviewVisuals();
    this.updateStreetViewToggleUi();
    if (this.mapReady) {
      window.requestAnimationFrame(() => {
        this.google.maps.event.trigger(this.map, "resize");
      });
    }
  }

  toggleStreetViewPanel() {
    if (!this.mapReady) {
      this.setMapStatus("Carregue o mapa antes de usar o Street View.", true);
      return;
    }
    if (this.streetViewVisible) {
      this.closeStreetViewPanel();
    } else {
      this.openStreetViewPanel();
    }
  }

  updateStreetViewToggleUi() {
    const button = this.elements.toggleStreetView;
    if (!button) {
      return;
    }
    button.classList.toggle("nav-icon-btn--on", this.streetViewVisible);
    button.setAttribute("aria-pressed", String(this.streetViewVisible));
  }

  attachRotationHandlers() {
    const mapDiv = this.map.getDiv();
    mapDiv.addEventListener("mousedown", (event) => {
      if (!event.shiftKey || !this.lastCoordinate) {
        return;
      }

      this.rotationDrag.active = true;
      this.rotationDrag.lastX = event.clientX;
      this.rotationDrag.wasGestureHandling = "none";
      this.map.setOptions({ gestureHandling: "none" });
      this.map.moveCamera({
        center: this.lastCoordinate,
        heading: this.map.getHeading() || 0,
        tilt: this.map.getTilt() || 0,
        zoom: this.map.getZoom(),
      });
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!this.rotationDrag.active || !this.lastCoordinate) {
        return;
      }

      const deltaX = event.clientX - this.rotationDrag.lastX;
      this.rotationDrag.lastX = event.clientX;
      const heading = Number(this.map.getHeading() || 0) + (deltaX * 0.65);
      this.map.moveCamera({
        center: this.lastCoordinate,
        heading,
        tilt: this.map.getTilt() || 0,
        zoom: this.map.getZoom(),
      });
    });

    window.addEventListener("mouseup", () => {
      if (!this.rotationDrag.active) {
        return;
      }

      this.rotationDrag.active = false;
      this.map.setOptions({ gestureHandling: "auto" });
    });
  }

  startSidebarResize(event) {
    if (window.innerWidth <= 820) {
      return;
    }

    this.sidebarResize.active = true;
    this.sidebarResize.startX = event.clientX;
    this.sidebarResize.startWidth = this.elements.sidebar.getBoundingClientRect().width;
    document.body.classList.add("is-resizing");
    event.preventDefault();
  }

  handleSidebarResize(event) {
    if (!this.sidebarResize.active) {
      return;
    }

    const deltaX = event.clientX - this.sidebarResize.startX;
    const width = Math.max(260, Math.min(560, this.sidebarResize.startWidth + deltaX));
    this.elements.appShell.style.setProperty("--sidebar-width", `${width}px`);
    if (this.mapReady) {
      this.google.maps.event.trigger(this.map, "resize");
    }
  }

  stopSidebarResize() {
    if (!this.sidebarResize.active) {
      return;
    }

    this.sidebarResize.active = false;
    document.body.classList.remove("is-resizing");
    if (this.mapReady && this.lastCoordinate) {
      this.map.panTo(this.lastCoordinate);
    }
  }

  startStreetViewResize(event) {
    if (!this.streetViewVisible) {
      return;
    }

    this.streetViewResize.active = true;
    this.streetViewResize.startY = event.clientY;
    this.streetViewResize.startHeight = this.elements.streetViewPanel.getBoundingClientRect().height;
    document.body.classList.add("is-resizing-street");
    event.preventDefault();
  }

  handleStreetViewResize(event) {
    if (!this.streetViewResize.active) {
      return;
    }

    const stage = this.elements.mapStage;
    const rect = stage.getBoundingClientRect();
    const handleHeight = 6;
    const mapMin = 120;
    const panelMin = 120;
    const maxPanel = rect.height - mapMin - handleHeight;
    const delta = event.clientY - this.streetViewResize.startY;
    let next = this.streetViewResize.startHeight - delta;
    next = Math.max(panelMin, Math.min(maxPanel, next));
    stage.style.setProperty("--street-view-panel-height", `${Math.round(next)}px`);
    if (this.mapReady) {
      this.google.maps.event.trigger(this.map, "resize");
      if (this.streetViewPanorama) {
        this.google.maps.event.trigger(this.streetViewPanorama, "resize");
      }
    }
  }

  stopStreetViewResize() {
    if (!this.streetViewResize.active) {
      return;
    }

    this.streetViewResize.active = false;
    document.body.classList.remove("is-resizing-street");
  }

  toggleSidebar() {
    const isCollapsed = this.elements.appShell.classList.toggle("sidebar-collapsed");
    this.elements.toggleSidebar.title = isCollapsed ? "Expandir painel" : "Minimizar painel";
    this.elements.toggleSidebar.setAttribute("aria-label", this.elements.toggleSidebar.title);

    if (this.mapReady) {
      window.setTimeout(() => {
        this.google.maps.event.trigger(this.map, "resize");
        if (this.lastCoordinate) {
          this.map.panTo(this.lastCoordinate);
        }
      }, 220);
    }
  }

  openModal(modal) {
    if (typeof modal.showModal === "function") {
      modal.showModal();
      return;
    }
    modal.setAttribute("open", "");
  }

  adjustRadiusByPreset(direction) {
    const currentRadius = this.getDefaultRadius();
    if (direction > 0) {
      const nextValue = this.radiusPresets.find((value) => value > currentRadius);
      if (nextValue) {
        this.elements.defaultRadius.value = nextValue;
        this.syncPreviewRadius();
      }
      return;
    }

    const previousValues = this.radiusPresets.filter((value) => value < currentRadius);
    if (previousValues.length > 0) {
      this.elements.defaultRadius.value = previousValues[previousValues.length - 1];
      this.syncPreviewRadius();
    }
  }

  adjustRadiusByStep(step) {
    const nextRadius = Math.max(50, Math.min(500, this.getDefaultRadius() + step));
    this.elements.defaultRadius.value = nextRadius;
    this.syncPreviewRadius();
  }

  handleAnchorOrOverlayClick(point, latLng) {
    if (this.streetViewVisible) {
      const focusIndex = this.anchorPoints.findIndex((p) => p.id === point.id);
      this.applyStreetViewNear(
        { lat: point.latitude, lng: point.longitude },
        { focusAnchorIndex: focusIndex >= 0 ? focusIndex : null },
      );
      return;
    }
    this.handleMapClick(latLng);
  }

  handleMapClick(latLng) {
    if (!this.mapReady) {
      return;
    }
    if (this.streetViewVisible) {
      return;
    }

    const coordinate = this.fromLatLng(latLng);
    const active = this.getActiveRoute();
    if (this.anchorPoints.length === 0) {
      this.currentKm = this.roundKm(this.getActiveStartKm());
    } else if (this.lastCoordinate) {
      this.currentKm = this.roundKm(this.currentKm + (this.distanceMeters(this.lastCoordinate, coordinate) / 1000));
    }

    const point = {
      id: this.anchorPoints.length + 1,
      longitude: coordinate.lng,
      latitude: coordinate.lat,
      km: this.currentKm.toFixed(3),
      rodovia: (active?.roadName ?? "").trim(),
      raio: this.getDefaultRadius(),
      sentido: active?.direction ?? "",
      nome: (active?.displayName ?? "").trim(),
    };

    this.anchorPoints.push(point);
    if (active && this.anchorPoints.length === 1) {
      active.startKm = this.parseNumber(point.km, active.startKm);
    }
    this.renderAnchor(point);
    this.lastCoordinate = coordinate;
    this.persistDraft();
    this.updateSummary();
    this.refreshExportPreview();
    this.updateAnchorsToggleUi();
  }

  handleMapMove(latLng) {
    if (!this.mapReady) {
      return;
    }

    const coordinate = this.fromLatLng(latLng);
    this.previewRadius.setCenter(coordinate);
    this.previewRadius.setRadius(this.getDefaultRadius());

    if (!this.lastCoordinate) {
      this.elements.cursorDistance.textContent = "0 m";
      this.previewLine.setPath([coordinate, coordinate]);
      this.elements.nextKm.textContent = this.getActiveStartKm().toFixed(3);
      return;
    }

    const distance = this.distanceMeters(this.lastCoordinate, coordinate);
    const nextKm = this.roundKm(this.currentKm + (distance / 1000));

    this.previewLine.setPath([this.lastCoordinate, coordinate]);
    this.elements.cursorDistance.textContent = `${distance.toFixed(1)} m`;
    this.elements.nextKm.textContent = nextKm.toFixed(3);
  }

  renderAnchor(point) {
    if (!this.mapReady) {
      return;
    }

    const position = { lat: point.latitude, lng: point.longitude };
    const color = this.colorForPoint(point.km);
    const marker = new this.google.maps.Marker({
      position,
      map: this.map,
      title: `${point.rodovia || "Rodovia"} ${point.sentido} km ${point.km}`,
      icon: this.markerIcon(color),
    });

    const circle = new this.google.maps.Circle({
      strokeColor: "#111827",
      strokeOpacity: 0.58,
      strokeWeight: 2,
      fillColor: color,
      fillOpacity: 0.14,
      center: position,
      radius: Number(point.raio) || this.getDefaultRadius(),
      map: this.map,
    });

    circle.addListener("mousemove", (event) => this.handleMapMove(event.latLng));
    marker.addListener("click", (event) => this.handleAnchorOrOverlayClick(point, event.latLng));
    circle.addListener("click", (event) => this.handleAnchorOrOverlayClick(point, event.latLng));

    this.anchorMarkers.push(marker);
    this.anchorCircles.push(circle);
    this.updateAnchorVisibility();

    if (this.anchorPoints.length === 1) {
      this.map.panTo(position);
    }
  }

  undoLastPoint() {
    if (this.anchorPoints.length === 0) {
      this.setMapStatus("Nao ha pontos para desfazer.");
      return;
    }

    this.anchorMarkers.pop()?.setMap(null);
    this.anchorCircles.pop()?.setMap(null);
    this.anchorPoints.pop();

    if (this.streetViewFocusedIndex != null && this.streetViewFocusedIndex >= this.anchorPoints.length) {
      this.streetViewFocusedIndex = null;
    }

    const lastPoint = this.anchorPoints[this.anchorPoints.length - 1] || null;
    if (lastPoint) {
      this.lastCoordinate = { lat: lastPoint.latitude, lng: lastPoint.longitude };
      this.currentKm = this.parseNumber(lastPoint.km, 0);
    } else {
      this.lastCoordinate = null;
      this.currentKm = this.getActiveStartKm();
    }

    this.persistDraft();
    this.updateAnchorVisibility();
    this.updateSummary();
    this.refreshExportPreview();
    this.updateAnchorsToggleUi();
    this.syncConfigBarFromActiveRoute();
  }

  exportAll() {
    this.commitActiveRouteToState();
    const stepM = this.getExportStepMeters();
    const routesWithData = this.routes.filter((r) => r.anchors.length > 0);
    if (routesWithData.length === 0) {
      this.setMapStatus("Marque pelo menos um ponto em algum trecho antes de exportar.", true);
      return;
    }

    let globalId = 1;
    const flatPoints = [];
    const sqlChunks = [];
    routesWithData.forEach((route) => {
      const exportPoints = this.generateExportPoints(route.anchors, stepM, route.exportMode || "normal");
      const renumbered = exportPoints.map((p) => {
        const row = { ...p, id: globalId++ };
        flatPoints.push(row);
        return row;
      });
      const dirLabel = route.direction === "" ? "Todos" : route.direction;
      const label = `${route.roadName || "sem nome"} (${dirLabel})`;
      sqlChunks.push(`/* Trecho: ${label} */\n${this.buildSql(renumbered)}`);
    });

    const payload = this.buildExportPayload(routesWithData, flatPoints, stepM);
    this.elements.sqlOutput.value = sqlChunks.join("\n\n");
    this.elements.jsonOutput.value = JSON.stringify(payload, null, 2);
    this.openModal(this.elements.exportModal);
    this.setMapStatus(`Exportacao gerada com ${flatPoints.length} pontos em ${routesWithData.length} trecho(s).`);
  }

  toggleExportPreview() {
    if (!this.mapReady) {
      this.setMapStatus("Carregue o mapa antes de exibir a pre-visualizacao.", true);
      return;
    }

    this.exportPreviewVisible = !this.exportPreviewVisible;
    this.updateExportPreviewToggleUi();
    this.refreshExportPreview();
    this.setMapStatus(this.exportPreviewVisible ? "Pre-visualizacao da exportacao exibida." : "Pre-visualizacao da exportacao ocultada.");
  }

  refreshExportPreview() {
    this.clearExportPreview();

    if (!this.exportPreviewVisible || !this.mapReady || this.anchorPoints.length === 0) {
      return;
    }

    const exportMode = this.getActiveRoute()?.exportMode || "normal";
    const exportPoints = this.generateExportPoints(this.anchorPoints, this.getExportStepMeters(), exportMode);
    this.previewExportPoints = exportPoints;
    const stepM = this.getExportStepMeters();
    const pointsPerKm = Math.max(1, Math.round(1000 / stepM));
    exportPoints.forEach((point, index) => this.renderExportPreviewPoint(point, index, pointsPerKm));
    this.refreshExportPreviewVisuals();
  }

  clearExportPreview() {
    this.previewExportMarkers.forEach((marker) => marker.setMap(null));
    this.previewExportCircles.forEach((circle) => circle.setMap(null));
    this.previewExportMarkers = [];
    this.previewExportCircles = [];
    this.previewExportPoints = [];
    this.streetViewFocusedPreviewIndex = null;
  }

  buildExportPreviewMarkerIcon(isKilometerPoint, color, focused) {
    return {
      path: this.google.maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: 0.96,
      strokeColor: focused ? "#e0f2fe" : "#020617",
      strokeWeight: focused
        ? (isKilometerPoint ? 3 : 2.5)
        : (isKilometerPoint ? 2 : 1.5),
      scale: focused
        ? (isKilometerPoint ? 9 : 6.5)
        : (isKilometerPoint ? 7 : 5),
    };
  }

  applyExportPreviewCircleStyle(circle, isKilometerPoint, color, focused, previewRadiusM) {
    circle.setOptions({
      strokeColor: focused ? "#e0f2fe" : color,
      strokeOpacity: focused ? 1 : (isKilometerPoint ? 0.62 : 0.28),
      strokeWeight: focused ? 3 : (isKilometerPoint ? 2 : 1),
      fillColor: color,
      fillOpacity: focused
        ? (isKilometerPoint ? 0.22 : 0.12)
        : (isKilometerPoint ? 0.1 : 0.03),
      radius: previewRadiusM,
    });
  }

  refreshExportPreviewVisuals() {
    if (!this.mapReady || this.previewExportPoints.length === 0) {
      return;
    }
    const stepM = this.getExportStepMeters();
    const pointsPerKm = Math.max(1, Math.round(1000 / stepM));
    const previewRadiusM = this.getPreviewCircleRadiusMeters(stepM);
    this.previewExportPoints.forEach((point, index) => {
      const marker = this.previewExportMarkers[index];
      const circle = this.previewExportCircles[index];
      if (!marker || !circle) {
        return;
      }
      const isKilometerPoint = index % pointsPerKm === 0;
      const color = isKilometerPoint ? "#f59e0b" : "#38bdf8";
      const focused = this.streetViewVisible && index === this.streetViewFocusedPreviewIndex;
      marker.setIcon(this.buildExportPreviewMarkerIcon(isKilometerPoint, color, focused));
      marker.setZIndex(focused ? 950 : (isKilometerPoint ? 900 : 700));
      this.applyExportPreviewCircleStyle(circle, isKilometerPoint, color, focused, previewRadiusM);
    });
  }

  handleExportPreviewClick(point, index) {
    if (!this.streetViewVisible) {
      return;
    }
    this.applyStreetViewNear(
      { lat: Number(point.latitude), lng: Number(point.longitude) },
      { focusPreviewIndex: index },
    );
  }

  renderExportPreviewPoint(point, index, pointsPerKm) {
    const isKilometerPoint = index % pointsPerKm === 0;
    const color = isKilometerPoint ? "#f59e0b" : "#38bdf8";
    const previewRadiusM = this.getPreviewCircleRadiusMeters(this.getExportStepMeters());
    const position = { lat: Number(point.latitude), lng: Number(point.longitude) };
    const focused = false;
    const marker = new this.google.maps.Marker({
      position,
      map: this.map,
      clickable: true,
      zIndex: isKilometerPoint ? 900 : 700,
      title: `${point.rodovia || "Rodovia"} km ${point.km}`,
      icon: this.buildExportPreviewMarkerIcon(isKilometerPoint, color, focused),
    });

    const circle = new this.google.maps.Circle({
      strokeColor: color,
      strokeOpacity: isKilometerPoint ? 0.62 : 0.28,
      strokeWeight: isKilometerPoint ? 2 : 1,
      fillColor: color,
      fillOpacity: isKilometerPoint ? 0.1 : 0.03,
      center: position,
      radius: previewRadiusM,
      map: this.map,
      clickable: true,
    });

    marker.addListener("click", () => this.handleExportPreviewClick(point, index));
    circle.addListener("click", () => this.handleExportPreviewClick(point, index));

    this.previewExportMarkers.push(marker);
    this.previewExportCircles.push(circle);
  }

  updateAnchorVisibility() {
    if (!this.anchorsOnMapVisible) {
      this.anchorMarkers.forEach((marker) => marker.setVisible(false));
      this.anchorCircles.forEach((circle) => circle.setVisible(false));
      return;
    }

    const shouldAutoHide = this.elements.autoHideAnchors.checked;
    const total = this.anchorMarkers.length;
    const keepEvery = this.getAnchorVisibilityStep(total);
    const keepTail = total >= 1000 ? 12 : total >= 500 ? 18 : total >= 100 ? 24 : 30;

    this.anchorMarkers.forEach((marker, index) => {
      marker.setVisible(!shouldAutoHide || this.shouldKeepAnchorVisible(index, total, keepEvery, keepTail));
    });
    this.anchorCircles.forEach((circle, index) => {
      circle.setVisible(!shouldAutoHide || this.shouldKeepAnchorVisible(index, total, keepEvery, keepTail));
    });
    this.refreshAnchorVisuals();
  }

  refreshAnchorVisuals() {
    if (!this.mapReady) {
      return;
    }
    this.anchorPoints.forEach((point, index) => {
      const marker = this.anchorMarkers[index];
      const circle = this.anchorCircles[index];
      if (!marker || !circle) {
        return;
      }
      const color = this.colorForPoint(point.km);
      const focused = this.streetViewVisible && index === this.streetViewFocusedIndex;
      marker.setIcon(this.markerIcon(color, { focused }));
      this.applyAnchorCircleStyle(circle, point, color, focused);
    });
  }

  applyAnchorCircleStyle(circle, point, fillColor, focused) {
    const radius = Number(point.raio) || this.getDefaultRadius();
    circle.setOptions({
      strokeColor: focused ? "#e0f2fe" : "#111827",
      strokeOpacity: focused ? 1 : 0.58,
      strokeWeight: focused ? 4 : 2,
      fillColor,
      fillOpacity: focused ? 0.28 : 0.14,
      radius,
    });
  }

  toggleAnchorsOnMap() {
    if (!this.mapReady) {
      this.setMapStatus("Carregue o mapa antes de alternar as ancoras.", true);
      return;
    }
    if (this.anchorPoints.length === 0) {
      this.setMapStatus("Nao ha ancoras no mapa.");
      return;
    }

    this.anchorsOnMapVisible = !this.anchorsOnMapVisible;
    this.updateAnchorVisibility();
    this.updateAnchorsToggleUi();
    this.setMapStatus(this.anchorsOnMapVisible ? "Ancoras exibidas no mapa." : "Ancoras ocultas no mapa.");
  }

  updateAnchorsToggleUi() {
    const button = this.elements.toggleAnchors;
    if (!button) {
      return;
    }

    const hasAnchors = this.anchorPoints.length > 0;
    button.disabled = !hasAnchors;
    if (!hasAnchors) {
      button.classList.remove("nav-icon-btn--on");
      button.setAttribute("aria-pressed", "false");
      button.title = "Nenhuma ancora no mapa";
      return;
    }

    button.classList.toggle("nav-icon-btn--on", this.anchorsOnMapVisible);
    button.setAttribute("aria-pressed", String(this.anchorsOnMapVisible));
    const icon = button.querySelector("i");
    if (icon) {
      icon.className = this.anchorsOnMapVisible ? "fas fa-map-pin" : "fas fa-eye-slash";
    }
    button.title = this.anchorsOnMapVisible ? "Ocultar ancoras no mapa" : "Exibir ancoras no mapa";
  }

  getAnchorVisibilityStep(total) {
    if (total >= 1000) return 10;
    if (total >= 500) return 7;
    if (total >= 250) return 5;
    if (total >= 100) return 4;
    if (total >= 25) return 2;
    return 1;
  }

  shouldKeepAnchorVisible(index, total, keepEvery, keepTail) {
    if (index === 0 || index >= total - keepTail) {
      return true;
    }
    return index % keepEvery === 0;
  }

  generateExportPoints(anchorPoints, stepMeters, _exportMode = "normal") {
    const safeStepM = stepMeters > 0 ? stepMeters : 100;
    const safeStepKm = safeStepM / 1000;
    const points = [];
    let nextId = 1;
    const firstKm = this.parseNumber(anchorPoints[0].km, 0);
    const route = this.buildRouteSegments(anchorPoints);
    const totalDistanceKm = route.reduce((total, segment) => total + segment.distanceKm, 0);

    points.push(this.cloneExportPoint(anchorPoints[0], nextId++, firstKm, this.radiusForKm(firstKm, safeStepKm)));

    for (let targetDistanceKm = safeStepKm; targetDistanceKm < totalDistanceKm; targetDistanceKm = this.roundKm(targetDistanceKm + safeStepKm)) {
      const routePoint = this.pointAtRouteDistance(route, targetDistanceKm);
      if (!routePoint) {
        continue;
      }

      const km = this.roundKm(firstKm + targetDistanceKm);
      const radius = this.radiusForKm(km, safeStepKm);
      points.push(this.cloneExportPoint({
        ...routePoint.source,
        longitude: routePoint.longitude,
        latitude: routePoint.latitude,
      }, nextId++, km, radius));
    }

    const lastAnchor = anchorPoints[anchorPoints.length - 1];
    const lastExport = points[points.length - 1];
    const sameAsLast = lastExport
      && Number(lastExport.latitude).toFixed(7) === Number(lastAnchor.latitude).toFixed(7)
      && Number(lastExport.longitude).toFixed(7) === Number(lastAnchor.longitude).toFixed(7);

    if (!sameAsLast) {
      const lastKm = this.roundKm(firstKm + totalDistanceKm);
      points.push(this.cloneExportPoint(lastAnchor, nextId, lastKm, this.radiusForKm(lastKm, safeStepKm)));
    }

    return points;
  }

  buildRouteSegments(anchorPoints) {
    let accumulatedKm = 0;
    const segments = [];

    for (let index = 0; index < anchorPoints.length - 1; index += 1) {
      const start = anchorPoints[index];
      const end = anchorPoints[index + 1];
      const distanceKm = this.distanceMeters(start, end) / 1000;
      if (distanceKm <= 0) {
        continue;
      }

      segments.push({
        start,
        end,
        distanceKm,
        startDistanceKm: accumulatedKm,
        endDistanceKm: accumulatedKm + distanceKm,
      });
      accumulatedKm += distanceKm;
    }

    return segments;
  }

  pointAtRouteDistance(route, targetDistanceKm) {
    const segment = route.find((item) => targetDistanceKm <= item.endDistanceKm + 1e-9);
    if (!segment) {
      return null;
    }

    const distanceInsideSegment = targetDistanceKm - segment.startDistanceKm;
    const fraction = distanceInsideSegment / segment.distanceKm;
    return {
      ...this.interpolatePoint(segment.start, segment.end, fraction),
      source: segment.start,
    };
  }

  buildExportPayload(routesWithData, flatPoints, stepM) {
    return {
      version: DRAFT_VERSION,
      createdAt: new Date().toISOString(),
      activeRouteId: this.activeRouteId,
      stepKm: stepM / 1000,
      stepM,
      routes: routesWithData.map((route) => ({
        id: route.id,
        roadName: route.roadName,
        direction: route.direction,
        displayName: route.displayName,
        startKm: route.startKm,
        defaultRadius: route.defaultRadius,
        anchors: this.cloneAnchors(route.anchors),
        exportMode: route.exportMode || "normal",
        exportPoints: this.generateExportPoints(route.anchors, stepM, route.exportMode || "normal"),
      })),
      exportPointsFlat: flatPoints,
    };
  }

  buildSql(points) {
    const columns = [
      ["id", "CD_GEOPOSICAO"],
      ["longitude", "LONGITUDE"],
      ["latitude", "LATITUDE"],
      ["km", "KM_METRO"],
      ["rodovia", "RODOVIA"],
      ["raio", "RAIO"],
      ["sentido", "SENTIDO"],
      ["nome", "NOME"],
    ];

    return points.map((point, index) => {
      const names = columns.map(([, column]) => `[${column}]`).join(", ");
      const values = columns.map(([key]) => this.sqlValue(point[key])).join(", ");
      return `/* LINHA ${index + 1} */ INSERT INTO GEOPOSICAO(${names}) VALUES (${values});`;
    }).join("\n");
  }

  sqlValue(value) {
    if (value === null || value === undefined || value === "") {
      return "NULL";
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  async copyOutput(element) {
    if (!element.value.trim()) {
      this.setMapStatus("Nao ha conteudo para copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(element.value);
      this.setMapStatus("Conteudo copiado para a area de transferencia.");
    } catch (_error) {
      this.setMapStatus("Falha ao copiar. O navegador pode bloquear a area de transferencia.", true);
    }
  }

  loadImportFile(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    file.text().then((text) => {
      this.elements.importText.value = text;
      this.setMapStatus(`Arquivo ${file.name} carregado para importacao.`);
    }).catch(() => {
      this.setMapStatus("Nao foi possivel ler o arquivo selecionado.", true);
    });
  }

  importFromInputs(asEditableHistory) {
    const raw = this.elements.importText.value.trim();
    if (!raw) {
      this.setMapStatus("Cole um JSON ou selecione um arquivo antes de importar.", true);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      this.setMapStatus("JSON invalido.", true);
      return;
    }

    if (asEditableHistory && this.importRoutesFromPayload(parsed)) {
      this.elements.importModal.close();
      return;
    }

    const anchors = this.extractAnchorList(parsed);
    if (anchors.length === 0) {
      this.setMapStatus("O JSON nao contem pontos reconheciveis.", true);
      return;
    }

    if (asEditableHistory) {
      this.replaceAnchorPoints(anchors);
      this.updateSummary();
      this.elements.importModal.close();
      this.refreshExportPreview();
      this.renderRoutesTable();
      this.setMapStatus(`${anchors.length} pontos importados para continuar a edicao.`);
      return;
    }

    this.renderImportedPoints(anchors);
    this.elements.importModal.close();
    this.setMapStatus(`${anchors.length} pontos importados para visualizacao.`);
  }

  importRoutesFromPayload(parsed) {
    if (!(parsed.version >= 2 && Array.isArray(parsed.routes) && parsed.routes.length > 0)) {
      return false;
    }

    this.commitActiveRouteToState();
    this.routes = parsed.routes.map((r) => this.normalizeRoute(r));
    this.activeRouteId = parsed.activeRouteId && this.getRouteById(parsed.activeRouteId)
      ? parsed.activeRouteId
      : this.routes[0].id;
    this.applyMetaExportStep(parsed.meta || { exportStepM: parsed.stepM, exportStepKm: parsed.stepKm });
    this.switchActiveRoute(this.activeRouteId);
    const totalAnchors = this.routes.reduce((n, r) => n + r.anchors.length, 0);
    this.setMapStatus(`${this.routes.length} rodovia(s), ${totalAnchors} ponto(s) importados para edicao.`);
    return true;
  }

  extractAnchorList(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.anchors)) {
      return parsed.anchors;
    }
    if (Array.isArray(parsed.exportPoints)) {
      return parsed.exportPoints;
    }
    if (parsed.version >= 2 && Array.isArray(parsed.routes)) {
      const merged = [];
      parsed.routes.forEach((route) => {
        if (Array.isArray(route.anchors)) {
          merged.push(...route.anchors);
        }
      });
      if (merged.length > 0) {
        return merged;
      }
      parsed.routes.forEach((route) => {
        if (Array.isArray(route.exportPoints)) {
          merged.push(...route.exportPoints);
        }
      });
      return merged;
    }
    return [];
  }

  renderImportedPoints(points) {
    if (!this.mapReady) {
      this.setMapStatus("Carregue o mapa antes de importar.", true);
      return;
    }

    this.importedMarkers.forEach((marker) => marker.setMap(null));
    this.importedCircles.forEach((circle) => circle.setMap(null));
    this.closeHistoryTooltip();
    this.importedMarkers = [];
    this.importedCircles = [];

    points.forEach((point) => {
      const normalized = {
        longitude: Number(point.longitude),
        latitude: Number(point.latitude),
        km: this.parseNumber(point.km, 0).toFixed(3),
        rodovia: point.rodovia || "",
        raio: Number(point.raio) || this.getDefaultRadius(),
        sentido: point.sentido || "",
        nome: point.nome || "",
      };
      const position = { lat: normalized.latitude, lng: normalized.longitude };
      const marker = new this.google.maps.Marker({
        position,
        map: this.map,
        title: this.formatHistoryTitle(normalized),
        icon: {
          path: this.google.maps.SymbolPath.CIRCLE,
          fillColor: "#38bdf8",
          fillOpacity: 0.95,
          strokeColor: "#e2e8f0",
          strokeWeight: 1.5,
          scale: 5,
        },
      });
      const circle = new this.google.maps.Circle({
        strokeColor: "#38bdf8",
        strokeOpacity: 0.52,
        strokeWeight: 1,
        fillColor: "#38bdf8",
        fillOpacity: 0.08,
        center: position,
        radius: normalized.raio,
        map: this.map,
      });

      [marker, circle].forEach((overlay) => {
        overlay.addListener("mouseover", (event) => this.showHistoryTooltip(normalized, event.latLng || position));
        overlay.addListener("mousemove", (event) => this.showHistoryTooltip(normalized, event.latLng || position));
        overlay.addListener("mouseout", () => this.closeHistoryTooltip());
        overlay.addListener("click", (event) => {
          if (event.domEvent?.ctrlKey) {
            this.createAnchorFromHistory(normalized);
          }
        });
      });

      this.importedMarkers.push(marker);
      this.importedCircles.push(circle);
    });

    this.importedVisible = true;
    if (points[0]) {
      this.map.panTo({ lat: Number(points[0].latitude), lng: Number(points[0].longitude) });
    }

    this.updateImportedToggleUi();
  }

  replaceAnchorPoints(points) {
    this.anchorMarkers.forEach((marker) => marker.setMap(null));
    this.anchorCircles.forEach((circle) => circle.setMap(null));
    this.anchorMarkers = [];
    this.anchorCircles = [];
    this.anchorPoints = [];

    const active = this.getActiveRoute();
    const metaR = active
      ? {
        roadName: active.roadName || "",
        direction: active.direction ?? "",
        displayName: active.displayName || "",
      }
      : {
        roadName: this.elements.roadName.value.trim(),
        direction: this.elements.direction.value,
        displayName: this.elements.displayName.value.trim(),
      };

    points.forEach((point, index) => {
      const rodoviaRaw = point.rodovia != null ? String(point.rodovia).trim() : "";
      const nomeRaw = point.nome != null ? String(point.nome).trim() : "";
      const normalized = {
        id: index + 1,
        longitude: Number(point.longitude),
        latitude: Number(point.latitude),
        km: this.parseNumber(point.km, 0).toFixed(3),
        rodovia: rodoviaRaw || metaR.roadName,
        raio: Number(point.raio) || this.getDefaultRadius(),
        sentido: point.sentido !== undefined && point.sentido !== null
          ? point.sentido
          : metaR.direction,
        nome: nomeRaw || metaR.displayName,
      };
      this.anchorPoints.push(normalized);
      this.renderAnchor(normalized);
    });

    if (active && this.anchorPoints.length > 0) {
      const f = this.anchorPoints[0];
      if (f.rodovia && String(f.rodovia).trim()) {
        active.roadName = String(f.rodovia).trim();
      }
      if (f.sentido !== undefined && f.sentido !== null) {
        active.direction = f.sentido;
      }
      if (f.nome != null && String(f.nome).trim()) {
        active.displayName = String(f.nome).trim();
      }
      active.startKm = this.parseNumber(f.km, active.startKm);
      this.recomputeAnchorKmsAlongPolyline(this.anchorPoints, active.startKm);
    }

    const lastPoint = this.anchorPoints[this.anchorPoints.length - 1];
    if (lastPoint) {
      this.elements.defaultRadius.value = Number(lastPoint.raio) || this.getDefaultRadius();
      this.currentKm = this.parseNumber(lastPoint.km, 0);
      this.lastCoordinate = { lat: lastPoint.latitude, lng: lastPoint.longitude };
      if (this.mapReady) {
        this.map.panTo(this.lastCoordinate);
      }
    } else {
      this.lastCoordinate = null;
      this.currentKm = active ? this.getActiveStartKm() : 0;
    }

    if (active) {
      active.anchors = this.cloneAnchors(this.anchorPoints);
      active.defaultRadius = this.getDefaultRadius();
      if (this.anchorPoints.length > 0) {
        active.startKm = this.parseNumber(this.anchorPoints[0].km, active.startKm);
      }
    }

    this.syncConfigBarFromActiveRoute();
    this.streetViewFocusedIndex = null;
    this.refreshExportPreview();
    this.updateAnchorsToggleUi();
    this.persistDraft();
  }

  loadDraftFromStorage() {
    const rawDraft = localStorage.getItem(STORAGE_KEYS.draft);
    if (!rawDraft) {
      this.setMapStatus("Nenhum historico local salvo foi encontrado.");
      return;
    }

    let draft;
    try {
      draft = JSON.parse(rawDraft);
    } catch (_error) {
      this.setMapStatus("O historico salvo esta invalido e foi ignorado.", true);
      return;
    }

    this.applyPersistedDraft(draft);
    if (this.mapReady) {
      const active = this.getActiveRoute();
      const snapshot = active ? this.cloneAnchors(active.anchors) : [];
      this.replaceAnchorPoints(snapshot);
    }

    this.updateSummary();
    this.setMapStatus(`Historico local carregado (${this.routes.length} rodovia(s)).`);
    this.refreshExportPreview();
    this.updateAnchorsToggleUi();
    this.renderRoutesTable();
  }

  persistDraft() {
    this.commitActiveRouteToState();
    const payload = {
      version: DRAFT_VERSION,
      activeRouteId: this.activeRouteId,
      meta: {
        exportStepM: this.getExportStepMeters(),
      },
      routes: this.routes.map((r) => ({
        id: r.id,
        roadName: r.roadName,
        direction: r.direction,
        displayName: r.displayName,
        startKm: r.startKm,
        defaultRadius: r.defaultRadius,
        exportMode: r.exportMode || "normal",
        anchors: this.cloneAnchors(r.anchors),
      })),
    };

    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(payload));
  }

  toggleImportedVisibility() {
    if (this.importedCircles.length === 0 && this.importedMarkers.length === 0) {
      this.setMapStatus("Nenhum ponto importado esta visivel.");
      return;
    }

    this.importedVisible = !this.importedVisible;
    this.importedMarkers.forEach((marker) => marker.setVisible(this.importedVisible));
    this.importedCircles.forEach((circle) => circle.setVisible(this.importedVisible));
    if (!this.importedVisible) {
      this.closeHistoryTooltip();
    }
    this.setMapStatus(this.importedVisible ? "Importados exibidos." : "Importados ocultos.");
    this.updateImportedToggleUi();
  }

  clearAll() {
    this.closeStreetViewPanel();
    this.streetViewFocusedIndex = null;
    this.anchorsOnMapVisible = true;
    this.anchorMarkers.forEach((marker) => marker.setMap(null));
    this.anchorCircles.forEach((circle) => circle.setMap(null));
    this.importedMarkers.forEach((marker) => marker.setMap(null));
    this.importedCircles.forEach((circle) => circle.setMap(null));
    this.clearExportPreview();
    this.closeHistoryTooltip();

    this.anchorMarkers = [];
    this.anchorCircles = [];
    this.importedMarkers = [];
    this.importedCircles = [];
    this.anchorPoints = [];
    this.lastCoordinate = null;
    const active = this.getActiveRoute();
    if (active) {
      active.anchors = [];
      this.currentKm = active.startKm;
    } else {
      this.currentKm = 0;
    }
    this.elements.sqlOutput.value = "";
    this.elements.jsonOutput.value = "";
    this.persistDraft();
    this.updateSummary();
    this.updateImportedToggleUi();
    this.updateAnchorsToggleUi();
    this.renderRoutesTable();
    this.syncConfigBarFromActiveRoute();
    this.setMapStatus("Trecho ativo limpo. Importados removidos. Historico local atualizado.");
  }

  syncPreviewRadius() {
    if (this.previewRadius) {
      this.previewRadius.setRadius(this.getDefaultRadius());
    }
    this.refreshExportPreview();
  }

  showHistoryTooltip(point, latLng) {
    if (!this.historyInfoWindow) {
      return;
    }

    const position = typeof latLng.lat === "function" ? latLng : { lat: latLng.lat, lng: latLng.lng };
    this.historyInfoWindow.setPosition(position);
    this.historyInfoWindow.setContent(`
      <div style="min-width:220px;font-size:12px;line-height:1.45">
        <strong>${point.rodovia || "Rodovia sem nome"}</strong><br>
        KM: ${point.km}<br>
        Sentido: ${point.sentido || "-"}<br>
        Raio: ${point.raio} m<br>
        Nome: ${point.nome || "-"}<br>
        Latitude: ${Number(point.latitude).toFixed(6)}<br>
        Longitude: ${Number(point.longitude).toFixed(6)}
      </div>
    `);
    this.historyInfoWindow.open({ map: this.map });
  }

  closeHistoryTooltip() {
    this.historyInfoWindow?.close();
  }

  formatHistoryTitle(point) {
    return `${point.rodovia || "Rodovia"} ${point.sentido || ""} km ${point.km}`.trim();
  }

  createAnchorFromHistory(point) {
    const active = this.getActiveRoute();
    const coordinate = { lat: Number(point.latitude), lng: Number(point.longitude) };
    let nextKm;
    if (this.anchorPoints.length === 0) {
      nextKm = this.roundKm(this.getActiveStartKm());
    } else {
      const ref = this.lastCoordinate || {
        lat: this.anchorPoints[this.anchorPoints.length - 1].latitude,
        lng: this.anchorPoints[this.anchorPoints.length - 1].longitude,
      };
      nextKm = this.roundKm(
        this.parseNumber(this.anchorPoints[this.anchorPoints.length - 1].km, 0)
        + (this.distanceMeters(ref, coordinate) / 1000),
      );
    }

    const normalized = {
      id: this.anchorPoints.length + 1,
      longitude: coordinate.lng,
      latitude: coordinate.lat,
      km: nextKm.toFixed(3),
      rodovia: (active?.roadName ?? "").trim(),
      raio: Number(point.raio) || this.getDefaultRadius(),
      sentido: active?.direction ?? "",
      nome: (active?.displayName ?? "").trim(),
    };

    this.elements.defaultRadius.value = normalized.raio;

    this.anchorPoints.push(normalized);
    if (active && this.anchorPoints.length === 1) {
      active.startKm = this.parseNumber(normalized.km, active.startKm);
    }
    this.renderAnchor(normalized);
    this.lastCoordinate = coordinate;
    this.currentKm = nextKm;
    this.persistDraft();
    this.updateSummary();
    this.refreshExportPreview();
    this.updateAnchorsToggleUi();
    this.syncConfigBarFromActiveRoute();
    this.setMapStatus(`Ponto do historico convertido para edicao no km ${normalized.km}.`);
  }

  updateSummary() {
    const active = this.getActiveRoute();
    const trecho = active?.roadName ? ` [${active.roadName}]` : "";

    if (this.anchorPoints.length === 0) {
      this.elements.summaryText.textContent = `Nenhum ponto marcado no trecho ativo${trecho}.`;
      this.elements.nextKm.textContent = this.getActiveStartKm().toFixed(3);
      return;
    }

    const first = this.anchorPoints[0];
    const last = this.anchorPoints[this.anchorPoints.length - 1];
    this.elements.summaryText.textContent = `${this.anchorPoints.length} pontos em ${first.rodovia || "rodovia sem nome"}${trecho}, km ${first.km} a ${last.km}.`;
    this.elements.nextKm.textContent = this.parseNumber(last.km, 0).toFixed(3);
  }

  setMapStatus(message, isError = false) {
    this.elements.mapStatus.textContent = message;
    this.elements.mapStatus.classList.toggle("error-text", isError);
  }

  parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  roundKm(value) {
    return Number(value.toFixed(3));
  }

  getDefaultRadius() {
    return this.parseNumber(this.elements.defaultRadius.value, 500);
  }

  getExportStepMeters() {
    const meters = this.parseNumber(this.elements.exportStepM.value, 100);
    return meters > 0 ? meters : 100;
  }

  getPreviewCircleRadiusMeters(stepMeters) {
    const step = stepMeters > 0 ? stepMeters : 100;
    return Math.max(10, Math.round(step / 2));
  }

  updateExportPreviewToggleUi() {
    const button = this.elements.toggleExportPreview;
    if (!button) {
      return;
    }

    button.classList.toggle("nav-icon-btn--on", this.exportPreviewVisible);
    button.setAttribute("aria-pressed", String(this.exportPreviewVisible));
    const icon = button.querySelector("i");
    if (icon) {
      icon.className = this.exportPreviewVisible ? "fas fa-eye" : "fas fa-eye-slash";
    }
    button.title = this.exportPreviewVisible ? "Ocultar pre-visualizacao" : "Exibir pre-visualizacao";
  }

  updateImportedToggleUi() {
    const button = this.elements.toggleImported;
    if (!button) {
      return;
    }

    const hasImports = this.importedMarkers.length > 0;
    button.disabled = !hasImports;
    if (!hasImports) {
      button.classList.remove("nav-icon-btn--on");
      button.setAttribute("aria-pressed", "false");
      button.title = "Nenhum ponto importado";
      return;
    }

    button.classList.toggle("nav-icon-btn--on", this.importedVisible);
    button.setAttribute("aria-pressed", String(this.importedVisible));
    button.title = this.importedVisible ? "Ocultar importados" : "Exibir importados";
  }

  fromLatLng(latLng) {
    if (typeof latLng.lat === "function") {
      return { lat: latLng.lat(), lng: latLng.lng() };
    }
    return { lat: Number(latLng.lat), lng: Number(latLng.lng) };
  }

  distanceMeters(pointA, pointB) {
    const aLat = Number(pointA.lat ?? pointA.latitude);
    const aLng = Number(pointA.lng ?? pointA.longitude);
    const bLat = Number(pointB.lat ?? pointB.latitude);
    const bLng = Number(pointB.lng ?? pointB.longitude);
    const toRadians = (degrees) => degrees * (Math.PI / 180);
    const earthRadiusKm = 6371;
    const dLat = toRadians(bLat - aLat);
    const dLng = toRadians(bLng - aLng);
    const lat1 = toRadians(aLat);
    const lat2 = toRadians(bLat);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c * 1000;
  }

  interpolatePoint(start, end, fraction) {
    return {
      longitude: start.longitude + ((end.longitude - start.longitude) * fraction),
      latitude: start.latitude + ((end.latitude - start.latitude) * fraction),
    };
  }

  cloneExportPoint(point, id, km, radius) {
    return {
      id,
      longitude: Number(point.longitude),
      latitude: Number(point.latitude),
      km: Number(km).toFixed(3),
      rodovia: point.rodovia || "",
      raio: radius,
      sentido: point.sentido || "N",
      nome: point.nome || "",
    };
  }

  radiusForKm(km, stepKm) {
    const decimalPart = Math.abs(km - Math.round(km));
    if (decimalPart < 1e-9) {
      return this.getDefaultRadius();
    }
    return Math.max(10, Math.round((stepKm * 1000) / 2));
  }

  markerIcon(color, options = {}) {
    const focused = options.focused === true;
    return {
      path: "M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z M -2,-30 a 2,2 0 1,1 4,0 2,2 0 1,1 -4,0",
      fillColor: color,
      fillOpacity: 1,
      strokeColor: focused ? "#e0f2fe" : "#020617",
      strokeWeight: focused ? 3 : 2,
      scale: focused ? 1.18 : 1,
    };
  }

  colorForPoint(km) {
    return Number(km).toFixed(3).endsWith(".000") ? "#f59e0b" : "#38bdf8";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.streetPolylineMaker = new StreetPolylineMakerApp();
});
