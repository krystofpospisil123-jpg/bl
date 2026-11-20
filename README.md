# Blansko: Open World (pracovní název)

Prohlížečová open-world hra odehrávající se ve skutečném Blansku. Svět se generuje
z veřejných dat (OpenStreetMap + ČÚZK), nic se nemodeluje ručně.

Stack: TypeScript, Vite, three.js, Rapier (`@dimforge/rapier3d-compat`). Bez backendu, výstup je statický web.

## Rychlý start

Potřebuješ Node.js 22 nebo novější.

```bash
npm install
npm run data      # stáhne OSM + DMR 5G a vygeneruje dlaždice do public/data (~1 min)
npm run dev       # http://localhost:5173  (2D mapa dat: http://localhost:5173/#mapa)
```

### Ovládání

Hra startuje v autě na náměstí Republiky.

| Klávesa | V autě | Volná kamera |
| --- | --- | --- |
| W / S | plyn / brzda, při stání couvání | pohyb vpřed / vzad |
| A / D | zatáčení | pohyb do stran |
| Mezerník | ruční brzda | nahoru (Q dolů) |
| R | postavit auto na kola | |
| P | přepnout na volnou kameru | položit auto pod kameru a jet |
| myš | rozhlížení (klik zamkne myš, Esc uvolní) | rozhlížení |
| Shift / kolečko | | rychleji / základní rychlost |
| 1–4 | | náměstí, zámek, nádraží, pohled nad městem |
| O / M / H | stíny, 2D mapa, nápověda | stejné |

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
  world/HeightField.ts  dotazy na výšku terénu napříč dlaždicemi
  world/ChunkManager.ts streaming dlaždic a LOD podle vzdálenosti
  world/builders/   terén, textura povrchu, budovy, stromy, voda a mosty
  render/           materiály, procedurální textury, nebe, slunce, vzdálený terén
  controls/         vstup, létající kamera, kamera za autem
  physics/          svět Rapier: kolize terénu, budov a mostů streamované kolem hráče
  vehicle/          fyzika auta (raycast vehicle), procedurální model auta
  game/Game.ts      herní smyčka
  preview/          2D inspektor dat (#mapa)
  ui/               HUD, atribuce
```

## Formát světa

- **Souřadnice:** metry, X = východ, Y = nahoru, Z = jih. Počátek je na 49.3628 N, 16.6448 E
  (u zámku, náměstí je asi 200 m jižně a nádraží 1,1 km jižně). Hratelná oblast je 3 × 3 km (−1500 až 1500 m).
- **Dlaždice:** 12 × 12 dlaždic po 250 m. Každá má `chunks/c_X_Z.json` (budovy, silnice, koleje,
  vodní toky a plochy, landuse, stromy, POI) a `chunks/c_X_Z.png` s výškami: 126 × 126
  vzorků po 2 m se sdílenými okraji, bezeztrátové PNG s 16bitovou hodnotou v kanálech R (vyšší bajt)
  a G (nižší bajt), výška = `heightBase + v * 0.01`.
- **`overview.png`:** hrubá výšková mapa celé oblasti (20 m), pro vzdálený terén a LOD.
- **Výšky budov:** `height` nebo `building:levels` z OSM (`tagged: true`). Jinak odhad podle typu
  a půdorysné plochy. Základ budovy leží na nejnižším bodě terénu pod půdorysem.
- **Silnice a vodní toky** jsou v každé dlaždici, které se dotýkají, takže se na okrajích neusekávají.
  Mosty mají výšku mostovky (`elev`) interpolovanou mezi konci mostu.
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
2. ✅ Svět: 3D terén, budovy, silnice, voda, stromy, streaming dlaždic, létající kamera
3. ✅ Auto: Rapier raycast vehicle, kamera za autem, kolize s budovami
4. Postava, nástup a výstup z auta
5. Provoz a chodci
6. Den a noc, minimapa, mise, policie

## Jak funguje 3D svět

- **Terén:** síť z výškové mapy v rozlišení 2 m (do 260 m od kamery), dál 10 m. Švy mezi
  úrovněmi detailu zakrývají svislé „sukně“ na okrajích dlaždic. Mimo načtené dlaždice je vidět
  hrubý terén celé oblasti (20 m).
- **Povrch:** silnice (včetně čar), chodníky, koleje, voda a využití území se kreslí do textury
  každé dlaždice (1024 px nablízku, 256 a 128 px dál). Silnice proto vždy přesně leží na terénu.
- **Budovy:** extrudované půdorysy sloučené do jedné geometrie na dlaždici. Malé obdélníkové domy
  mají sedlovou střechu, okna dělá procedurální textura fasády.
- **Stromy:** instancované low-poly modely, 2 úrovně detailu.
- **Výkon:** asi 300 draw calls a 0,4–0,9 M trojúhelníků. Stavění dlaždic má rozpočet 6 ms na snímek.

## Fyzika a auto

- **Kolize:** v okruhu 260 m kolem hráče jsou výškové mapy dlaždic (heightfield, 2 m) a
  trojúhelníkové sítě budov a mostů. Po mostech se dá jezdit. Okraj oblasti hlídají neviditelné zdi.
  Stromy zatím kolizi nemají.
- **Auto:** `DynamicRayCastVehicleController` z Rapieru, pohon zadních kol, 1250 kg, těžiště nízko.
  Arkádové úpravy: řízení se s rychlostí zmenšuje, přítlak roste s rychlostí, brzdy jsou
  posunuté dopředu kvůli stabilitě. Max. asi 150 km/h, 0–100 km/h asi za 7 s.
- **Fyzika** běží s pevným krokem 1/60 s.
- **Ladění:** `npx tsx scripts/dev/car-sim.ts` simuluje jízdu po rovině (zrychlení, zatáčky,
  brzdění, náraz do zdi) bez prohlížeče.
