# Blansko: Open World (pracovní název)

Prohlížečová open-world hra odehrávající se ve skutečném Blansku. Svět se generuje
z veřejných dat (OpenStreetMap + ČÚZK), nic se nemodeluje ručně.

Stack: TypeScript, Vite, three.js, Rapier (`@dimforge/rapier3d-compat`). Bez backendu, výstup je statický web.

## Rychlý start

Potřebuješ Node.js 22 nebo novější.

```bash
npm install
npm run data      # stáhne OSM + DMR 5G a vygeneruje dlaždice do public/data (~1 min)
npm run dev       # http://localhost:5173
```

`public/data/` je v repozitáři, takže `npm run data` stačí pustit jen při aktualizaci dat.

| Příkaz | Co dělá |
| --- | --- |
| `npm run data:osm` | Stáhne OSM přes Overpass API do `data/raw/osm.json` |
| `npm run data:dem` | Stáhne DMR 5G z ČÚZK ImageServeru do `data/raw/dem.tif` a převzorkuje do lokální mřížky |
| `npm run data:build` | Rozřeže vše na dlaždice do `public/data/` |
| `npm run build` | Typecheck + produkční build do `dist/` |

### Když API nefunguje (ruční stažení)

- **OSM:** `npm run data:osm -- --print-query` vypíše dotaz. Vlož ho na <https://overpass-turbo.eu>,
  spusť a dej Export, „raw OSM data“ (JSON). Ulož ho jako `data/raw/osm.json`.
- **DMR 5G:** stáhni GeoTIFF v S-JTSK (EPSG:5514) pro oblast Blanska z <https://ags.cuzk.gov.cz>
  (služba `dmr5g/ImageServer`, Export Image) nebo z Geoportálu ČÚZK a ulož ho jako `data/raw/dem.tif`.
  Pak spusť `npm run data:dem -- --skip-download`.

## Struktura

```
scripts/            zpracování dat (Node.js + tsx)
  lib/config.ts     výřez, střed, projekce (lokální TM <-> WGS84 <-> S-JTSK), velikost dlaždic
  lib/geom.ts       ořez polygonů, skládání multipolygonů, point-in-polygon
  fetch-osm.ts      stažení OSM
  fetch-dem.ts      stažení a převzorkování DMR 5G
  build-chunks.ts   klasifikace prvků, odhad výšek budov, generování stromů, dlaždice
data/raw/           surová stažená data (není v gitu)
public/data/        vygenerovaný svět (manifest + dlaždice)
src/
  world/format.ts   formát dat sdílený skripty i hrou
  world/WorldData.ts načítání manifestu a dlaždic
  preview/          2D inspektor dat (fáze 1)
  ui/               HUD, atribuce
```

## Formát světa

- **Souřadnice:** metry, X = východ, Y = nahoru, Z = jih. Počátek je na 49.3628 N, 16.6448 E
  (mezi náměstím, zámkem a nádražím). Hratelná oblast je 3 × 3 km (−1500 až 1500 m).
- **Dlaždice:** 12 × 12 dlaždic po 250 m. Každá má `chunks/c_X_Z.json` (budovy, silnice, koleje,
  vodní toky a plochy, landuse, stromy, POI) a `chunks/c_X_Z.bin` s výškami: Uint16, 126 × 126
  vzorků po 2 m se sdílenými okraji, výška = `heightBase + v * 0.01`.
- **`overview.bin`:** hrubá výšková mapa celé oblasti (20 m), pro vzdálený terén a LOD.
- **Výšky budov:** `height` nebo `building:levels` z OSM (`tagged: true`). Jinak odhad podle typu
  a půdorysné plochy. Základ budovy leží na nejnižším bodě terénu pod půdorysem.
- **Stromy:** jednotlivé stromy z OSM a procedurálně rozmístěné stromy v lesích, parcích a sadech
  (deterministicky, mimo silnice, budovy a vodu).

## Data a licence

| Zdroj | Licence | Použití |
| --- | --- | --- |
| © přispěvatelé OpenStreetMap | ODbL 1.0 | budovy, silnice, voda, plochy, koleje, POI |
| ČÚZK – DMR 5G | CC BY 4.0 | výškový model terénu |

Atribuce se zobrazuje ve hře vpravo dole. Vygenerovaná data v `public/data/` jsou odvozená
databáze z OSM, a proto také spadají pod ODbL.

Žádné externí modely, textury ani zvuky se zatím nepoužívají. Vše bude procedurální,
případný externí asset se uvede sem i s licencí.

## Plán

1. ✅ Setup a data
2. Svět: 3D terén, budovy, silnice, voda, stromy, streaming dlaždic, létající kamera
3. Auto (Rapier raycast vehicle)
4. Postava, nástup a výstup z auta
5. Provoz a chodci
6. Den a noc, minimapa, mise, policie
