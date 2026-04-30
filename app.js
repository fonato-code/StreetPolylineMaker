const STORAGE_KEYS = {
  apiKey: "streetPolylineMaker.apiKey",
  draft: "streetPolylineMaker.draft",
};

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
    this.kmManuallyChanged = false;
    this.importedVisible = true;
    this.exportPreviewVisible = false;
    this.radiusPresets = [50, 100, 150, 250, 500];
    this.rotationDrag = { active: false, lastX: 0, wasGestureHandling: "auto" };
    this.sidebarResize = { active: false, startX: 0, startWidth: 320 };

    this.elements = {
      appShell: document.getElementById("appShell"),
      sidebar: document.getElementById("sidebar"),
      sidebarResizeHandle: document.getElementById("sidebarResizeHandle"),
      toggleSidebar: document.getElementById("toggleSidebar"),
      apiKey: document.getElementById("apiKey"),
      saveApiKey: document.getElementById("saveApiKey"),
      loadMap: document.getElementById("loadMap"),
      mapStatus: document.getElementById("mapStatus"),
      roadName: document.getElementById("roadName"),
      direction: document.getElementById("direction"),
      startKm: document.getElementById("startKm"),
      displayName: document.getElementById("displayName"),
      defaultRadius: document.getElementById("defaultRadius"),
      exportStepKm: document.getElementById("exportStepKm"),
      autoHideAnchors: document.getElementById("autoHideAnchors"),
      exportData: document.getElementById("exportData"),
      toggleExportPreview: document.getElementById("toggleExportPreview"),
      openImportModal: document.getElementById("openImportModal"),
      loadHistory: document.getElementById("loadHistory"),
      toggleImported: document.getElementById("toggleImported"),
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
    };

    this.attachUiEvents();
    this.restorePreferences();
    this.updateSummary();
  }

  attachUiEvents() {
    this.elements.toggleSidebar.addEventListener("click", () => this.toggleSidebar());
    this.elements.sidebarResizeHandle.addEventListener("mousedown", (event) => this.startSidebarResize(event));
    this.elements.saveApiKey.addEventListener("click", () => this.saveApiKey());
    this.elements.loadMap.addEventListener("click", () => this.loadMap());
    this.elements.exportData.addEventListener("click", () => this.exportAll());
    this.elements.toggleExportPreview.addEventListener("click", () => this.toggleExportPreview());
    this.elements.openImportModal.addEventListener("click", () => this.openModal(this.elements.importModal));
    this.elements.closeImportModal.addEventListener("click", () => this.elements.importModal.close());
    this.elements.closeExportModal.addEventListener("click", () => this.elements.exportModal.close());
    this.elements.loadHistory.addEventListener("click", () => this.loadDraftFromStorage());
    this.elements.toggleImported.addEventListener("click", () => this.toggleImportedVisibility());
    this.elements.clearAll.addEventListener("click", () => this.clearAll());
    this.elements.autoHideAnchors.addEventListener("change", () => this.updateAnchorVisibility());
    this.elements.importJson.addEventListener("click", () => this.importFromInputs(false));
    this.elements.useJsonAsHistory.addEventListener("click", () => this.importFromInputs(true));
    this.elements.importFile.addEventListener("change", (event) => this.loadImportFile(event));
    this.elements.startKm.addEventListener("change", () => this.handleKmInputChange());
    this.elements.defaultRadius.addEventListener("change", () => this.syncPreviewRadius());
    this.elements.exportStepKm.addEventListener("change", () => this.refreshExportPreview());
    this.elements.copySql.addEventListener("click", () => this.copyOutput(this.elements.sqlOutput));
    this.elements.copyJson.addEventListener("click", () => this.copyOutput(this.elements.jsonOutput));

    document.addEventListener("keydown", (event) => this.handleKeydown(event));
    document.addEventListener("mousemove", (event) => this.handleSidebarResize(event));
    document.addEventListener("mouseup", () => this.stopSidebarResize());

    [this.elements.importModal, this.elements.exportModal].forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.close();
        }
      });
    });
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
      return;
    }

    if (!this.google) {
      this.setMapStatus("Carregando Google Maps...");
      try {
        await this.injectGoogleMaps(apiKey);
      } catch (error) {
        this.setMapStatus(`Falha ao carregar Google Maps: ${error.message}`, true);
        return;
      }
    }

    if (this.mapReady) {
      this.setMapStatus("O mapa ja esta carregado.");
      return;
    }

    this.initializeMap();
    this.setMapStatus("Mapa carregado. Clique para comecar a marcar a rodovia.");
    this.loadDraftFromStorage();
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
    this.attachRotationHandlers();
    this.mapReady = true;
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

  handleKmInputChange() {
    this.kmManuallyChanged = true;
    this.currentKm = this.parseNumber(this.elements.startKm.value, 0);
    this.updateSummary();
    this.refreshExportPreview();
  }

  handleMapClick(latLng) {
    if (!this.mapReady) {
      return;
    }

    const coordinate = this.fromLatLng(latLng);
    if (!this.kmManuallyChanged && this.lastCoordinate) {
      this.currentKm = this.roundKm(this.currentKm + (this.distanceMeters(this.lastCoordinate, coordinate) / 1000));
    } else if (this.anchorPoints.length === 0) {
      this.currentKm = this.roundKm(this.parseNumber(this.elements.startKm.value, 0));
    }

    const point = {
      id: this.anchorPoints.length + 1,
      longitude: coordinate.lng,
      latitude: coordinate.lat,
      km: this.currentKm.toFixed(3),
      rodovia: this.elements.roadName.value.trim(),
      raio: this.getDefaultRadius(),
      sentido: this.elements.direction.value,
      nome: this.elements.displayName.value.trim(),
    };

    this.anchorPoints.push(point);
    this.renderAnchor(point);
    this.lastCoordinate = coordinate;
    this.kmManuallyChanged = false;
    this.persistDraft();
    this.updateSummary();
    this.refreshExportPreview();
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
      this.elements.nextKm.textContent = this.parseNumber(this.elements.startKm.value, 0).toFixed(3);
      return;
    }

    const distance = this.distanceMeters(this.lastCoordinate, coordinate);
    const nextKm = this.kmManuallyChanged
      ? this.parseNumber(this.elements.startKm.value, 0)
      : this.roundKm(this.currentKm + (distance / 1000));

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
    marker.addListener("click", (event) => this.handleMapClick(event.latLng));
    circle.addListener("click", (event) => this.handleMapClick(event.latLng));

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

    const lastPoint = this.anchorPoints[this.anchorPoints.length - 1] || null;
    if (lastPoint) {
      this.lastCoordinate = { lat: lastPoint.latitude, lng: lastPoint.longitude };
      this.currentKm = this.parseNumber(lastPoint.km, 0);
      this.elements.startKm.value = Number(lastPoint.km).toFixed(3);
    } else {
      this.lastCoordinate = null;
      this.currentKm = this.parseNumber(this.elements.startKm.value, 0);
    }

    this.persistDraft();
    this.updateAnchorVisibility();
    this.updateSummary();
    this.refreshExportPreview();
  }

  exportAll() {
    if (this.anchorPoints.length === 0) {
      this.setMapStatus("Marque pelo menos um ponto antes de exportar.", true);
      return;
    }

    const exportPoints = this.generateExportPoints(this.anchorPoints, this.parseNumber(this.elements.exportStepKm.value, 0.1));
    const payload = this.buildExportPayload(exportPoints);
    this.elements.sqlOutput.value = this.buildSql(exportPoints);
    this.elements.jsonOutput.value = JSON.stringify(payload, null, 2);
    this.openModal(this.elements.exportModal);
    this.setMapStatus(`Exportacao gerada com ${exportPoints.length} pontos.`);
  }

  toggleExportPreview() {
    if (!this.mapReady) {
      this.setMapStatus("Carregue o mapa antes de exibir a pre-visualizacao.", true);
      return;
    }

    this.exportPreviewVisible = !this.exportPreviewVisible;
    this.elements.toggleExportPreview.querySelector(".btn-label").textContent = this.exportPreviewVisible
      ? "Esconder pre-visualizacao"
      : "Exibir pre-visualizacao";
    this.refreshExportPreview();
    this.setMapStatus(this.exportPreviewVisible ? "Pre-visualizacao da exportacao exibida." : "Pre-visualizacao da exportacao ocultada.");
  }

  refreshExportPreview() {
    this.clearExportPreview();

    if (!this.exportPreviewVisible || !this.mapReady || this.anchorPoints.length === 0) {
      return;
    }

    const exportPoints = this.generateExportPoints(this.anchorPoints, this.parseNumber(this.elements.exportStepKm.value, 0.1));
    exportPoints.forEach((point, index) => this.renderExportPreviewPoint(point, index));
  }

  clearExportPreview() {
    this.previewExportMarkers.forEach((marker) => marker.setMap(null));
    this.previewExportCircles.forEach((circle) => circle.setMap(null));
    this.previewExportMarkers = [];
    this.previewExportCircles = [];
  }

  renderExportPreviewPoint(point, index) {
    const isKilometerPoint = index % 10 === 0;
    const color = isKilometerPoint ? "#f59e0b" : "#38bdf8";
    const position = { lat: Number(point.latitude), lng: Number(point.longitude) };
    const marker = new this.google.maps.Marker({
      position,
      map: this.map,
      clickable: false,
      zIndex: isKilometerPoint ? 900 : 700,
      title: `${point.rodovia || "Rodovia"} km ${point.km}`,
      icon: {
        path: this.google.maps.SymbolPath.CIRCLE,
        fillColor: color,
        fillOpacity: 0.96,
        strokeColor: "#020617",
        strokeWeight: isKilometerPoint ? 2 : 1.5,
        scale: isKilometerPoint ? 7 : 5,
      },
    });

    const circle = new this.google.maps.Circle({
      strokeColor: color,
      strokeOpacity: isKilometerPoint ? 0.62 : 0.28,
      strokeWeight: isKilometerPoint ? 2 : 1,
      fillColor: color,
      fillOpacity: isKilometerPoint ? 0.1 : 0.03,
      center: position,
      radius: Number(point.raio) || this.getDefaultRadius(),
      map: this.map,
      clickable: false,
    });

    this.previewExportMarkers.push(marker);
    this.previewExportCircles.push(circle);
  }

  updateAnchorVisibility() {
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

  generateExportPoints(anchorPoints, stepKm) {
    const safeStepKm = stepKm > 0 ? stepKm : 0.1;
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

  buildExportPayload(exportPoints) {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      roadName: this.elements.roadName.value.trim(),
      startKm: this.parseNumber(this.elements.startKm.value, 0),
      stepKm: this.parseNumber(this.elements.exportStepKm.value, 0.1),
      anchors: this.anchorPoints,
      exportPoints,
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

    const anchors = this.extractAnchorList(parsed);
    if (anchors.length === 0) {
      this.setMapStatus("O JSON nao contem pontos reconheciveis.", true);
      return;
    }

    if (asEditableHistory) {
      this.replaceAnchorPoints(anchors);
      this.persistDraft();
      this.updateSummary();
      this.elements.importModal.close();
      this.refreshExportPreview();
      this.setMapStatus(`${anchors.length} pontos importados para continuar a edicao.`);
      return;
    }

    this.renderImportedPoints(anchors);
    this.elements.importModal.close();
    this.setMapStatus(`${anchors.length} pontos importados para visualizacao.`);
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
  }

  replaceAnchorPoints(points) {
    this.anchorMarkers.forEach((marker) => marker.setMap(null));
    this.anchorCircles.forEach((circle) => circle.setMap(null));
    this.anchorMarkers = [];
    this.anchorCircles = [];
    this.anchorPoints = [];

    points.forEach((point, index) => {
      const normalized = {
        id: index + 1,
        longitude: Number(point.longitude),
        latitude: Number(point.latitude),
        km: this.parseNumber(point.km, 0).toFixed(3),
        rodovia: point.rodovia || this.elements.roadName.value.trim(),
        raio: Number(point.raio) || this.getDefaultRadius(),
        sentido: point.sentido || this.elements.direction.value,
        nome: point.nome || this.elements.displayName.value.trim(),
      };
      this.anchorPoints.push(normalized);
      this.renderAnchor(normalized);
    });

    const lastPoint = this.anchorPoints[this.anchorPoints.length - 1];
    if (lastPoint) {
      this.elements.roadName.value = lastPoint.rodovia || this.elements.roadName.value;
      this.elements.direction.value = lastPoint.sentido || this.elements.direction.value;
      this.elements.displayName.value = lastPoint.nome || this.elements.displayName.value;
      this.elements.defaultRadius.value = Number(lastPoint.raio) || this.getDefaultRadius();
      this.elements.startKm.value = Number(lastPoint.km).toFixed(3);
      this.currentKm = Number(lastPoint.km);
      this.lastCoordinate = { lat: lastPoint.latitude, lng: lastPoint.longitude };
      if (this.mapReady) {
        this.map.panTo(this.lastCoordinate);
      }
    }

    this.refreshExportPreview();
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

    if (draft.meta) {
      this.elements.roadName.value = draft.meta.roadName || "";
      this.elements.direction.value = draft.meta.direction || "N";
      this.elements.displayName.value = draft.meta.displayName || "";
      this.elements.defaultRadius.value = draft.meta.defaultRadius || 500;
      this.elements.startKm.value = this.parseNumber(draft.meta.startKm, 0).toFixed(3);
      this.elements.exportStepKm.value = this.parseNumber(draft.meta.exportStepKm, 0.1).toFixed(3);
    }

    const anchors = Array.isArray(draft.anchors) ? draft.anchors : [];
    if (anchors.length === 0) {
      this.updateSummary();
      return;
    }

    if (this.mapReady) {
      this.replaceAnchorPoints(anchors);
    } else {
      this.anchorPoints = anchors;
    }
    this.updateSummary();
    this.setMapStatus(`${anchors.length} pontos restaurados do historico local.`);
    this.refreshExportPreview();
  }

  persistDraft() {
    const payload = {
      meta: {
        roadName: this.elements.roadName.value.trim(),
        direction: this.elements.direction.value,
        displayName: this.elements.displayName.value.trim(),
        defaultRadius: this.getDefaultRadius(),
        startKm: this.parseNumber(this.elements.startKm.value, 0),
        exportStepKm: this.parseNumber(this.elements.exportStepKm.value, 0.1),
      },
      anchors: this.anchorPoints,
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
  }

  clearAll() {
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
    this.currentKm = this.parseNumber(this.elements.startKm.value, 0);
    this.elements.sqlOutput.value = "";
    this.elements.jsonOutput.value = "";
    localStorage.removeItem(STORAGE_KEYS.draft);
    this.updateSummary();
    this.setMapStatus("Mapa e historico local limpos.");
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
    const normalized = {
      id: this.anchorPoints.length + 1,
      longitude: Number(point.longitude),
      latitude: Number(point.latitude),
      km: this.parseNumber(point.km, 0).toFixed(3),
      rodovia: point.rodovia || this.elements.roadName.value.trim(),
      raio: Number(point.raio) || this.getDefaultRadius(),
      sentido: point.sentido || this.elements.direction.value,
      nome: point.nome || this.elements.displayName.value.trim(),
    };

    this.elements.roadName.value = normalized.rodovia;
    this.elements.direction.value = normalized.sentido;
    this.elements.displayName.value = normalized.nome;
    this.elements.defaultRadius.value = normalized.raio;
    this.elements.startKm.value = normalized.km;

    this.anchorPoints.push(normalized);
    this.renderAnchor(normalized);
    this.lastCoordinate = { lat: normalized.latitude, lng: normalized.longitude };
    this.currentKm = Number(normalized.km);
    this.kmManuallyChanged = false;
    this.persistDraft();
    this.updateSummary();
    this.refreshExportPreview();
    this.setMapStatus(`Ponto do historico convertido para edicao no km ${normalized.km}.`);
  }

  updateSummary() {
    if (this.anchorPoints.length === 0) {
      this.elements.summaryText.textContent = "Nenhum ponto marcado.";
      this.elements.nextKm.textContent = this.parseNumber(this.elements.startKm.value, 0).toFixed(3);
      return;
    }

    const first = this.anchorPoints[0];
    const last = this.anchorPoints[this.anchorPoints.length - 1];
    this.elements.summaryText.textContent = `${this.anchorPoints.length} pontos marcados em ${first.rodovia || "rodovia sem nome"}, do km ${first.km} ao km ${last.km}.`;
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

  markerIcon(color) {
    return {
      path: "M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z M -2,-30 a 2,2 0 1,1 4,0 2,2 0 1,1 -4,0",
      fillColor: color,
      fillOpacity: 1,
      strokeColor: "#020617",
      strokeWeight: 2,
      scale: 1,
    };
  }

  colorForPoint(km) {
    return Number(km).toFixed(3).endsWith(".000") ? "#f59e0b" : "#38bdf8";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.streetPolylineMaker = new StreetPolylineMakerApp();
});
