const STORAGE_KEYS = {
  apiKey: "streetPolylineMaker.apiKey",
  draft: "streetPolylineMaker.draft",
};

class StreetPolylineMakerApp {
  constructor() {
    this.map = null;
    this.google = null;
    this.anchorMarkers = [];
    this.anchorCircles = [];
    this.importedCircles = [];
    this.previewLine = null;
    this.previewRadius = null;
    this.anchorPoints = [];
    this.lastCoordinate = null;
    this.currentKm = 0;
    this.importedVisible = true;
    this.kmManuallyChanged = false;
    this.mapReady = false;

    this.elements = {
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
      exportData: document.getElementById("exportData"),
      loadHistory: document.getElementById("loadHistory"),
      toggleImported: document.getElementById("toggleImported"),
      clearAll: document.getElementById("clearAll"),
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
    this.elements.saveApiKey.addEventListener("click", () => this.saveApiKey());
    this.elements.loadMap.addEventListener("click", () => this.loadMap());
    this.elements.exportData.addEventListener("click", () => this.exportAll());
    this.elements.loadHistory.addEventListener("click", () => this.loadDraftFromStorage());
    this.elements.toggleImported.addEventListener("click", () => this.toggleImportedVisibility());
    this.elements.clearAll.addEventListener("click", () => this.clearAll());
    this.elements.importJson.addEventListener("click", () => this.importFromInputs(false));
    this.elements.useJsonAsHistory.addEventListener("click", () => this.importFromInputs(true));
    this.elements.importFile.addEventListener("change", (event) => this.loadImportFile(event));
    this.elements.startKm.addEventListener("change", () => this.handleKmInputChange());
    this.elements.defaultRadius.addEventListener("change", () => this.syncPreviewRadius());
    this.elements.copySql.addEventListener("click", () => this.copyOutput(this.elements.sqlOutput));
    this.elements.copyJson.addEventListener("click", () => this.copyOutput(this.elements.jsonOutput));

    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undoLastPoint();
      }
    });
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
      this.setMapStatus("Informe uma chave válida antes de salvar.", true);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    this.setMapStatus("Chave salva no navegador.");
  }

  async loadMap() {
    const apiKey = this.elements.apiKey.value.trim() || localStorage.getItem(STORAGE_KEYS.apiKey) || "";
    if (!apiKey) {
      this.setMapStatus("A página precisa de uma API key do Google Maps para carregar o mapa.", true);
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
      this.setMapStatus("O mapa já está carregado.");
      return;
    }

    this.initializeMap();
    this.setMapStatus("Mapa carregado. Clique para começar a marcar a rodovia.");
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
        reject(new Error("script não carregado"));
      };
      document.head.appendChild(script);
    });
  }

  initializeMap() {
    const center = { lat: -23.55052, lng: -46.633308 };
    this.map = new this.google.maps.Map(this.elements.map, {
      center,
      zoom: 8,
      mapTypeId: "roadmap",
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
      strokeColor: "#17130e",
      strokeOpacity: 0.9,
      strokeWeight: 4,
      map: this.map,
    });

    this.previewRadius = new this.google.maps.Circle({
      strokeColor: "#17130e",
      strokeOpacity: 0.7,
      strokeWeight: 2,
      fillColor: "#17130e",
      fillOpacity: 0.14,
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

    this.mapReady = true;
  }

  handleKmInputChange() {
    this.kmManuallyChanged = true;
    this.currentKm = this.parseNumber(this.elements.startKm.value, 0);
    this.updateSummary();
  }

  handleMapClick(latLng) {
    if (!this.mapReady) {
      return;
    }

    const coordinate = this.fromLatLng(latLng);
    if (!this.kmManuallyChanged && this.lastCoordinate) {
      const distanceMeters = this.distanceMeters(this.lastCoordinate, coordinate);
      this.currentKm = this.roundKm(this.currentKm + (distanceMeters / 1000));
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

    const color = this.colorForPoint(point.km);
    const position = { lat: point.latitude, lng: point.longitude };
    const marker = new this.google.maps.Marker({
      position,
      map: this.map,
      title: `${point.rodovia || "Rodovia"} ${point.sentido} km ${point.km}`,
      icon: this.markerIcon(color),
    });

    const circle = new this.google.maps.Circle({
      strokeColor: "#17130e",
      strokeOpacity: 0.55,
      strokeWeight: 2,
      fillColor: color,
      fillOpacity: 0.18,
      center: position,
      radius: Number(point.raio) || this.getDefaultRadius(),
      map: this.map,
    });

    circle.addListener("mousemove", (event) => this.handleMapMove(event.latLng));
    marker.addListener("click", (event) => this.handleMapClick(event.latLng));
    circle.addListener("click", (event) => this.handleMapClick(event.latLng));

    this.anchorMarkers.push(marker);
    this.anchorCircles.push(circle);

    if (this.anchorPoints.length === 1) {
      this.map.panTo(position);
      this.map.setZoom(12);
    }
  }

  undoLastPoint() {
    if (this.anchorPoints.length === 0) {
      this.setMapStatus("Não há pontos para desfazer.");
      return;
    }

    const marker = this.anchorMarkers.pop();
    const circle = this.anchorCircles.pop();
    marker?.setMap(null);
    circle?.setMap(null);
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
    this.updateSummary();
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
    this.setMapStatus(`Exportação gerada com ${exportPoints.length} pontos.`);
  }

  generateExportPoints(anchorPoints, stepKm) {
    const safeStepKm = stepKm > 0 ? stepKm : 0.1;
    const points = [];
    let nextId = 1;
    let distanceSinceLastGenerated = 0;
    const firstKm = this.parseNumber(anchorPoints[0].km, 0);

    const firstPoint = this.cloneExportPoint(anchorPoints[0], nextId++, firstKm, this.radiusForKm(firstKm, safeStepKm));
    points.push(firstPoint);

    for (let index = 0; index < anchorPoints.length - 1; index += 1) {
      const start = anchorPoints[index];
      const end = anchorPoints[index + 1];
      const segmentKm = this.distanceMeters(start, end) / 1000;
      const startKm = this.parseNumber(start.km, 0);
      const endKm = this.parseNumber(end.km, startKm);

      if (segmentKm === 0) {
        continue;
      }

      let traversedKm = 0;
      let remainingSegmentKm = segmentKm;

      while ((distanceSinceLastGenerated + remainingSegmentKm) >= safeStepKm) {
        const stepInsideSegment = safeStepKm - distanceSinceLastGenerated;
        traversedKm += stepInsideSegment;
        remainingSegmentKm -= stepInsideSegment;
        const fraction = traversedKm / segmentKm;
        const interpolatedKm = this.roundKm(startKm + ((endKm - startKm) * fraction));
        const interpolated = this.interpolatePoint(start, end, fraction);
        const radius = this.radiusForKm(interpolatedKm, safeStepKm);

        points.push(this.cloneExportPoint({
          ...start,
          ...interpolated,
          raio: radius,
          km: interpolatedKm.toFixed(3),
        }, nextId++, interpolatedKm, radius));

        distanceSinceLastGenerated = 0;
      }

      distanceSinceLastGenerated = this.roundKm(distanceSinceLastGenerated + remainingSegmentKm);
    }

    const lastAnchor = anchorPoints[anchorPoints.length - 1];
    const lastExport = points[points.length - 1];
    const sameAsLast = lastExport
      && Number(lastExport.latitude).toFixed(7) === Number(lastAnchor.latitude).toFixed(7)
      && Number(lastExport.longitude).toFixed(7) === Number(lastAnchor.longitude).toFixed(7);

    if (!sameAsLast) {
      const lastKm = this.parseNumber(lastAnchor.km, firstKm);
      points.push(this.cloneExportPoint(lastAnchor, nextId, lastKm, this.radiusForKm(lastKm, safeStepKm)));
    }

    return points;
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
      this.setMapStatus("Não há conteúdo para copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(element.value);
      this.setMapStatus("Conteúdo copiado para a área de transferência.");
    } catch (_error) {
      this.setMapStatus("Falha ao copiar. O navegador pode bloquear a área de transferência.", true);
    }
  }

  loadImportFile(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    file.text().then((text) => {
      this.elements.importText.value = text;
      this.setMapStatus(`Arquivo ${file.name} carregado para importação.`);
    }).catch(() => {
      this.setMapStatus("Não foi possível ler o arquivo selecionado.", true);
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
      this.setMapStatus("JSON inválido.", true);
      return;
    }

    const anchors = this.extractAnchorList(parsed);
    if (anchors.length === 0) {
      this.setMapStatus("O JSON não contém pontos reconhecíveis.", true);
      return;
    }

    if (asEditableHistory) {
      this.replaceAnchorPoints(anchors);
      this.persistDraft();
      this.updateSummary();
      this.setMapStatus(`${anchors.length} pontos importados para continuar a edição.`);
      return;
    }

    this.renderImportedPoints(anchors);
    this.setMapStatus(`${anchors.length} pontos importados para visualização.`);
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

    this.importedCircles.forEach((circle) => circle.setMap(null));
    this.importedCircles = [];

    points.forEach((point) => {
      const circle = new this.google.maps.Circle({
        strokeColor: "#1f7a8c",
        strokeOpacity: 0.6,
        strokeWeight: 1,
        fillColor: "#1f7a8c",
        fillOpacity: 0.12,
        center: { lat: Number(point.latitude), lng: Number(point.longitude) },
        radius: Number(point.raio) || this.getDefaultRadius(),
        map: this.map,
      });
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
  }

  loadDraftFromStorage() {
    const rawDraft = localStorage.getItem(STORAGE_KEYS.draft);
    if (!rawDraft) {
      this.setMapStatus("Nenhum histórico local salvo foi encontrado.");
      return;
    }

    let draft;
    try {
      draft = JSON.parse(rawDraft);
    } catch (_error) {
      this.setMapStatus("O histórico salvo está inválido e foi ignorado.", true);
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
    this.setMapStatus(`${anchors.length} pontos restaurados do histórico local.`);
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
    if (this.importedCircles.length === 0) {
      this.setMapStatus("Nenhum ponto importado está visível.");
      return;
    }

    this.importedVisible = !this.importedVisible;
    this.importedCircles.forEach((circle) => circle.setVisible(this.importedVisible));
    this.setMapStatus(this.importedVisible ? "Importados exibidos." : "Importados ocultos.");
  }

  clearAll() {
    this.anchorMarkers.forEach((marker) => marker.setMap(null));
    this.anchorCircles.forEach((circle) => circle.setMap(null));
    this.importedCircles.forEach((circle) => circle.setMap(null));

    this.anchorMarkers = [];
    this.anchorCircles = [];
    this.importedCircles = [];
    this.anchorPoints = [];
    this.lastCoordinate = null;
    this.currentKm = this.parseNumber(this.elements.startKm.value, 0);
    this.elements.sqlOutput.value = "";
    this.elements.jsonOutput.value = "";
    localStorage.removeItem(STORAGE_KEYS.draft);
    this.updateSummary();
    this.setMapStatus("Mapa e histórico local limpos.");
  }

  syncPreviewRadius() {
    if (this.previewRadius) {
      this.previewRadius.setRadius(this.getDefaultRadius());
    }
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
    this.elements.mapStatus.style.color = isError ? "#a1372f" : "";
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
    const toRadians = (degrees) => degrees * (Math.PI / 180);
    const earthRadiusKm = 6371;
    const dLat = toRadians(pointB.lat - pointA.lat);
    const dLng = toRadians(pointB.lng - pointA.lng);
    const lat1 = toRadians(pointA.lat);
    const lat2 = toRadians(pointB.lat);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
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
      strokeColor: "#17130e",
      strokeWeight: 2,
      scale: 1,
    };
  }

  colorForPoint(km) {
    return Number(km).toFixed(3).endsWith(".000") ? "#f4b942" : "#1f7a8c";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.streetPolylineMaker = new StreetPolylineMakerApp();
});
