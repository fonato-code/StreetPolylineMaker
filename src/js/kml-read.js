/**
 * Lê o texto KML de um arquivo local (.kml ou .kmz).
 * KMZ usa JSZip carregado por script em kml-explorer.html (`src/vendor/jszip.min.js`).
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function fileToKmlString(file) {
  if (isKmzFile(file)) {
    const JSZip = getJSZipConstructor();
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const kmlName = await pickKmlEntryNameAsync(zip);
    if (!kmlName) {
      throw new Error("KMZ sem arquivo .kml interno");
    }
    const entry = zip.files[kmlName];
    if (!entry || entry.dir) {
      throw new Error("Entrada KML invalida dentro do KMZ");
    }
    return entry.async("string");
  }

  if (isKmlFile(file)) {
    return readFileAsText(file);
  }

  throw new Error("Use arquivo .kml ou .kmz");
}

/** @param {File} file */
function isKmlFile(file) {
  const name = (file.name || "").toLowerCase();
  const t = (file.type || "").toLowerCase();
  return name.endsWith(".kml")
    || t === "application/vnd.google-earth.kml+xml"
    || t === "application/xml"
    || t === "text/xml";
}

/** @param {File} file */
function isKmzFile(file) {
  const name = (file.name || "").toLowerCase();
  const t = (file.type || "").toLowerCase();
  return name.endsWith(".kmz")
    || t === "application/vnd.google-earth.kmz"
    || t === "application/zip"
    || t === "application/x-zip-compressed";
}

function getJSZipConstructor() {
  const w = typeof window !== "undefined" ? window : undefined;
  const Zip = w && w.JSZip;
  if (typeof Zip === "function") {
    return Zip;
  }
  throw new Error(
    "JSZip nao esta disponivel. Confirme que kml-explorer.html inclui o script src/vendor/jszip.min.js antes do modulo e use http://localhost (nao file://).",
  );
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("falha ao ler arquivo"));
    reader.readAsText(file, "UTF-8");
  });
}

function zipNormPath(n) {
  return String(n).replace(/\\/g, "/").replace(/^\//, "");
}

function zipBasename(n) {
  const s = zipNormPath(n);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Conta tags KML típicas de conteúdo (texto bruto, case-insensitive).
 * @param {string} text
 */
function scoreKmlFeatureHints(text) {
  const re = /<(?:placemark|folder|networklink|document)[\s>/]/gi;
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Escolhe o .kml mais útil dentro do KMZ: vários .kml → maior "score" de features; empate → maior tamanho.
 * Um único .kml devolve logo esse caminho (sem ler o zip outra vez).
 * @param {*} zip instância JSZip após loadAsync
 * @returns {Promise<string|null>}
 */
async function pickKmlEntryNameAsync(zip) {
  const files = zip.files;
  const names = Object.keys(files).filter((n) => !files[n].dir);
  const kmlPaths = names.filter((n) => /\.kml$/i.test(zipNormPath(n)));
  if (kmlPaths.length === 0) {
    return null;
  }
  if (kmlPaths.length === 1) {
    return kmlPaths[0];
  }

  /** @type {{ path: string, score: number, len: number }[]} */
  const scored = [];
  for (const path of kmlPaths) {
    const entry = files[path];
    if (!entry || entry.dir) {
      continue;
    }
    const text = await entry.async("string");
    scored.push({
      path,
      score: scoreKmlFeatureHints(text),
      len: text.length,
    });
  }
  if (scored.length === 0) {
    return null;
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.len - a.len;
  });
  if (scored[0].score > 0) {
    return scored[0].path;
  }

  const doc = kmlPaths.find((n) => /^doc\.kml$/i.test(zipBasename(n)));
  if (doc) {
    return doc;
  }
  kmlPaths.sort((a, b) => zipNormPath(a).length - zipNormPath(b).length);
  return kmlPaths[0];
}
