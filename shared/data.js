// Shared game data: factions, countries, weapons, units, buildings.

export const TICK_RATE = 15;
export const DT = 1 / TICK_RATE;

// Faction-wide traits (modeled on RA2's Allies vs Soviets).
export const FACTIONS = {
  NATO: {
    name: 'NATO', bloc: 'NATO & Western Allies', infantryBuild: 1,
    desc: 'Quality over quantity. Expensive elite infantry that DEPLOY into fortified sandbag positions. Fast light tanks, fast ore trucks, efficient power plants.',
  },
  PACT: {
    name: 'Warsaw Pact', bloc: 'Warsaw Pact & Eastern Allies', infantryBuild: 0.75,
    desc: 'Quantity and armor. Cheap conscripts trained 25% faster, heavy slow tanks, armed War Miners, cheaper power and tougher bunkers.',
  },
};

export const COUNTRIES = {
  USA: { name: 'United States', faction: 'NATO', special: 'abrams', desc: 'M1 Abrams: heavy main battle tank with composite armor and a 120mm gun.' },
  UK: { name: 'United Kingdom', faction: 'NATO', special: 'sas', desc: 'SAS Commando: elite sniper who demolishes buildings with C4. Limit 1.' },
  FRG: { name: 'West Germany', faction: 'NATO', special: 'leopard', desc: 'Leopard 2: long-range tank hunter that outranges other tanks.' },
  FRA: { name: 'France', faction: 'NATO', special: 'pluton', desc: 'Pluton Launcher: very long-range tactical missile artillery.' },
  USSR: { name: 'Soviet Union', faction: 'PACT', special: 'obj279', desc: 'Object 279: super-heavy twin-gun tank that slowly repairs itself.' },
  GDR: { name: 'East Germany', faction: 'PACT', special: 'stasi', desc: 'Stasi Agent: cloaked spy. Steals credits from refineries and blacks out power plants.' },
  POL: { name: 'Poland', faction: 'PACT', special: 'skot', desc: 'OT-64 SKOT: fast amphibious armored car that can cross water.' },
  CUB: { name: 'Cuba', faction: 'PACT', special: 'guerrilla', desc: 'Guerrilla Sapper: fast, cheap suicide bomber.' },
  // Proxy-war allies
  ROK: { name: 'South Korea', faction: 'NATO', special: 'rokmarine', desc: 'ROK Marine: tough elite infantry. Digs in deeper than any rifleman.' },
  ISR: { name: 'Israel', faction: 'NATO', special: 'merkava', desc: 'Merkava: very heavily armored tank built to protect its crew.' },
  RSA: { name: 'South Africa', faction: 'NATO', special: 'g6', desc: 'G6 Rhino: fast six-wheeled howitzer with extreme range.' },
  AFG: { name: 'Afghan Mujahideen', faction: 'NATO', special: 'mujahid', desc: 'Mujahideen: RPG fighters who cross mountains and vanish among the rocks.' },
  PRK: { name: 'North Korea', faction: 'PACT', special: 'kpa', desc: 'KPA Squad: three riflemen for the price of one purchase.' },
  VNM: { name: 'North Vietnam', faction: 'PACT', special: 'vietcong', desc: 'Viet Cong: guerrillas who move through jungle and vanish in the trees.' },
  EGY: { name: 'Egypt', faction: 'PACT', special: 'shilka', desc: 'ZSU-23-4 Shilka: quad autocannon that shreds aircraft, infantry and light vehicles.' },
  IRQ: { name: 'Iraq', faction: 'PACT', special: 'scud', desc: 'Scud Launcher: huge-range ballistic missile. Very inaccurate, devastating hit.' },
};

export const COLORS = [
  { name: 'Red', hex: '#d83a32' },
  { name: 'Blue', hex: '#2f6ae0' },
  { name: 'Green', hex: '#3aa645' },
  { name: 'Yellow', hex: '#e2c228' },
  { name: 'Orange', hex: '#e8792a' },
  { name: 'Purple', hex: '#9645c8' },
  { name: 'Cyan', hex: '#25b8c8' },
  { name: 'Pink', hex: '#e866aa' },
];

// damage multipliers vs armour classes; 'air' is for aircraft (only anti-air weapons and some guns can hit them)
const V = (infantry, light, heavy, building, air = 0) => ({ infantry, light, heavy, building, air });

// proj: bullet | shell | rocket | arty | grad | missile | none
export const WEAPONS = {
  rifle: { dmg: 18, rof: 1.0, range: 4.5, proj: 'bullet', vs: V(1, 0.35, 0.2, 0.25), snd: 'rifle' },
  conscriptRifle: { dmg: 11, rof: 1.0, range: 4.5, proj: 'bullet', vs: V(1, 0.3, 0.15, 0.2), snd: 'rifle' },
  rifleDug: { dmg: 18, rof: 0.35, range: 6, proj: 'bullet', vs: V(1, 0.35, 0.15, 0.25), snd: 'mg' },
  atDug: { dmg: 70, rof: 2.0, range: 7.5, proj: 'rocket', vs: V(0.3, 1, 1, 0.6), snd: 'rocket' },
  rpgRocket: { dmg: 50, rof: 2.2, range: 5, proj: 'rocket', vs: V(0.3, 1, 1, 0.6), snd: 'rocket' },
  minerMg: { dmg: 12, rof: 0.5, range: 4.5, proj: 'bullet', vs: V(1, 0.4, 0.1, 0.1, 0.2), snd: 'mg', turret: true },
  atRocket: { dmg: 58, rof: 2.2, range: 5.5, proj: 'rocket', vs: V(0.3, 1, 1, 0.6), snd: 'rocket' },
  mg: { dmg: 12, rof: 0.45, range: 5, proj: 'bullet', vs: V(1, 0.45, 0.15, 0.2, 0.35), snd: 'mg', turret: true },
  hmg: { dmg: 18, rof: 0.45, range: 5, proj: 'bullet', vs: V(1, 0.6, 0.25, 0.3, 0.5), snd: 'mg', turret: true },
  gun105: { dmg: 60, rof: 1.6, range: 5.5, proj: 'shell', vs: V(0.35, 1, 1, 0.8), snd: 'cannon', turret: true },
  gun125: { dmg: 88, rof: 2.0, range: 5.5, proj: 'shell', vs: V(0.35, 1, 1, 0.8), snd: 'cannon', turret: true },
  gun120: { dmg: 105, rof: 1.6, range: 6, proj: 'shell', vs: V(0.4, 1, 1, 0.85), snd: 'cannon', turret: true },
  leoGun: { dmg: 115, rof: 1.9, range: 7, proj: 'shell', vs: V(0.25, 1.1, 1.2, 0.6), snd: 'cannon', turret: true },
  twin130: { dmg: 85, rof: 2.3, range: 5.5, proj: 'shell', burst: 2, burstDelay: 0.2, vs: V(0.4, 1, 1, 0.9), snd: 'cannon', turret: true },
  howitzer: { dmg: 100, rof: 4.5, range: 11, minRange: 3, proj: 'arty', splash: 1.3, inacc: 0.6, clears: 0.35, vs: V(1, 0.8, 0.5, 0.8), snd: 'artillery', turret: true },
  gradRockets: { dmg: 38, rof: 6, range: 10, minRange: 3, proj: 'grad', splash: 1.0, inacc: 1.3, burst: 6, burstDelay: 0.15, clears: 0.35, vs: V(1, 0.8, 0.45, 0.7), snd: 'rocket' },
  plutonMissile: { dmg: 320, rof: 13, range: 18, minRange: 5, proj: 'missile', splash: 2.0, inacc: 0.4, clears: 0.5, vs: V(1, 0.9, 0.8, 1), snd: 'missile' },
  sasRifle: { dmg: 160, rof: 1.5, range: 7, proj: 'bullet', clears: 1, vs: V(1, 0.08, 0.04, 0), snd: 'sniper' },
  c4: { dmg: 0, rof: 1, range: 0.9, proj: 'none', vs: V(0, 0, 0, 1), c4: true },
  marineRifle: { dmg: 26, rof: 0.9, range: 5, proj: 'bullet', vs: V(1, 0.4, 0.2, 0.3), snd: 'rifle' },
  marineDug: { dmg: 26, rof: 0.3, range: 6.5, proj: 'bullet', vs: V(1, 0.4, 0.2, 0.3), snd: 'mg' },
  merkavaGun: { dmg: 92, rof: 1.7, range: 6, proj: 'shell', vs: V(0.5, 1, 1, 0.85), snd: 'cannon', turret: true },
  g6gun: { dmg: 125, rof: 5, range: 14, minRange: 4, proj: 'arty', splash: 1.4, inacc: 0.8, clears: 0.35, vs: V(1, 0.8, 0.5, 0.8), snd: 'artillery', turret: true },
  akRifle: { dmg: 16, rof: 0.9, range: 4.5, proj: 'bullet', vs: V(1, 0.35, 0.15, 0.25), snd: 'rifle' },
  quadCannon: { dmg: 10, rof: 0.15, range: 6, proj: 'bullet', vs: V(1, 0.8, 0.15, 0.15, 1.1), snd: 'mg', turret: true, aa: true },
  scudMissile: { dmg: 420, rof: 20, range: 22, minRange: 6, proj: 'missile', splash: 2.6, inacc: 2.6, clears: 0.5, vs: V(1, 0.9, 0.8, 1), snd: 'missile' },
  // ---- aircraft ----
  maverick: { dmg: 200, rof: 0.7, range: 5, proj: 'rocket', vs: V(0.4, 1, 1, 0.8), snd: 'rocket' },
  frogRockets: { dmg: 30, rof: 1.0, range: 5, proj: 'rocket', splash: 0.9, inacc: 0.5, burst: 4, burstDelay: 0.08, vs: V(1, 0.9, 0.7, 0.8), snd: 'rocket' },
  cobraGun: { dmg: 34, rof: 0.9, range: 5, proj: 'rocket', splash: 0.5, vs: V(0.9, 1, 0.75, 0.6), snd: 'rocket' },
  hindGun: { dmg: 19, rof: 1.0, range: 5, proj: 'rocket', splash: 0.6, burst: 2, burstDelay: 0.15, vs: V(1, 0.9, 0.6, 0.6), snd: 'rocket' },
  // ---- anti-air ----
  vulcanGun: { dmg: 11, rof: 0.12, range: 7, proj: 'bullet', vs: V(0.9, 0.4, 0.08, 0.1, 1), snd: 'mg', turret: true, aa: true },
  strelaMissile: { dmg: 90, rof: 1.8, range: 9, proj: 'missile', vs: V(0, 0, 0, 0, 1), snd: 'missile', turret: true, aa: true },
  manpads: { dmg: 75, rof: 2.4, range: 8, proj: 'missile', vs: V(0, 0, 0, 0, 1), snd: 'missile', aa: true },
  samMissile: { dmg: 130, rof: 2.2, range: 11, proj: 'missile', vs: V(0, 0, 0, 0, 1), snd: 'missile', turret: true, aa: true },
  pistol: { dmg: 9, rof: 1.0, range: 3.5, proj: 'bullet', vs: V(1, 0.05, 0, 0), snd: 'rifle' },
  suicide: { dmg: 450, rof: 1, range: 0.7, proj: 'none', splash: 1.6, suicide: true, clears: 1, vs: V(1, 1, 1, 1), snd: 'boom' },
  pillboxMg: { dmg: 18, rof: 0.5, range: 6, proj: 'bullet', vs: V(1, 0.4, 0.15, 0.2, 0.4), snd: 'mg', turret: true },
  atGun: { dmg: 115, rof: 1.7, range: 7, proj: 'shell', vs: V(0.3, 1, 1, 0.5), snd: 'cannon', turret: true },
};

export const PROJ_SPEED = { bullet: 40, shell: 16, rocket: 10, arty: 7, grad: 9, missile: 12, nuke: 4 };

// cat: infantry | vehicle. faction: NATO | PACT | ALL. country: for specials.
export const UNITS = {
  // --- shared ---
  engineer: { name: 'Engineer', faction: 'ALL', cat: 'infantry', cost: 500, hp: 75, armor: 'infantry', speed: 1.2, sight: 4, req: ['barracks'], look: 'engineer', desc: 'Captures enemy and neutral buildings (oil derricks).' },
  harvester: { name: 'Ore Truck', faction: 'ALL', cat: 'vehicle', cost: 1400, hp: 1000, armor: 'heavy', speed: 1.6, sight: 4, req: ['factory', 'refinery'], look: 'harvester', capacity: 700, desc: 'Collects ore and brings it to a refinery.',
    factions: {
      NATO: { name: 'Ore Truck', hp: 800, speed: 2.1, desc: 'Fast, lightly armored ore collector.' },
      PACT: { name: 'War Miner', hp: 1300, speed: 1.4, capacity: 840, weapon: 'minerMg', desc: 'Armored ore collector with a machine gun. Slow but carries more.' },
    } },
  manpads: { name: 'Stinger Team', faction: 'ALL', cat: 'infantry', cost: 400, hp: 110, armor: 'infantry', speed: 1.25, sight: 7, weapon: 'manpads', req: ['barracks', 'radar'], look: 'manpads', garrison: true, desc: 'Shoulder-launched anti-aircraft missiles. Cannot hit ground targets.',
    factions: { NATO: { name: 'Stinger Team' }, PACT: { name: 'Strela-2 Team', cost: 350, hp: 95 } } },
  mcv: { name: 'MCV', faction: 'ALL', cat: 'vehicle', cost: 3000, hp: 1000, armor: 'heavy', speed: 1.2, sight: 4, req: ['factory', 'radar'], look: 'mcv', desc: 'Mobile Construction Vehicle. Deploys into a Construction Yard.' },
  // --- NATO ---
  rifleman: { name: 'Rifleman', faction: 'NATO', cat: 'infantry', garrison: true, cost: 200, hp: 160, armor: 'infantry', speed: 1.3, sight: 6, weapon: 'rifle', deployWeapon: 'rifleDug', deployArmor: 0.6, req: ['barracks'], look: 'inf', desc: 'Well-trained soldier. DEPLOY (D) to dig into sandbags: heavy fire, longer range, 40% less damage taken.' },
  atteam: { name: 'Dragon AT Team', faction: 'NATO', cat: 'infantry', garrison: true, cost: 350, hp: 130, armor: 'infantry', speed: 1.2, sight: 6, weapon: 'atRocket', deployWeapon: 'atDug', deployArmor: 0.6, req: ['barracks'], look: 'atinf', desc: 'Anti-tank missile team. DEPLOY (D) to set up the launcher: longer range and harder hits.' },
  jeep: { name: 'Recon Jeep', faction: 'NATO', cat: 'vehicle', cost: 500, hp: 230, armor: 'light', speed: 3.4, sight: 8, weapon: 'mg', req: ['factory'], look: 'jeep', desc: 'Fast scout with a machine gun.' },
  m60: { name: 'M60 Patton', faction: 'NATO', cat: 'vehicle', cost: 700, hp: 420, armor: 'heavy', speed: 2.4, sight: 6, weapon: 'gun105', req: ['factory'], look: 'tank', desc: 'Fast, cheap main battle tank. Lighter armor than Pact tanks.' },
  m109: { name: 'M109 Howitzer', faction: 'NATO', cat: 'vehicle', cost: 1000, hp: 250, armor: 'light', speed: 1.6, sight: 6, weapon: 'howitzer', req: ['factory', 'radar'], look: 'arty', desc: 'Long-range self-propelled artillery.' },
  // --- PACT ---
  conscript: { name: 'Conscript', faction: 'PACT', cat: 'infantry', garrison: true, cost: 100, hp: 100, armor: 'infantry', speed: 1.3, sight: 5, weapon: 'conscriptRifle', req: ['barracks'], look: 'inf', desc: 'Cheap, poorly trained rifleman. Strength in numbers.' },
  rpg: { name: 'RPG Trooper', faction: 'PACT', cat: 'infantry', garrison: true, cost: 250, hp: 100, armor: 'infantry', speed: 1.2, sight: 5, weapon: 'rpgRocket', req: ['barracks'], look: 'atinf', desc: 'Cheap anti-tank rocket infantry.' },
  brdm: { name: 'BRDM-2 Scout', faction: 'PACT', cat: 'vehicle', cost: 500, hp: 260, armor: 'light', speed: 3.1, sight: 8, weapon: 'mg', req: ['factory'], look: 'jeep', desc: 'Fast armored scout car.' },
  t72: { name: 'T-72', faction: 'PACT', cat: 'vehicle', cost: 900, hp: 600, armor: 'heavy', speed: 1.7, sight: 5, weapon: 'gun125', req: ['factory'], look: 'tank', desc: 'Heavy main battle tank. Tougher and harder-hitting than NATO tanks, but slower.' },
  grad: { name: 'BM-21 Grad', faction: 'PACT', cat: 'vehicle', cost: 1000, hp: 240, armor: 'light', speed: 1.7, sight: 6, weapon: 'gradRockets', req: ['factory', 'radar'], look: 'grad', desc: 'Rocket artillery that fires salvos.' },
  vulcan: { name: 'M163 Vulcan', faction: 'NATO', cat: 'vehicle', cost: 800, hp: 280, armor: 'light', speed: 2.6, sight: 8, weapon: 'vulcanGun', req: ['factory', 'radar'], look: 'vulcan', desc: 'Anti-aircraft gatling. Also shreds infantry.' },
  strela: { name: '9K31 Strela-1', faction: 'PACT', cat: 'vehicle', cost: 800, hp: 300, armor: 'light', speed: 2.6, sight: 9, weapon: 'strelaMissile', req: ['factory', 'radar'], look: 'strela', desc: 'Anti-aircraft missile carrier. Air targets only.' },
  // --- Aircraft (built at the Air Base / Airfield) ---
  a10: { name: 'A-10 Thunderbolt', faction: 'NATO', cat: 'air', air: 'jet', cost: 1400, hp: 380, armor: 'air', speed: 6, sight: 7, weapon: 'maverick', ammo: 4, req: ['airfield'], look: 'a10', desc: 'Tank-busting jet. Flies attack runs with 4 missiles, then returns to its landing pad to rearm.' },
  cobra: { name: 'AH-1 Cobra', faction: 'NATO', cat: 'air', air: 'heli', cost: 1200, hp: 360, armor: 'air', speed: 3.4, sight: 7, weapon: 'cobraGun', req: ['airfield'], look: 'cobra', desc: 'Attack helicopter. Hovers anywhere and fires rockets. Vulnerable to anti-air and machine guns.' },
  su25: { name: 'Su-25 Frogfoot', faction: 'PACT', cat: 'air', air: 'jet', cost: 1400, hp: 450, armor: 'air', speed: 5.5, sight: 7, weapon: 'frogRockets', ammo: 3, req: ['airfield'], look: 'su25', desc: 'Armored ground-attack jet. Three rocket salvos per sortie, then rearms on its landing pad.' },
  hind: { name: 'Mi-24 Hind', faction: 'PACT', cat: 'air', air: 'heli', cost: 1300, hp: 450, armor: 'air', speed: 3.0, sight: 7, weapon: 'hindGun', req: ['airfield'], look: 'hind', desc: 'Heavily armored helicopter gunship with rocket pods.' },
  // --- Country specials ---
  abrams: { name: 'M1 Abrams', faction: 'NATO', country: 'USA', cat: 'vehicle', cost: 1300, hp: 800, armor: 'heavy', speed: 2.1, sight: 6, weapon: 'gun120', req: ['factory', 'tech'], look: 'heavytank', desc: COUNTRIES.USA.desc },
  sas: { name: 'SAS Commando', faction: 'NATO', country: 'UK', cat: 'infantry', cost: 1200, hp: 220, armor: 'infantry', speed: 1.6, sight: 8, weapon: 'sasRifle', weaponBld: 'c4', req: ['barracks', 'tech'], look: 'commando', limit: 1, desc: COUNTRIES.UK.desc },
  leopard: { name: 'Leopard 2', faction: 'NATO', country: 'FRG', cat: 'vehicle', cost: 1200, hp: 520, armor: 'heavy', speed: 2.3, sight: 8, weapon: 'leoGun', req: ['factory', 'tech'], look: 'leopard', desc: COUNTRIES.FRG.desc },
  pluton: { name: 'Pluton Launcher', faction: 'NATO', country: 'FRA', cat: 'vehicle', cost: 1600, hp: 260, armor: 'light', speed: 1.5, sight: 6, weapon: 'plutonMissile', req: ['factory', 'tech'], look: 'missile', desc: COUNTRIES.FRA.desc },
  obj279: { name: 'Object 279', faction: 'PACT', country: 'USSR', cat: 'vehicle', cost: 1800, hp: 1150, armor: 'heavy', speed: 1.4, sight: 6, weapon: 'twin130', req: ['factory', 'tech'], look: 'superheavy', selfHeal: 5, desc: COUNTRIES.USSR.desc },
  stasi: { name: 'Stasi Agent', faction: 'PACT', country: 'GDR', cat: 'infantry', cost: 450, hp: 100, armor: 'infantry', speed: 1.5, sight: 10, weapon: 'pistol', req: ['barracks', 'radar'], look: 'spy', cloak: true, desc: COUNTRIES.GDR.desc },
  skot: { name: 'OT-64 SKOT', faction: 'PACT', country: 'POL', cat: 'vehicle', cost: 600, hp: 360, armor: 'light', speed: 3.0, sight: 7, weapon: 'hmg', req: ['factory'], look: 'apc', amphib: true, move: 'amphib', desc: COUNTRIES.POL.desc },
  rokmarine: { name: 'ROK Marine', faction: 'NATO', country: 'ROK', cat: 'infantry', garrison: true, cost: 350, hp: 220, armor: 'infantry', speed: 1.35, sight: 6, weapon: 'marineRifle', deployWeapon: 'marineDug', deployArmor: 0.5, req: ['barracks', 'radar'], look: 'marine', desc: COUNTRIES.ROK.desc },
  merkava: { name: 'Merkava', faction: 'NATO', country: 'ISR', cat: 'vehicle', cost: 1450, hp: 850, armor: 'heavy', speed: 1.8, sight: 6, weapon: 'merkavaGun', req: ['factory', 'tech'], look: 'merkava', desc: COUNTRIES.ISR.desc },
  g6: { name: 'G6 Rhino', faction: 'NATO', country: 'RSA', cat: 'vehicle', cost: 1400, hp: 320, armor: 'light', speed: 2.5, sight: 7, weapon: 'g6gun', req: ['factory', 'radar'], look: 'g6', desc: COUNTRIES.RSA.desc },
  mujahid: { name: 'Mujahideen', faction: 'NATO', country: 'AFG', cat: 'infantry', garrison: true, cost: 260, hp: 130, armor: 'infantry', speed: 1.5, sight: 6, weapon: 'rpgRocket', move: 'mountain', cloak: 'terrain', req: ['barracks'], look: 'mujahid', desc: COUNTRIES.AFG.desc },
  kpa: { name: 'KPA Squad', faction: 'PACT', country: 'PRK', cat: 'infantry', garrison: true, cost: 330, hp: 105, armor: 'infantry', speed: 1.3, sight: 5, weapon: 'conscriptRifle', squad: 3, req: ['barracks'], look: 'kpa', desc: COUNTRIES.PRK.desc },
  vietcong: { name: 'Viet Cong', faction: 'PACT', country: 'VNM', cat: 'infantry', garrison: true, cost: 260, hp: 120, armor: 'infantry', speed: 1.6, sight: 6, weapon: 'akRifle', move: 'forest', cloak: 'terrain', req: ['barracks'], look: 'vc', desc: COUNTRIES.VNM.desc },
  shilka: { name: 'ZSU-23-4 Shilka', faction: 'PACT', country: 'EGY', cat: 'vehicle', cost: 1000, hp: 380, armor: 'light', speed: 2.2, sight: 7, weapon: 'quadCannon', req: ['factory', 'radar'], look: 'shilka', desc: COUNTRIES.EGY.desc },
  scud: { name: 'Scud Launcher', faction: 'PACT', country: 'IRQ', cat: 'vehicle', cost: 1800, hp: 300, armor: 'light', speed: 1.5, sight: 5, weapon: 'scudMissile', req: ['factory', 'tech'], look: 'scud', desc: COUNTRIES.IRQ.desc },
  guerrilla: { name: 'Guerrilla Sapper', faction: 'PACT', country: 'CUB', cat: 'infantry', cost: 300, hp: 90, armor: 'infantry', speed: 2.0, sight: 5, weapon: 'suicide', req: ['barracks'], look: 'sapper', desc: COUNTRIES.CUB.desc },
};

// Buildings. names: [NATO, PACT]. power: + produces, - consumes.
export const BUILDINGS = {
  conyard: { names: ['Construction Yard', 'Construction Yard'], w: 3, h: 3, hp: 2000, cost: 3000, power: 0, sight: 6, cat: null, produces: ['building', 'defense'], req: [], height: 30 },
  power: { names: ['Power Plant', 'Power Station'], w: 2, h: 2, hp: 750, cost: 800, power: 100, sight: 4, cat: 'building', req: [], height: 26, desc: 'Provides power.',
    factions: { NATO: { power: 120, desc: 'Efficient nuclear plant. +120 power.' }, PACT: { cost: 600, power: 80, hp: 850, desc: 'Cheap, sturdy coal plant. +80 power.' } } },
  refinery: { names: ['Ore Refinery', 'Ore Processor'], w: 3, h: 3, hp: 1100, cost: 2000, power: -30, sight: 5, cat: 'building', req: ['power'], height: 24, desc: 'Processes ore into credits. Comes with an Ore Truck.' },
  barracks: { names: ['Barracks', 'Barracks'], w: 2, h: 2, hp: 800, cost: 500, power: -10, sight: 5, cat: 'building', req: ['power'], produces: ['infantry'], height: 20, desc: 'Trains infantry.' },
  factory: { names: ['War Factory', 'Tank Plant'], w: 3, h: 3, hp: 1200, cost: 2000, power: -25, sight: 5, cat: 'building', req: ['refinery'], produces: ['vehicle'], height: 30, desc: 'Builds vehicles.' },
  radar: { names: ['AWACS Radar', 'Radar Station'], w: 2, h: 2, hp: 900, cost: 1000, power: -40, sight: 9, cat: 'building', req: ['factory'], height: 22, desc: 'Enables the minimap and advanced units.' },
  tech: { names: ['Research Lab', 'Science Institute'], w: 2, h: 2, hp: 900, cost: 1800, power: -75, sight: 5, cat: 'building', req: ['radar'], height: 28, desc: 'Unlocks country special units and the missile silo.' },
  airfield: { names: ['Air Base', 'Airfield'], w: 3, h: 3, hp: 1000, cost: 1000, power: -50, sight: 6, cat: 'building', req: ['radar'], produces: ['air'], pads: 4, height: 18, desc: 'Builds aircraft. Each base has 4 landing pads where jets rearm.' },
  silo: { names: ['Minuteman Silo', 'SS-20 Silo'], w: 2, h: 2, hp: 1500, cost: 5000, power: -100, sight: 4, cat: 'building', req: ['tech'], height: 14, superweapon: true, desc: 'Nuclear missile. Charges for 5 minutes.' },
  samsite: { names: ['Hawk SAM Site', 'SA-2 SAM Site'], w: 2, h: 2, hp: 700, cost: 1000, power: -40, sight: 10, cat: 'defense', req: ['radar'], weapon: 'samMissile', powered: true, height: 14, desc: 'Long-range surface-to-air missiles. Air targets only. Requires power.' },
  pillbox: { names: ['Pillbox', 'MG Bunker'], w: 1, h: 1, hp: 500, cost: 500, power: 0, sight: 7, cat: 'defense', req: ['barracks'], weapon: 'pillboxMg', height: 12, desc: 'Anti-infantry defense.',
    factions: { PACT: { cost: 400, hp: 650, desc: 'Cheap concrete MG bunker. Tougher than NATO pillboxes.' } } },
  atgun: { names: ['TOW Emplacement', 'AT Gun Nest'], w: 1, h: 1, hp: 650, cost: 900, power: -20, sight: 8, cat: 'defense', req: ['factory'], weapon: 'atGun', powered: true, height: 14, desc: 'Anti-tank defense. Requires power.',
    factions: { NATO: { sight: 9, desc: 'TOW missile launcher with long sight. Requires power.' }, PACT: { cost: 750, hp: 800, desc: 'Cheap, tough towed AT gun. Requires power.' } } },
  // Neutral civilian structures. Infantry can garrison them (RA2 style); capacity scales with size.
  house: { names: ['House', 'House'], w: 2, h: 2, hp: 1100, cost: 800, power: 0, sight: 5, cat: null, req: [], civilian: true, garrison: 4, height: 26 },
  tenement: { names: ['Apartment Block', 'Apartment Block'], w: 2, h: 3, hp: 1600, cost: 1200, power: 0, sight: 6, cat: null, req: [], civilian: true, garrison: 6, height: 36 },
  tenementB: { names: ['Apartment Block', 'Apartment Block'], w: 3, h: 2, hp: 1600, cost: 1200, power: 0, sight: 6, cat: null, req: [], civilian: true, garrison: 6, height: 36 },
  office: { names: ['Office Block', 'Office Block'], w: 3, h: 3, hp: 2400, cost: 1600, power: 0, sight: 7, cat: null, req: [], civilian: true, garrison: 8, height: 48 },
  bridgehut: { names: ['Bridge Repair Hut', 'Bridge Repair Hut'], w: 1, h: 1, hp: 1, cost: 0, power: 0, sight: 0, cat: null, req: [], height: 14, invulnerable: true, desc: 'Send an engineer inside to rebuild the destroyed bridge.' },
  techairport: { names: ['Airport', 'Airport'], w: 3, h: 3, hp: 1500, cost: 0, power: 0, sight: 5, cat: null, req: [], capturable: true, tech: true, height: 30, desc: 'Neutral airport. Capture it with an engineer to call in paratroopers on a timer.' },
  derrick: { names: ['Oil Derrick', 'Oil Derrick'], w: 2, h: 2, hp: 600, cost: 1000, power: 0, sight: 3, cat: null, req: [], income: 15, capturable: true, height: 26 },
};

export const SUPER_CHARGE = 300; // seconds
// Paradrop from a captured tech airport (RA2 style): charge time and the squad dropped per faction.
export const PARA_CHARGE = 180;
export const PARA_SQUAD = { NATO: ['rifleman', 6], PACT: ['conscript', 9] };
export const PARA_PLANE_SPEED = 7, PARA_ALT = 70, PARA_FALL = 18;
export const GARRISON_RANGE = 1.5; // extra range for infantry firing from a building
export const GARRISON_ROF = 0.85;  // garrisoned weapons fire a little faster
export const NUKE = { dmg: 1500, radius: 5, clears: 1, vs: V(1, 1, 0.8, 0.6, 1) };
export const BUILD_RADIUS = 5;

export const ALL_TYPES = [...Object.keys(UNITS), ...Object.keys(BUILDINGS)];
export const TYPE_INDEX = Object.fromEntries(ALL_TYPES.map((t, i) => [t, i]));
// RA2: you can build next to your own base, your allies' bases, and tech buildings you have captured.
export function extendsBase(b, pid, isAlly) {
  if (b.owner < 0 || isCivilian(b.type) || b.type === 'bridgehut') return false;
  if (b.owner === pid) return true;
  return isAlly(b.owner) && !BUILDINGS[b.type].tech && b.type !== 'derrick';
}

export const BRIDGE_HP = 1200;
export function bridgeDamage(w) { return w.proj === 'bullet' || w.proj === 'none' || w.aa && !w.vs.building ? 0 : (w.vs.building || 0); }
export const PROJ_KINDS = ['bullet', 'shell', 'rocket', 'arty', 'grad', 'missile', 'nuke'];
export const JET_CRUISE = 48, HELI_CRUISE = 30; // flight altitudes (art pixels)

// Faction-resolved definitions: base stats merged with per-faction overrides.
const defCache = new Map();
function resolve(table, type, faction) {
  const key = type + '|' + faction;
  let d = defCache.get(key);
  if (!d) {
    const base = table[type];
    d = base.factions && base.factions[faction] ? { ...base, ...base.factions[faction] } : base;
    defCache.set(key, d);
  }
  return d;
}
export function unitDef(type, faction) { return resolve(UNITS, type, faction || 'NATO'); }
export function buildingDef(type, faction) { return resolve(BUILDINGS, type, faction || 'NATO'); }
export function defOf(type, faction) { return UNITS[type] ? unitDef(type, faction) : buildingDef(type, faction); }

export function buildingName(type, faction) {
  return BUILDINGS[type].names[faction === 'PACT' ? 1 : 0];
}

export function typeName(type, faction) {
  if (UNITS[type]) return unitDef(type, faction).name;
  return buildingName(type, faction);
}

export function costOf(type, faction) {
  return defOf(type, faction).cost;
}

export function buildTime(type, faction) {
  const c = costOf(type, faction);
  if (UNITS[type]) {
    let mult = UNITS[type].cat === 'infantry' ? (FACTIONS[faction]?.infantryBuild ?? 1) : 1;
    if (UNITS[type].squad) mult *= 1.35;
    return Math.max(2, c / 110) * mult;
  }
  return Math.max(4, c / 90);
}

// Things a player of a given country can ever build in a category.
export function buildList(country, cat) {
  const faction = COUNTRIES[country].faction;
  if (cat === 'building' || cat === 'defense') {
    return Object.keys(BUILDINGS).filter(k => BUILDINGS[k].cat === cat);
  }
  return Object.keys(UNITS).filter(k => {
    const u = UNITS[k];
    if (u.cat !== cat) return false;
    if (u.faction !== 'ALL' && u.faction !== faction) return false;
    if (u.country && u.country !== country) return false;
    return true;
  });
}

export function categoryOf(type) {
  if (UNITS[type]) return UNITS[type].cat;
  return BUILDINGS[type]?.cat;
}

// Movement class: 0 ground, 1 amphibious, 2 forest (jungle) walker, 3 mountain walker, 4 aircraft.
export function moveClass(def) {
  if (def.air) return 4;
  return def.move === 'amphib' ? 1 : def.move === 'forest' ? 2 : def.move === 'mountain' ? 3 : 0;
}
export function isAir(type) { return !!UNITS[type]?.air; }

export function isCivilian(type) { return !!BUILDINGS[type]?.civilian; }
export function occupantsOf(b) { return b.occ || 0; }

export function weaponFor(def, target, deployed) {
  if (!def.weapon) return null;
  // vs a garrisoned building a sniper shoots the occupants instead of planting C4
  if (target && target.kind === 'b' && def.weaponBld && !(isCivilian(target.type) && occupantsOf(target) > 0)) return WEAPONS[def.weaponBld];
  if (deployed && def.deployWeapon) return WEAPONS[def.deployWeapon];
  return WEAPONS[def.weapon];
}

export function armorOf(e) {
  if (e.kind === 'b' || e.kind === 'bridge') return 'building';
  return UNITS[e.type].armor;
}

// How effective a weapon is against a target, counting garrison-clearing weapons
// (snipers, demolitions, artillery) that kill the infantry inside buildings.
export function effectVs(w, t) {
  const v = w.vs[armorOf(t)];
  if (t.kind === 'b' && w.clears && occupantsOf(t) > 0) return Math.max(v, w.vs.infantry * w.clears);
  return v;
}

// Decides what a unit does when ordered onto an entity. relation: own|ally|enemy|neutral
export function resolveAction(unitType, target, relation, faction) {
  const d = unitDef(unitType, faction);
  if (!target) return 'move';
  const isB = target.kind === 'b';
  const civ = isB && isCivilian(target.type);
  if (civ && d.garrison && (relation === 'neutral' || relation === 'own') && occupantsOf(target) < BUILDINGS[target.type].garrison) return 'garrison';
  if (isB && target.type === 'bridgehut') return unitType === 'engineer' && target.broken ? 'repairBridge' : 'move';
  if (unitType === 'engineer') {
    if (isB && !civ && (relation === 'enemy' || relation === 'neutral') && target.type !== 'silo') return 'capture';
    return relation === 'enemy' ? 'none' : 'follow';
  }
  if (unitType === 'stasi' && isB && relation === 'enemy' && (target.type === 'refinery' || target.type === 'power')) return 'infiltrate';
  // jets ordered onto one of your own air bases return there to rearm
  if (d.air === 'jet' && isB && relation === 'own' && target.type === 'airfield') return 'dock';
  if (unitType === 'harvester') {
    if (isB && relation === 'own' && target.type === 'refinery') return 'dock';
    if (relation === 'enemy') return d.weapon && effectVs(weaponFor(d, target), target) > 0 ? 'attack' : 'none';
    return 'follow';
  }
  if (relation === 'enemy') {
    const w = weaponFor(d, target);
    if (w && effectVs(w, target) > 0) return 'attack';
    return 'none';
  }
  if (relation === 'own' && unitType === 'mcv' && target.kind === 'u' && target.type === 'mcv') return 'deploy';
  return 'follow';
}
