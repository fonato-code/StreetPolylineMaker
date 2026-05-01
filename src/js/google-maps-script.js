/**
 * Carrega o script da API JavaScript do Google Maps (uma vez por página).
 * @param {string} apiKey
 * @returns {Promise<typeof google>}
 */
export function loadGoogleMapsApi(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google);
      return;
    }

    const callbackName = `initGoogleMaps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google);
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
