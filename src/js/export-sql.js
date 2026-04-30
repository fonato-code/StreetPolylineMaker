export function sqlValue(value) {
  if (value === null || value === undefined || value === "") {
    return "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildSql(points) {
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
    const values = columns.map(([key]) => sqlValue(point[key])).join(", ");
    const kmRealSuffix = point.kmReal != null ? ` /* KM real: ${point.kmReal} */` : "";
    return `/* LINHA ${index + 1} */ INSERT INTO GEOPOSICAO(${names}) VALUES (${values});${kmRealSuffix}`;
  }).join("\n");
}

export function cloneExportPoint(point, id, km, radius, kmReal = null) {
  const row = {
    id,
    longitude: Number(point.longitude),
    latitude: Number(point.latitude),
    km: Number(km).toFixed(3),
    rodovia: point.rodovia || "",
    raio: radius,
    sentido: point.sentido || "N",
    nome: point.nome || "",
  };
  if (kmReal != null) {
    row.kmReal = kmReal;
  }
  return row;
}
