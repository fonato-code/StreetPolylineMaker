/** @typedef {{ lat: number, lng: number }} LatLngLiteral */

/**
 * Tipos usados na UI / filtro: point | line | polygon | ring | model | track | unsupported | empty | other
 * @typedef {Object} KmlTreeNode
 * @property {string} id
 * @property {'folder'|'placemark'|'unsupported'} kind
 * @property {string} name
 * @property {Element} [element]
 * @property {KmlTreeNode[]} [children]
 * @property {string} [hint]
 * @property {string[]} [geomKinds]
 * @property {string[]} [folderGeomKinds]
 * @property {ResolvedKmlStyle|null} [styleColors]
 */

/** @typedef {{ stroke?: string, strokeOpacity?: number, fill?: string, fillOpacity?: number, icon?: string, iconOpacity?: number }} ResolvedKmlStyle */

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
/**
 * Cor KML aabbggrr (hex) -> rgba CSS stroke/fill para Google Maps
 * @param {string} hex
 * @returns {{ hex: string, opacity: number } | null}
 */
export function kmlAbgrToMapsColor(hex) {
  const raw = String(hex || "").replace(/^#/, "").replace(/\s/g, "");
  if (raw.length < 6) {
    return null;
  }
  const padded = raw.padStart(8, "0").slice(-8);
  const a = parseInt(padded.slice(0, 2), 16);
  const b = parseInt(padded.slice(2, 4), 16);
  const g = parseInt(padded.slice(4, 6), 16);
  const r = parseInt(padded.slice(6, 8), 16);
  if ([a, b, g, r].some((n) => Number.isNaN(n))) {
    return null;
  }
  const opacity = a / 255;
  const hexRgb = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  return { hex: hexRgb, opacity: opacity > 0 ? opacity : 1 };
}

/**
 * @param {Element} placemarkEl
 * @returns {string[]}
 */
export function placemarkGeometryKinds(placemarkEl) {
  const { geometries, error } = extractPlacemarkGeometries(placemarkEl);
  if (!error && geometries.length > 0) {
    /** @type {Set<string>} */
    const kinds = new Set();
    for (const g of geometries) {
      if (g.type === "Point") {
        kinds.add("point");
      } else if (g.type === "LineString") {
        kinds.add("line");
      } else if (g.type === "LinearRing") {
        kinds.add("ring");
      } else if (g.type === "Polygon") {
        kinds.add("polygon");
      }
    }
    return [...kinds];
  }

  const extra = [];
  for (const child of elementChildren(placemarkEl)) {
    const t = localTag(child);
    if (t === "model") {
      extra.push("model");
    }
    if (t === "track" || t.endsWith("track") || t === "multitrack") {
      extra.push("track");
    }
  }
  if (extra.length) {
    return [...new Set(extra)];
  }
  return ["empty"];
}

function styleUrlToId(text) {
  const t = String(text || "").trim();
  if (!t) {
    return null;
  }
  const hash = t.lastIndexOf("#");
  const raw = hash >= 0 ? t.slice(hash + 1) : t;
  const id = raw.trim().split(/\s/)[0];
  return id || null;
}

function getStyleUrlFromElement(el) {
  const su = getDirectChild(el, "styleurl");
  return styleUrlToId(su?.textContent || "");
}

/**
 * Primeiro styleUrl na subida (placemark → pasta → …) tem precedência.
 * @param {Element} placemarkEl
 */
export function resolvePlacemarkStyleId(placemarkEl) {
  let node = placemarkEl;
  while (node) {
    const direct = getStyleUrlFromElement(node);
    if (direct) {
      return direct;
    }
    const tag = localTag(node);
    if (tag === "document" || tag === "kml") {
      break;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * @param {Element} styleEl
 * @returns {ResolvedKmlStyle}
 */
function parseStyleElement(styleEl) {
  /** @type {ResolvedKmlStyle} */
  const out = {};
  const ls = getDirectChild(styleEl, "linestyle");
  if (ls) {
    const col = getDirectChild(ls, "color")?.textContent?.trim();
    const c = col ? kmlAbgrToMapsColor(col) : null;
    if (c) {
      out.stroke = c.hex;
      out.strokeOpacity = c.opacity;
    }
  }
  const ps = getDirectChild(styleEl, "polystyle");
  if (ps) {
    const col = getDirectChild(ps, "color")?.textContent?.trim();
    const c = col ? kmlAbgrToMapsColor(col) : null;
    if (c) {
      out.fill = c.hex;
      out.fillOpacity = c.opacity;
    }
  }
  const ic = getDirectChild(styleEl, "iconstyle");
  if (ic) {
    const col = getDirectChild(ic, "color")?.textContent?.trim();
    const c = col ? kmlAbgrToMapsColor(col) : null;
    if (c) {
      out.icon = c.hex;
      out.iconOpacity = c.opacity;
    }
  }
  return out;
}

/**
 * @param {Document} xmlDoc
 * @returns {Map<string, { type: 'style', style: ResolvedKmlStyle } | { type: 'stylemap', normalId: string | null }>}
 */
export function buildKmlStyleIndex(xmlDoc) {
  /** @type {Map<string, { type: 'style', style: ResolvedKmlStyle } | { type: 'stylemap', normalId: string | null }>} */
  const map = new Map();

  function walk(el) {
    const tag = localTag(el);
    if (tag === "style") {
      const id = el.getAttribute("id");
      if (id) {
        map.set(id, { type: "style", style: parseStyleElement(el) });
      }
    } else if (tag === "stylemap") {
      const id = el.getAttribute("id");
      if (!id) {
        return;
      }
      let normalId = null;
      for (const pair of elementChildren(el)) {
        if (localTag(pair) !== "pair") {
          continue;
        }
        const keyEl = getDirectChild(pair, "key");
        const styleUrlEl = getDirectChild(pair, "styleurl");
        const key = keyEl?.textContent?.trim().toLowerCase();
        const urlText = styleUrlEl?.textContent?.trim();
        if (key === "normal" && urlText) {
          normalId = styleUrlToId(urlText);
        }
      }
      map.set(id, { type: "stylemap", normalId });
    }
    for (const c of elementChildren(el)) {
      walk(c);
    }
  }

  walk(xmlDoc.documentElement);
  return map;
}

/**
 * @param {string} styleId
 * @param {Map<string, { type: 'style', style: ResolvedKmlStyle } | { type: 'stylemap', normalId: string | null }>} index
 * @param {Set<string>} [seen]
 * @returns {ResolvedKmlStyle|null}
 */
export function resolveKmlStyle(styleId, index, seen = new Set()) {
  if (!styleId || seen.has(styleId)) {
    return null;
  }
  seen.add(styleId);
  const entry = index.get(styleId);
  if (!entry) {
    return null;
  }
  if (entry.type === "style") {
    return entry.style;
  }
  if (entry.type === "stylemap" && entry.normalId) {
    return resolveKmlStyle(entry.normalId, index, seen);
  }
  return null;
}

/**
 * @param {Element} placemarkEl
 * @param {Map<string, { type: 'style', style: ResolvedKmlStyle } | { type: 'stylemap', normalId: string | null }>} styleIndex
 */
export function resolvePlacemarkStyle(placemarkEl, styleIndex) {
  const id = resolvePlacemarkStyleId(placemarkEl);
  if (!id) {
    return null;
  }
  return resolveKmlStyle(id, styleIndex);
}

/**
 * @param {KmlTreeNode[]} roots
 * @param {Document} xmlDoc
 */
export function enrichKmlForest(roots, xmlDoc) {
  const styleIndex = buildKmlStyleIndex(xmlDoc);

  function walkPlacemarks(node) {
    if (node.kind === "placemark" && node.element) {
      node.geomKinds = placemarkGeometryKinds(node.element);
      node.styleColors = resolvePlacemarkStyle(node.element, styleIndex);
    } else if (node.kind === "folder" && node.children) {
      node.children.forEach(walkPlacemarks);
    }
  }
  roots.forEach(walkPlacemarks);

  function aggregateFolder(node) {
    if (node.kind !== "folder" || !node.children) {
      return;
    }
    for (const c of node.children) {
      if (c.kind === "folder") {
        aggregateFolder(c);
      }
    }
    /** @type {Set<string>} */
    const acc = new Set();
    for (const c of node.children) {
      if (c.kind === "placemark" && c.geomKinds) {
        c.geomKinds.forEach((k) => acc.add(k));
      } else if (c.kind === "folder" && c.folderGeomKinds) {
        c.folderGeomKinds.forEach((k) => acc.add(k));
      } else if (c.kind === "unsupported") {
        acc.add("unsupported");
      }
    }
    node.folderGeomKinds = [...acc].sort();
  }
  roots.forEach(aggregateFolder);
}

/**
 * Remove placemarks sem geometria (só nome / vazios) e pastas que ficarem vazias.
 * @param {KmlTreeNode[]} roots
 * @returns {KmlTreeNode[]}
 */
export function pruneEmptyKmlNodes(roots) {
  /**
   * @param {KmlTreeNode} node
   * @returns {KmlTreeNode | null}
   */
  function prune(node) {
    if (node.kind === "placemark") {
      const kinds = node.geomKinds || [];
      if (kinds.length === 0) {
        return null;
      }
      if (kinds.length === 1 && kinds[0] === "empty") {
        return null;
      }
      return node;
    }

    if (node.kind === "unsupported") {
      return node;
    }

    if (node.kind !== "folder" || !node.children) {
      return null;
    }

    const nextChildren = [];
    for (const child of node.children) {
      const kept = prune(child);
      if (kept) {
        nextChildren.push(kept);
      }
    }
    if (nextChildren.length === 0) {
      return null;
    }

    node.children = nextChildren;
    /** @type {Set<string>} */
    const acc = new Set();
    for (const c of node.children) {
      if (c.kind === "placemark" && c.geomKinds) {
        c.geomKinds.forEach((k) => acc.add(k));
      } else if (c.kind === "folder" && c.folderGeomKinds) {
        c.folderGeomKinds.forEach((k) => acc.add(k));
      } else if (c.kind === "unsupported") {
        acc.add("unsupported");
      }
    }
    node.folderGeomKinds = [...acc].sort();
    return node;
  }

  return roots.map((r) => prune(r)).filter(Boolean);
}

/**
 * @param {KmlTreeNode[]} roots
 * @returns {{ folders: number, placemarks: number, unsupported: number }}
 */
export function countKmlForestStats(roots) {
  let folders = 0;
  let placemarks = 0;
  let unsupported = 0;
  function walk(n) {
    if (n.kind === "folder") {
      folders += 1;
      n.children?.forEach(walk);
    } else if (n.kind === "placemark") {
      placemarks += 1;
    } else if (n.kind === "unsupported") {
      unsupported += 1;
    }
  }
  roots.forEach(walk);
  return { folders, placemarks, unsupported };
}

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
 * @returns {{ roots: KmlTreeNode[], stats: { folders: number, placemarks: number, unsupported: number }, xmlDoc: Document }}
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
  const roots = [];
  const stats = { folders: 0, placemarks: 0, unsupported: 0 };
  parseFeatureChildren(rootEl, stats, (n) => roots.push(n));

  return { roots, stats, xmlDoc: doc };
}

/**
 * Pastas, placemarks e links na raiz de `kml`/`document`/`folder`.
 * `document` é tratado como contentor (Google Earth costuma pôr Document dentro de Folder).
 * @param {Element} container
 * @param {{ folders: number, placemarks: number, unsupported: number }} stats
 * @param {(n: KmlTreeNode) => void} sink
 */
function parseFeatureChildren(container, stats, sink) {
  for (const child of elementChildren(container)) {
    const tag = localTag(child);
    if (tag === "folder") {
      sink(parseFolder(child, stats));
    } else if (tag === "placemark") {
      sink(parsePlacemark(child, stats));
    } else if (tag === "document") {
      parseFeatureChildren(child, stats, sink);
    } else if (tag === "networklink" || tag === "groundoverlay") {
      stats.unsupported += 1;
      sink({
        id: nextId(),
        kind: "unsupported",
        name: getChildText(child, "name") || tag,
        element: child,
        hint: tag,
      });
    }
  }
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

  parseFeatureChildren(folderEl, stats, (n) => node.children.push(n));

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
