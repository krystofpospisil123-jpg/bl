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

Hra startuje pěšky vedle auta na náměstí Republiky.

| Klávesa | Pěšky | V autě | Volná kamera |
| --- | --- | --- | --- |
| W A S D | chůze podle směru kamery | plyn, brzda/couvání, zatáčení | pohyb |
| Shift | sprint | | rychleji |
| Mezerník | skok | ruční brzda | nahoru (Q dolů) |
| F | nastoupit (u auta) | vystoupit (do 15 km/h) | |
| R | | postavit auto na kola | |
| P | volná kamera | volná kamera | vrátit se pod kameru (i s autem) |
| myš | rozhlížení (klik zamkne myš, Esc uvolní) | rozhlížení | rozhlížení |
| 1–4 | | | náměstí, zámek, nádraží, výhled |
| T | provoz a chodci zap/vyp | | |
| G | kvalita grafiky (nízká / střední / vysoká) | | |
| N | skutečné / obecné názvy obchodů | | |
| O / M / H | stíny, 2D mapa, nápověda | | |

`public/data/` je v repozitáři, takže `npm run data` stačí pustit jen při aktualizaci dat.

| Příkaz | Co dělá |
| --- | --- |
| `npm run data:osm` | Stáhne OSM přes Overpass API do `data/raw/osm.json` |
| `npm run data:ortho` | Stáhne ortofoto ČÚZK (0,5 m) pro barvy střech a podklad terénu |
| `npm run data:dem` | Stáhne DMR 5G z ČÚZK ImageServeru do `data/raw/dem.tif` a převzorkuje do lokální mřížky |
| `npm run data:build` | Rozřeže vše na dlaždice do `public/data/` |
| `npm run build` | Typecheck + produkční build do `dist/` |
| `npm run build:single` | Jeden samostatný HTML soubor s daty uvnitř (`dist-single/blansko.html`, asi 12 MB): jde otevřít i bez serveru nebo offline |

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
  render/           PBR materiály, atlas fasád, obloha, post-processing a kvalita, vzdálený terén
  world/landmarks.ts  korekce známých budov (zámek, kostely, vodárna) a styly podle účelu
  config.ts         nastavení hráče (kvalita, názvy obchodů), uložené v prohlížeči
  controls/         vstup, létající kamera, kamera za autem
  physics/          svět Rapier: kolize terénu, budov a mostů streamované kolem hráče
  vehicle/          fyzika auta (raycast vehicle), procedurální model auta
  traffic/          graf silnic, AI auta (provoz) a chodci
  character/        postava: kinematický character controller, model s animací chůze
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
| Mapillary (autoři wegavision, jakuje, pivnik, tkk, stensoft) | CC BY-SA 4.0 | jen vizuální předloha (snímky ve hře nejsou) |
| ČÚZK – Ortofoto | CC BY 4.0 | barvy střech, rozmazaný podklad terénu (2,5 m) |

Atribuce se zobrazuje ve hře vpravo dole. Vygenerovaná data v `public/data/` jsou odvozená
databáze z OSM, a proto také spadají pod ODbL.

Žádné externí modely, textury ani zvuky se zatím nepoužívají. Vše bude procedurální,
případný externí asset se uvede sem i s licencí.

## Plán

1. ✅ Setup a data
2. ✅ Svět: 3D terén, budovy, silnice, voda, stromy, streaming dlaždic, létající kamera
3. ✅ Auto: Rapier raycast vehicle, kamera za autem, kolize s budovami
4. ✅ Postava: chůze, sprint, skok, nástup a výstup z auta
5. ✅ Provoz a chodci: AI auta na grafu silnic z OSM, chodci na chodnících
   ✅ Grafika a známá místa: PBR, obloha s mraky, atlas fasád, střechy z OSM, cedule obchodů
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

## Postava

- **Fyzika:** kinematický character controller z Rapieru s kapslí 1,7 m. Vyjde na obrubník do
  45 cm a svah do 50°, drží se země a na strmějších svazích klouže. Auto odstrčí jen lehce.
- **Pohyb:** běh 4,6 m/s, sprint 7,2 m/s, skok. Postava se natáčí do směru pohybu, kamera se
  ovládá myší.
- **Auto:** nastupuje se do 3,6 m od auta. Vystupuje se levými dveřmi, když je tam zeď, tak vpravo,
  jinak na střechu.
- **Test:** `npx tsx scripts/dev/char-sim.ts` (chůze, obrubník, skok, odstrčení auta).

## Provoz a chodci

- **Graf silnic:** generuje se z OSM (`public/data/roads.json`), rozdělený v křižovatkách. Silnice
  pro auta mají asi 68 km a respektují jednosměrky, cesty pro chodce asi 103 km. Malé izolované
  kousky sítě se zahazují.
- **Auta:** až 26 aut v okruhu asi 350 m. Jezdí vpravo podle limitů z OSM a před zatáčkou zpomalí.
  Drží odstup od aut, chodců i hráče a v křižovatce si ji „zarezervují“, takže nevjedou do
  sebe. Když stojí za překážkou 8 s, otočí se. Ve fyzice jsou kinematické kvádry, takže do nich
  hráč může narazit. Na obrazovce jsou to 2 instancované meshe.
- **Chodci:** až 60 chodců chodí po chodnících vedle ulic a po pěšinách. Před rychlým autem uskočí,
  a když je auto srazí, upadnou a po chvíli vstanou. Vykreslují se 6 instancovanými meshi.

## Grafika a známá místa

- **Osvětlení:** fyzikální materiály (PBR), atmosférická obloha s mraky (Preetham, doplněk three.js)
  a z ní spočítaná environment mapa, takže okna, auta a voda odrážejí nebe.
- **Post-processing:**
  - vysoká kvalita: ambient occlusion (GTAO), bloom, SMAA, stínová mapa 4096
  - střední: bloom, SMAA, stíny 2048
  - nízká: bez efektů a stínů
  - Volba se mění klávesou G a pamatuje se v prohlížeči. Když hra po načtení běží pod 32 fps,
    kvalita se sama sníží o stupeň.
- **Fasády:** procedurální atlas s 8 styly (omítka, panelák, staré město, průmysl, sklo,
  supermarket, kostel/zámek, garáž) a zvláštním přízemím (výlohy u obchodů a restaurací). Styl se
  volí podle typu budovy, počtu podlaží, polohy (staré město kolem náměstí) a účelu z OSM.
- **Střechy:** podle `roof:shape` z OSM. Sedlové, valbové a jehlanové se dělají přesně, složité
  půdorysy dostanou přibližnou mansardu. Barvy se berou z `building:colour` a `roof:colour`.
- **Známá místa** (`src/world/landmarks.ts`):
  - zámek: výška, okrová fasáda, valbová střecha
  - kostel sv. Martina a dřevěný kostel sv. Paraskivy: věž
  - stará vodárenská věž
  - radnice, soud, nádraží a supermarkety: styl podle účelu
  - Výšky a věže jsou přibližné, protože OSM je nemá.
- **Cedule:** obchody, restaurace, banky, lékárny, pumpy a památky mají cedulku s názvem z OSM na
  stěně směrem k ulici. Je to jen neutrální text, bez log a firemních barev. Klávesa N přepne na
  obecné názvy („Supermarket“, „Lékárna“…). Pro případné vydání hry doporučuji obecné názvy,
  protože názvy obchodů jsou ochranné známky.
- **Detaily:** jemná textura terénu zblízka, koruny stromů z více shluků s pohybem ve větru,
  animovaná vodní hladina a pouliční lampy podél ulic (instancované).

## Plynulost

- **Textury povrchu** se kreslí ve Web Workeru (OffscreenCanvas) a na GPU se nahrává nejvýš
  jedna za snímek.
- **Shadery** se před startem předkompilují pro všechny druhy objektů („Připravuji grafiku…“),
  takže se hra nezasekne, když poprvé uvidíš vodu, cedule nebo provoz.
- **Změna kvality** překompiluje materiály jen při zapnutí nebo vypnutí stínů.
- **Kolize** se stavějí nejvýš pro 2 dlaždice za snímek.

## Mobil a tablet

- **Ovládání:** na dotykových zařízeních se zobrazí joystick vlevo (objeví se tam, kam položíš
  palec). Rozhlížíš se tažením prstu kdekoli jinde na obrazovce, obojí jde současně.
- **Tlačítka vpravo** se mění podle situace:
  - pěšky: Skok, Sprint, Nastoupit
  - v autě: Ruční brzda, Vystoupit, Na kola
  - ve volné kameře: Nahoru, Dolů, Sem
- **Menu** vpravo nahoře: kvalita grafiky, volná kamera, provoz, názvy obchodů, 2D mapa.
- **Výkon:** telefony začínají na nízké kvalitě. Dohled je 1 km, textury povrchu jsou menší
  a ve městě je nejvýš 12 aut a 24 chodců.

## Realističtější vzhled a stabilita (z listopadu 2026)

- **Střechy** mají barvu změřenou na ortofotu ČÚZK. Bere se střední jas uvnitř půdorysu
  a přiřadí se nejbližší skutečná krytina (pálená taška, břidlice, beton, plech…), takže stíny
  a opar barvu nezkreslí.
- **Terén** má pod povrchem rozmazané ortofoto (2,5 m/px), takže louky, pole a lesy mají skutečné
  barvy. Silnice, chodníky a voda se kreslí přes něj.
- **Fasády:** atlas 256 px na pole a tři řady:
  - patro, přízemí a přízemí se vchodem
  - hloubka oken, parapety, sokl, balkony paneláků
  - každé okno má jiný odstín (záclony, tma, odlesk) a stěna je u země zašpiněná
- **Stabilita:**
  - Graf silnic se už nezasekne na konci jednosměrky. Dřív to po chvíli vyhodilo chybu
    a hra zamrzla.
  - Chyba v provozu ani v chodcích už nezastaví celou hru.
  - Zastaralé úlohy kreslení textur se ruší. Dřív držely v paměti staré dlaždice, takže
    paměť rostla zhruba o 0,6 MB/s.
  - Neúspěšné načtení dlaždice se zkouší znovu po 5 s.

## Náměstí Republiky a městské detaily

- **Náměstí Republiky** (u startu) je postavené podle fotografií z ulice dodaných hráčem (sloužily
  jen jako vzor). Je to dlouhá dlážděná plocha mezi dvěma pruhy parkovišť, která vede od ulice se zebrou
  a sloupky (jihozápad) rovně ke žluté budově s pilastry (budova Komerční banky, OSM 253861544).
  Osa je asi o 28° natočená vůči mřížce mapy a byla odvozená z hráčova screenshotu se šipkami. Na ploše jsou dvě pole fontán
  ze země, dvě řady kvetoucích pyramid, lavičky a stromořadí. Ortofoto i OSM jsou starší než
  přestavba náměstí, proto jsou tam pořád parkoviště a auta se na ploše náměstí negenerují.
  Sousední park se čtyřmi kruhovými záhony a stromy zůstal (`src/world/scenes.ts`).
- **Zámek Blansko** podle fotografií:
  - bílá fasáda s okrovými šambránami a červená střecha
  - hodinová věž s ciferníky
  - renesanční štít
  - okrouhlá kamenná bašta
  - kamenný portál brány
  - Prvky jsou umístěné podle obrysu z OSM (`src/world/builders/landmarkExtras.ts`).
- **Rámy oken, parapety a dveře** zůstávají bílé a nepřebírají barvu fasády (maska obarvení
  v modrém kanálu atlasu drsnosti).
- **Po celém městě:**
  - plná parkoviště zaparkovaných aut s kolizemi
  - lavičky a koše u pěších ploch a keře u bytových domů
  - červené lampy se zahnutým ramenem
  - dlažba v shaderu na chodnících, náměstích a parkovištích
  - stromy rozpoznané na ortofotu tam, kde je OSM nemá
- **Fasáda „sorela“** (bytové domy z 50. let): žluté, okrové a béžové omítky, bílá okna, balkony
  nad sebou ve stejných osách a tmavý sokl.
- **Vzdálenost:** drobnosti se kreslí jen nablízku (do 260 m, na mobilu 200 m), lampy a cedule
  do střední vzdálenosti.
- **Data z OSM:** dotaz už obsahuje lavičky, fontány, sloupky a lampy. Projeví se při příštím
  stažení dat, až bude Overpass dostupný.
- **Ladění:** `npx tsx scripts/dev/ortho-crop.ts x0 z0 x1 z1 out.jpg` vyřízne ortofoto
  s mřížkou pro umisťování scén.

## Podle snímků z Mapillary

Zhruba 45 snímků z ulic Blanska (2021–2023, Mapillary, CC BY-SA 4.0) posloužilo jen jako
vizuální předloha. Do hry ani do repozitáře se nedostaly. Podle nich vzniklo:

- **Zebry** všude, kde pěší cesta z OSM kříží ulici.
- **Opotřebený asfalt:** záplaty a praskliny v shaderu terénu.
- **Stromořadí** podél hlavních a obytných ulic (`STREET_TREE_ROADS` v build-chunks).
- **Lampy:** červené se zahnutým ramenem v centru, moderní šedé LED na okrajích a v průmyslu.
- **Mosty** s modrým ocelovým zábradlím.
- **Kočičí hlavy a dlažba** u silnic se `surface=sett/cobblestone/paving_stones`.
- **Barvy domů:** pastelové barvy opravených domů (mátová, růžová, oranžová).

Token k Mapillary API je uložený jen v nastavení prostředí (síťové tajemství), ne v kódu.
