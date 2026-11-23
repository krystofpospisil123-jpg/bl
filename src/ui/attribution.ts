// Visible data attribution (required by the OSM ODbL and ČÚZK CC BY 4.0 licences).
export function renderAttribution(el: HTMLElement, lines: string[]): void {
  el.innerHTML = '';
  lines.forEach((line, i) => {
    if (i) el.append(' · ');
    const osm = line.includes('OpenStreetMap');
    const a = document.createElement('a');
    a.href = osm ? 'https://www.openstreetmap.org/copyright' : 'https://geoportal.cuzk.gov.cz';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = osm ? '© přispěvatelé OpenStreetMap' : line.replace(/\s*\(.*\)$/, '');
    el.append(a);
  });
}
