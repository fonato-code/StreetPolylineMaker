/** @typedef {{ lat: number, lng: number }} LatLngLiteral */

/**
 * @typedef {Object} KmlTreeNode
 * @property {string} id
 * @property {'folder'|'placemark'|'unsupported'} kind
 * @property {string} name
 * @property {Element} [element]
 * @property {KmlTreeNode[]} [children]
 * @property {string} [hint]
 */

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `kml_${idSeq}`;
}

export function resetKmlTreeIds() {
  idSeq = 0;
}

export function localTag(el) {
  if (!el || el.nodeType !== 1) {
    return "";
  }
  const ln = el.localName;
  if (ln) {
    return ln.toLowerCase();
  }
  const tn = el.tagName || "";
  const i = tn.indexOf(":");
  return (i >= 0 ? tn.slice(i + 1) : tn).toLowerCase();
}

function elementChildren(parent) {
  return [...parent.childNodes].filter((n) => n.nodeType === 1);
}

function getDirectChild(parent, tagLc) {
  return elementChildren(parent).find((c) => localTag(c) === tagLc);
}

function getChildText(parent, tagLc) {
  const el = getDirectChild(parent, tagLc);
  return el?.textContent?.trim() || "";
}

/**
 * @param {string} text
 * @returns {LatLngLiteral[]}
 */
export function parseCoordinates(text) {
  if (!text || !String(text).trim()) {
    return [];
  }
  const pts = [];
  const chunks = String(text).trim().split(/[\s\n\r\t]+/).filter(Boolean);
  for (const triple of chunks) {
    const parts = triple.split(",");
    if (parts.length < 2) {
      continue;
    }
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      pts.push({ lat, lng });
    }
  }
  return pts;
}

/**
 * @param {Element} placemarkEl
 * @returns {{ geometries: { type: string, path?: LatLngLiteral[], paths?: LatLngLiteral[][] }[], error?: string }}
 */
export function extractPlacemarkGeometries(placemarkEl) {
  const geometries = [];
  try {
    const mg = getDirectChild(placemarkEl, "multigeometry");
    if (mg) {
      collectGeometries(mg, geometries);
      return { geometries };
    }
    for (const child of elementChildren(placemarkEl)) {
      const t = localTag(child);
      if (t === "point" || t === "linestring" || t === "polygon") {
        collectGeometries(child, geometries);
      }
    }
  } catch (e) {
    return { geometries: [], error: e instanceof Error ? e.message : String(e) };
  }

  return { geometries };
}

/**
 * @param {Element} el
 * @param {{ type: string, path?: LatLngLiteral[], paths?: LatLngLiteral[][] }[]} out
 */
function collectGeometries(el, out) {
  const tag = localTag(el);
  if (tag === "point") {
    const c = getDirectChild(el, "coordinates");
    const pts = parseCoordinates(c?.textContent || "");
    if (pts[0]) {
      out.push({ type: "Point", path: [pts[0]] });
    }
    return;
  }
  if (tag === "linestring") {
    const c = getDirectChild(el, "coordinates");
    const path = parseCoordinates(c?.textContent || "");
    if (path.length > 0) {
      out.push({ type: "LineString", path });
    }
    return;
  }
  if (tag === "linearring") {
    const c = getDirectChild(el, "coordinates");
    const path = parseCoordinates(c?.textContent || "");
    if (path.length > 0) {
      out.push({ type: "LinearRing", path });
    }
    return;
  }
  if (tag === "polygon") {
    const ringPaths = [];
    const outer = getDirectChild(el, "outerboundaryis");
    const outerRing = outer && getDirectChild(outer, "linearring");
    if (outerRing) {
      const c = getDirectChild(outerRing, "coordinates");
      const p = parseCoordinates(c?.textContent || "");
      if (p.length) {
        ringPaths.push(p);
      }
    }
    for (const ib of elementChildren(el)) {
      if (localTag(ib) !== "innerboundaryis") {
        continue;
      }
      const r = getDirectChild(ib, "linearring");
      const c = r && getDirectChild(r, "coordinates");
      const p = parseCoordinates(c?.textContent || "");
      if (p.length) {
        ringPaths.push(p);
      }
    }
    if (ringPaths.length > 0) {
      out.push({ type: "Polygon", paths: ringPaths });
    }
    return;
  }
  if (tag === "multigeometry") {
    for (const child of elementChildren(el)) {
      collectGeometries(child, out);
    }
    return;
  }
}

/**
 * @param {string} kmlString
 * @returns {{ roots: KmlTreeNode[], stats: { folders: number, placemarks: number, unsupported: number } }}
 */
export function parseKmlToForest(kmlString) {
  resetKmlTreeIds();
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlString, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("KML/XML invalido ou nao suportado pelo navegador.");
  }

  const rootEl = doc.documentElement;
  let scanRoot = rootEl;
  if (localTag(rootEl) === "kml") {
    const documentEl = elementChildren(rootEl).find((c) => localTag(c) === "document");
    scanRoot = documentEl || rootEl;
  }

  const roots = [];
  const stats = { folders: 0, placemarks: 0, unsupported: 0 };

  for (const child of elementChildren(scanRoot)) {
    const tag = localTag(child);
    if (tag === "folder") {
      roots.push(parseFolder(child, stats));
    } else if (tag === "placemark") {
      roots.push(parsePlacemark(child, stats));
    } else if (tag === "networklink" || tag === "groundoverlay") {
      stats.unsupported += 1;
      roots.push({
        id: nextId(),
        kind: "unsupported",
        name: getChildText(child, "name") || tag,
        element: child,
        hint: tag,
      });
    }
  }

  return { roots, stats };
}

/**
 * @param {Element} folderEl
 * @param {{ folders: number, placemarks: number, unsupported: number }} stats
 * @returns {KmlTreeNode}
 */
function parseFolder(folderEl, stats) {
  stats.folders += 1;
  const name = getChildText(folderEl, "name") || "Pasta";
  /** @type {KmlTreeNode} */
  const node = { id: nextId(), kind: "folder", name, children: [] };

  for (const child of elementChildren(folderEl)) {
    const tag = localTag(child);
    if (tag === "folder") {
      node.children.push(parseFolder(child, stats));
    } else if (tag === "placemark") {
      node.children.push(parsePlacemark(child, stats));
    } else if (tag === "networklink" || tag === "groundoverlay") {
      stats.unsupported += 1;
      node.children.push({
        id: nextId(),
        kind: "unsupported",
        name: getChildText(child, "name") || tag,
        element: child,
        hint: tag,
      });
    }
  }

  return node;
}

/**
 * @param {Element} pmEl
 * @param {{ folders: number, placemarks: number, unsupported: number }} stats
 * @returns {KmlTreeNode}
 */
function parsePlacemark(pmEl, stats) {
  stats.placemarks += 1;
  const name = getChildText(pmEl, "name") || "Placemark";
  return { id: nextId(), kind: "placemark", name, element: pmEl };
}

/**
 * @param {KmlTreeNode} node
 * @returns {KmlTreeNode[]}
 */
export function collectPlacemarkNodes(node) {
  if (node.kind === "placemark") {
    return [node];
  }
  if (node.kind === "folder" && node.children) {
    return node.children.flatMap((c) => collectPlacemarkNodes(c));
  }
  return [];
}
