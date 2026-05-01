/**
 * Lê o texto KML de um arquivo local (.kml ou .kmz).
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function fileToKmlString(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".kmz")) {
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const kmlName = pickKmlEntryName(zip.files);
    if (!kmlName) {
      throw new Error("KMZ sem arquivo .kml interno");
    }
    const entry = zip.files[kmlName];
    return entry.async("string");
  }

  if (name.endsWith(".kml")) {
    return readFileAsText(file);
  }

  throw new Error("Use arquivo .kml ou .kmz");
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("falha ao ler arquivo"));
    reader.readAsText(file, "UTF-8");
  });
}

/** @param {Record<string, { dir?: boolean }>} files */
function pickKmlEntryName(files) {
  const names = Object.keys(files).filter((n) => !files[n].dir);
  const doc = names.find((n) => /^doc\.kml$/i.test(n.replace(/^.*\//, "")));
  if (doc) {
    return doc;
  }
  const any = names.find((n) => /\.kml$/i.test(n));
  return any || null;
}
