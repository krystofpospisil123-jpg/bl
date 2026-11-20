// Named places for the free camera (keys 1–4).
/** Named viewpoints for the free camera (world x, z, height above terrain, look-at x, z). */
export const VIEWPOINTS: { name: string; key: string; pos: [number, number, number]; look: [number, number] }[] = [
  { name: 'Náměstí Republiky', key: 'Digit1', pos: [70, 330, 40], look: [-70, 150] },
  { name: 'Zámek', key: 'Digit2', pos: [200, 40, 45], look: [50, -60] },
  { name: 'Nádraží', key: 'Digit3', pos: [360, 960, 45], look: [170, 1140] },
  { name: 'Nad městem', key: 'Digit4', pos: [800, -1150, 380], look: [0, 200] },
];
