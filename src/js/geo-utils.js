export function fromLatLng(latLng) {
  if (typeof latLng.lat === "function") {
    return { lat: latLng.lat(), lng: latLng.lng() };
  }
  return { lat: Number(latLng.lat), lng: Number(latLng.lng) };
}

export function distanceMeters(pointA, pointB) {
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

export function interpolatePoint(start, end, fraction) {
  return {
    longitude: start.longitude + ((end.longitude - start.longitude) * fraction),
    latitude: start.latitude + ((end.latitude - start.latitude) * fraction),
  };
}
