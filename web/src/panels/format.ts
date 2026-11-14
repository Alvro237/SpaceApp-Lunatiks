/** Text formatting and input parsing shared by the panels. */

export const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}`
export const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`

/** Manual coordinates. Latitude −90..90, longitude −180..180 (0..360 accepted and normalised, as the API). */
export function parseCoordinates(latText: string, lonText: string): { lat: number; lon: number } | { error: string } {
  const lat = Number(latText.replace(',', '.'))
  let lon = Number(lonText.replace(',', '.'))
  if (latText.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) return { error: 'Latitude must be a number from −90 to 90 (south is negative).' }
  if (lonText.trim() === '' || !Number.isFinite(lon) || lon < -180 || lon > 360) return { error: 'Longitude must be a number from −180 to 180 (or 0 to 360).' }
  if (lon > 180) lon -= 360
  return { lat, lon }
}
