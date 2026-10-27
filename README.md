# Iron Curtain — Cold War RTS

A browser real-time strategy game inspired by *Command & Conquer: Red Alert 2*, set in the Cold War. NATO and the Warsaw Pact fight it out on isometric battlefields. You can play solo against the computer or online with friends.

**Look and feel**

- **Pixel art.** The world is drawn at low resolution, mapped to a dark, desaturated palette with ordered dithering, and scaled up with hard pixel edges.
- **Faction designs.**
  - NATO uses clean prefab buildings, quonset huts, hangars, radomes, sandbags, woodland camo, and angular wedge-turret tanks.
  - The Warsaw Pact uses brutalist stained concrete, brick, rust, red stars, smokestacks, lattice radar, dome-turret tanks with rear fuel drums, and boat-hulled scout cars.
- **80s computer terminal UI** with a VT323 phosphor font, CRT scanlines, and `[ BRACKET ]` buttons. NATO plays on a green phosphor screen and the Warsaw Pact on amber.

All graphics and sounds are generated in code. The game uses no copyrighted assets.

## Features

- **Two blocs, 16 nations.** Each nation has its own special unit, including Cold War proxy-war states:

  | NATO and Western allies | Special unit | Warsaw Pact and Eastern allies | Special unit |
  |---|---|---|---|
  | United States | M1 Abrams heavy tank | Soviet Union | Object 279 super-heavy tank (self-repairs) |
  | United Kingdom | SAS Commando (sniper, C4 vs buildings) | East Germany | Stasi Agent (cloaked spy) |
  | West Germany | Leopard 2 tank hunter | Poland | OT-64 SKOT amphibious APC |
  | France | Pluton missile launcher | Cuba | Guerrilla Sapper (suicide bomber) |
  | South Korea | ROK Marine (elite, digs in) | North Korea | KPA Squad (3 soldiers per purchase) |
  | Israel | Merkava heavy tank | North Vietnam | Viet Cong (moves through jungle, hidden in trees) |
  | South Africa | G6 Rhino long-range wheeled howitzer | Egypt | ZSU-23-4 Shilka quad autocannon |
  | Afghan Mujahideen | Mujahideen (crosses mountains, hidden in rocks, RPGs) | Iraq | Scud launcher (huge range, inaccurate) |

- **20 historical theaters across 4 biomes**, plus procedural random maps. Every map is mirrored so all start positions are equally fair.

  | Temperate | Arctic | Desert | Jungle |
  |---|---|---|---|
  | Fulda Gap 1985 (2P) | Kola Peninsula 1983 (2P) | Suez Canal 1973 (2P) | Ia Drang Valley 1965 (2P) |
  | Berlin 1961 (2P) | Chosin Reservoir 1950 (2P) | Golan Heights 1973 (2P) | Mekong Delta 1968 (4P) |
  | Budapest 1956 (2P) | Finnmark 1984 (4P) | Panjshir Valley 1984 (2P) | Cuito Cuanavale 1987 (2P) |
  | Prague Spring 1968 (4P) | Keflavik 1973 (2P) | Ogaden 1977 (4P) | Khe Sanh 1968 (2P) |
  | Danish Straits 1983 (2P, islands) | Kuril Islands 1978 (4P, archipelago) | Shatt al-Arab 1980 (2P, delta) | Quemoy Strait 1958 (2P, sea crossing) |

  Terrain includes island maps linked by long bridges (blow the bridges to cut off an island), river deltas, rivers and canals with bridges, frozen lakes you can drive across, ruined city blocks, mountain ridges, and dense jungle. Each biome has its own ground, trees, and rocks.

- **Asymmetric factions, as in RA2:**

  | | NATO: quality | Warsaw Pact: quantity and armor |
  |---|---|---|
  | Basic infantry | Rifleman $200. **Deploys (D)** into sandbags: heavy fire, longer range, 40% less damage taken | Conscript $100. Weaker, but trains 25% faster |
  | AT infantry | Dragon team $400. Deploys for longer range and more damage | RPG trooper $250. Cheaper and weaker |
  | Main tank | M60 $700: fast, lighter armor | T-72 $900: tough, hard-hitting, slow |
  | Ore truck | Fast and light, unarmed | War Miner: armored, carries more, **machine gun**, slow |
  | Power | $800 for +120 | $600 for +80, sturdier |
  | Defenses | Standard; TOW launcher sees farther | Cheaper, tougher bunkers and AT guns |

- **RA2-style base building.** Deploy your MCV and build power, refineries, barracks, war factories, radar, research labs, defenses, and a nuclear missile silo. The build menu works like RA2's sidebar.
- **Economy.** Ore trucks harvest ore fields. Engineers can capture neutral oil derricks for extra income.
- **Power grid.** When power runs low, production slows, the radar goes offline, and powered defenses stop firing.
- **Garrisonable civilian buildings (RA2 style).** Towns and cities have houses (4 occupants), apartment blocks (6) and office blocks (8).
  - **Who can garrison:** basic infantry — riflemen, conscripts, AT/RPG teams, ROK Marines, KPA, Viet Cong and Mujahideen. Right-click a neutral building or one of your own to move in.
  - **Firing:** occupants shoot from the windows with +1.5 range and a faster rate of fire, and the building flies your flag.
  - **Protection:** occupants are safe until the building is destroyed, then they spill out alive. Select the building and press **D** (or right-click it) to evacuate.
  - **Counters:** snipers (SAS) and demolition charges kill the occupants directly, artillery and missiles wear them down, and tanks level the building.
- **Aircraft and anti-air (RA2 style).** Build an **Air Base / Airfield** (needs radar) to unlock the AIR tab.
  - **Jets** (NATO A-10 Thunderbolt, Pact Su-25 Frogfoot) carry limited ammo (shown as pips under the health bar). They fly strafing passes, return to their landing pad when empty, and rearm there. Each air base has 4 pads, and you can only own 4 jets per base. Right-click your air base with jets selected to send them home.
  - **Helicopters** (AH-1 Cobra, Mi-24 Hind) hover anywhere, ignore terrain, and never need to rearm.
  - **Anti-air:** only AA weapons can hit aircraft at full effect. Use Stinger/Strela-2 teams (both factions), the M163 Vulcan or 9K31 Strela-1 vehicles, the Hawk/SA-2 SAM Site (long range, needs power) and Egypt's ZSU-23-4. Machine guns do light damage to helicopters, but hardly scratch fast jets.
- **Terrain elevation (RA2 style).** Maps have raised plateaus with cliff edges, reached by ramps, plus rolling hills. Cliffs block ground units (not aircraft). You can only build on flat ground, and a building can't straddle two levels. Bases, towns, rivers and derricks stay flat, and every plateau is mirrored for each player so maps stay fair.
- **Build off allies and tech buildings (RA2 style).** You can place buildings within range of your own base, any ally's base, and tech buildings you've captured (oil derricks, the airport).
- **Tech airport and paradrops (RA2 style).** Each map has a neutral **Airport** midway between the bases (on maps with water in the middle, a mirrored pair). Capture it with an engineer, and a **PARADROP** button appears under the sidebar. It charges for 3 minutes; then click it and click anywhere on the map. A transport plane flies over and drops your faction's infantry: 6 NATO riflemen or 9 Pact conscripts. Troopers can't be shot while falling. Enemies can recapture the airport with their own engineer, and it doesn't count as a base building for victory. The computer opponent goes after it too.
- **Destructible bridges (RA2 style).** Hold **Ctrl** and right-click a bridge to have selected units shell it. Tanks, artillery, rockets, aircraft and demolitions can damage it; small arms can't. Units on a bridge when it collapses are lost. Each bridge has a small **repair hut** on its banks. Send an engineer into either hut to rebuild the bridge. The huts can't be destroyed.
- **RA2-style shroud** and a radar minimap. Once you uncover an area it stays open, and you can see everything in it, enemy units included. Stealth units still need one of your units close by to be spotted.
- **Online multiplayer** for 2–4 players: free-for-all or teams, with optional computer players. You can rejoin if you disconnect.
- **Computer opponent** with easy, normal, and hard difficulty.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:8080. Skirmish games run entirely in your browser. Online games run on the server.

To play with a friend on your local network, have them open `http://<your-ip>:8080`. Click **Host Online Game**, share the 4-letter room code (or the `?room=CODE` link), and your friend clicks **Join**.

## Deploy to GitHub Pages

GitHub Pages only hosts static files. Skirmish vs. the computer works there on its own. Online play needs the Node server running somewhere else (see the next section), and the Pages site connects to it.

1. Create a GitHub repo and push this folder to its `main` branch:
   ```bash
   git init && git add . && git commit -m "Iron Curtain RTS"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo on GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` runs on every push to `main`. The game appears at `https://<you>.github.io/<repo>/`.
4. **Online play:** deploy the server (for example on Render, below), then put its address in `client/config.js`, for example `export const SERVER_URL = 'https://iron-curtain-rts.onrender.com';`. Commit and push. You can also test a server without redeploying by adding `?server=https://...` to the page URL.

## Deploy the server (free hosting)

The server is a single Node process: a static file server plus WebSockets. It reads the port from `PORT`.

- **Render**: push this folder to a GitHub repo. In Render, choose *New → Blueprint* and select the repo. `render.yaml` sets everything up. Free instances sleep when idle, so the first visit may take about 30 seconds.
- **Fly.io**: `fly launch` (it detects the `Dockerfile`), then `fly deploy`.
- **Railway**: create a new project from the repo. Railway detects Node and runs `npm start`.

## Rendered 3D sprites

All units and buildings use sprites rendered from 3D models in Blender, in the style of RA2's pre-rendered art: 21 vehicle and aircraft types, 15 infantry looks, every faction building (NATO and Pact versions), the oil derrick, and civilian buildings for each of the 4 biomes. Turrets, radar antennas and the derrick pump are separate animated layers, and new buildings rise out of the ground when placed or deployed from an MCV. Each sprite sheet downloads the first time its unit appears. Until it arrives, or if a sheet is missing, the game shows the hand-coded pixel art.

- **Models** are built from code in `tools/sprites/models.py`: boxes, lofts, cylinders and domes, with grime and camo materials. Parts tagged `team` are tinted with the player's colour in game.
- **Rendering:** with Blender installed (`brew install --cask blender`), run:
  ```bash
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/sprites/render.py -- tank_PACT   # one unit (omit for all)
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/sprites/preview.py               # contact sheet -> tools/sprites/preview.png
  ```
  Add `--fast` for quick, noisy test renders, or `--buildings` to render only buildings (models in `tools/sprites/buildings.py`).
- **Output:** `client/sprites/<look>_<faction>.png` plus a `.mask.png` (team-colour areas) and `manifest.json`. Vehicles have 32 directions with a separate turret layer. Infantry have 8 directions with idle, 4 walk frames and a fire frame. The camera matches the game's 2:1 isometric view, and 1 Blender unit is 1 map tile.
- **Adding a unit:** write a builder in `models.py`, then add it to `UNITS` under the key `<look>_<faction>` used in `client/art-units.js`.

## Controls

| Action | Input |
|---|---|
| Select / box-select | Left-click / left-drag |
| Select all of a type on screen | Double-click a unit, or **Q** with units selected |
| Move / attack / capture / harvest | Right-click |
| Scroll | Right-drag, middle-drag, arrow keys, or screen edges |
| Deploy MCV / dig in NATO infantry / evacuate a garrison | **D** (or right-click the MCV / your selected garrison). Moving a dug-in unit undeploys it automatically. |
| Attack-move | **A**, then left-click |
| Attack a bridge | **Ctrl** + right-click the bridge |
| Repair a destroyed bridge | Right-click a bridge repair hut with an engineer |
| Stop | **S** |
| Control groups | **Ctrl+1–9** (or Alt+1–9) to assign; **1–9** to select (press twice to jump the camera) |
| Sell / Repair mode | **Z** / **R** (or the sidebar buttons) |
| Rally point | Select a Barracks, War Factory or Air Base (helicopters only; jets park on pads), then right-click the ground |
| Send jets home to rearm | Right-click your Air Base with jets selected (or press **S**) |
| Queue 5 units | Shift-click a sidebar item. Right-click an item to cancel it. |
| Base / Chat / Mute / Menu | **H** / **Enter** / **M** / **Esc** |
| Show unit names | Hover a unit, or hold **Alt** to label every visible unit |

## Project layout

```
shared/   game simulation shared by server and browser
  data.js         factions, countries, units, buildings, weapons
  map.js          terrain types, movement classes, random map generator
  maps.js         the 20 historical scenario maps
  pathfinding.js  A* pathfinding
  game.js         authoritative simulation (15 ticks/sec)
  ai.js           computer opponent
  room.js         lobby and game loop (used by the server and by browser skirmish)
server/index.js   HTTP and WebSocket server
client/           browser client
  render.js       low-res pixel renderer + palette/dither post-process
  palette.js      gritty palette and ordered-dither quantizer
  art-core.js     isometric drawing primitives
  art-buildings.js / art-units.js   NATO and Warsaw Pact art
  ui.js, main.js  terminal-style sidebar, input, menus
test/             headless AI-vs-AI test and online multiplayer test
```

Networking is server-authoritative. Clients send commands and the server broadcasts compact snapshots, which clients interpolate between. Balance numbers live in `shared/data.js`.

## Tests

```bash
npm test                 # headless AI vs AI game (args: seed players minutes)
node test/online.js      # requires a running server; two clients play online
node test/pathing.js     # two-way army traffic + harvesting on city/jungle maps
node test/garrison.js    # garrison rules
node test/air.js         # jets, pads, rearming, helicopters, anti-air
node test/bridge.js      # destroying and repairing bridges
node test/paradrop.js    # tech airport capture and paradrops
node test/elevation.js   # plateaus, ramps, flat-only building, build radius
```
