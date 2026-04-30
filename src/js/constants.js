export const STORAGE_KEYS = {
  apiKey: "streetPolylineMaker.apiKey",
  draft: "streetPolylineMaker.draft",
};

export const DRAFT_VERSION = 2;

export function generateRouteId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `route_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
