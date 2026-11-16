# Area guide: picking an area by how it looks

Choose an area for what the scene needs to *look like*. Its canon location doesn't matter: the GM can say it's anywhere. Use `"area": { "game": "kotor" | "tsl", "module": "<module>" }`. Either game's areas work in either game; actors and props still come from the game the GM runs.

After choosing, grep `catalog/<game>/areas.md` for `## <module>` to see its rooms and waypoints.

## KotOR areas by setting

| Setting | Areas (module: what it is) |
|---|---|
| Jedi temple, enclave, council chamber, training halls | `danm13`: Dantooine Jedi Enclave interior (council chambers, training rooms, courtyard); best Jedi-temple interior |
| Ancient or alien temple, ruins interior | `danm15`: Dantooine ruins (Star Map temple, droid guardians); `unk_m44aa`: Rakatan temple main floor; `unk_m41ac`: Rakatan temple summit (exterior) |
| Sith academy, dark-side school | `korr_m35aa`: Korriban Sith Academy halls |
| Sith tomb, dark crypt, trial chambers | `korr_m37aa`: Tomb of Ajunta Pall; `korr_m38ab`: Tomb of Tulak Hord; `korr_m39aa`: Tomb of Naga Sadow; `korr_m38aa`: Tomb of Marko Ragnos |
| Canyon, valley of tombs, badlands | `korr_m36aa`: Valley of the Dark Lords |
| Military base, garrison, embassy | `tar_m09aa`: Taris Sith military base; `manm27aa`: Manaan Sith base |
| Warship corridors, bridge, under attack | `end_m01aa` / `end_m01ab`: Endar Spire (Republic cruiser; bridge, engine room, escape pods); `lev_m40ab`: Leviathan command deck |
| Prison, detention block | `lev_m40aa`: Leviathan prison block |
| Hangar, docking bay | `lev_m40ac`: Leviathan hangar; `tat_m17ab`: Anchorhead docking bay; `manm26ad`: Ahto City docking bay; `kas_m22aa`: Czerka landing port (in the trees) |
| Small starship interior | `ebo_m12aa`: Ebon Hawk |
| Space station | `liv_m99aa`: Yavin station (small orbital station); `sta_m45aa`: Star Forge deck (exterior walkways, defense towers) |
| Final confrontation, arena, platform | `sta_m45ad`: Star Forge viewing platform; `lev_m40ac`: Leviathan hangar |
| City streets, plazas (upscale) | `tar_m02aa` / `tar_m02ab`: Taris Upper City; `manm26aa` / `manm26ab`: Ahto City (floating city, courts, plaza) |
| Slums, gang streets | `tar_m03aa`: Taris Lower City |
| Ruined city, wasteland, monster-infested | `tar_m04aa`: Taris Undercity (outcast village, rakghoul wasteland) |
| Gang hideout, garage, criminal base | `tar_m10aa`: Black Vulkar base; `tar_m11aa`: Hidden Bek base |
| Cantina, bar, dueling ring | `tar_m02ac`: Upper City cantina (dueling ring, pazaak); `korr_m33aa`: Dreshdae (colony port and cantina) |
| Hunting lodge, lounge | `tat_m17ae`: Czerka hunting lodge |
| Frontier town, spaceport streets | `tat_m17aa`: Anchorhead; `korr_m33aa`: Dreshdae |
| Desert, dunes | `tat_m18aa`: Dune Sea (with sandcrawler); `tat_m18ab`: eastern Dune Sea (krayt cave, ruins) |
| Nomad or raider camp | `tat_m20aa`: Sand People enclave |
| Jungle, dark forest floor | `kas_m24aa`: Upper Shadowlands; `kas_m25aa`: Lower Shadowlands (Star Map, Mandalorian camp) |
| Treetop village, walkways | `kas_m23aa`: Rwookrrorro (Wookiee village, chieftain's hall); `kas_m22ab`: the Great Walkway |
| Grassland, plains, open countryside | `danm14aa`: Enclave courtyard and plains; `danm14ab`: Matale grounds (bridge, estate grounds); `danm14ac`: grove and ruins path; `danm14ad`: Sandral grounds (crystal cave entrance) |
| Mansion, estate, compound | `danm16`: Sandral estate interior |
| Beach, coast | `unk_m41aa`: Lehon central beach |
| Underwater lab, research station | `manm28aa`: Hrakert station |
| Courtroom, government hall | `manm26aa`: Ahto West (courts, embassies) |

Many more areas exist (117 in KotOR). Grep `catalog/kotor/areas.md` for others; their names come from the game.

## KotOR II areas by setting

| Setting | Areas (module: what it is) |
|---|---|
| Jedi enclave (ruined) | `605dan`: Dantooine enclave courtyard, overgrown and looted; `610dan`: enclave sublevel (underground) |
| Jedi enclave (restored), council chamber | `650dan`: rebuilt Jedi Enclave (council-chamber ending) |
| Secret Jedi academy, ice retreat | `262tel`: Telos secret academy; `261tel`: Telos polar plateau |
| Sith academy, dark school | `702kor`: Korriban Sith academy (abandoned); `903mal` / `908mal` / `909mal`: Trayus Academy on Malachor V |
| Sith tomb, dark cave | `711kor`: Korriban secret tomb; `710kor`: Shyrack cave; `411dxn`: Dxun Sith tomb; `410dxn`: jungle tomb |
| Ruined, dead world | `901mal`: Malachor V surface; `902mal`: Malachor V depths |
| Final-battle arena | `904mal` / `907mal`: Trayus Core; `906mal`: Trayus proving grounds; `905mal`: Trayus Crescent |
| Royal palace, throne room, court | `506ond`: Onderon royal palace |
| City streets, markets, squares | `502ond` / `511ond`: Iziz merchant quarter; `512ond`: Iziz western square; `501ond`: Iziz spaceport |
| Cantina, bar | `503ond`: Iziz cantina; `207tel`: Citadel Station cantina; `304nar`: Jekk'Jekk Tarr (Nar Shaddaa, toxic-air bar) |
| Smuggler moon, slums, refugee quarter | `301nar` / `350nar`: refugee landing pad; `302nar`: refugee quad; `303nar`: docks; `306nar` / `307nar`: entertainment promenade |
| Criminal yacht, luxury ship | `351nar`: Goto's yacht |
| Space station, habitat | `201tel`: Citadel Station dock; `202tel` / `222tel`: entertainment modules; `203tel` / `204tel`: residential; `220tel` / `221tel` / `225tel`: suburban; `208tel`: Bumani Exchange (corporate offices); `209tel`: Czerka offices |
| Mining facility, industrial | `101per`: Peragus administration; `102per`: mining tunnels; `103per`: fuel depot; `105per`: dormitories; `106per`: hangar bay |
| Asteroid, space exterior | `104per`: Peragus asteroid exterior; `002ebo`: Ebon Hawk exterior hull |
| Warship, flagship decks | `151har` / `154har`: Harbinger command deck; `152har`: crew quarters; `153har`: engine deck; `851nih`: Ravager command deck; `852nih`: Ravager bridge |
| Small starship interior | `001ebo` (and the other `0xxebo`): Ebon Hawk |
| Military base, bunker | `232tel`: Telos underground base; `298tel`: military base sub-level; `404dxn`: Mandalorian cache |
| Factory, droid plant | `299tel`: HK manufacturing plant |
| Restored wilderness, research site | `231tel`: Telos restoration zone; `233tel`: Czerka site |
| Jungle, wilderness | `401dxn`: Dxun jungle landing; `402dxn`: Dxun jungle |
| Warrior camp, ruins in the jungle | `403dxn`: Mandalorian ruins (Mandalore's camp) |
| Grassland, frontier village | `601dan` / `603dan`: Khoonda plains; `602dan`: Khoonda (settlement, militia hall) |
| Crystal cave | `604dan`: Dantooine crystal cave |
| Canyon, valley of tombs | `701kor`: Korriban Valley of the Dark Lords |
| Racetrack, arena | `211tel`, `371nar`, `510ond`: swoop tracks |
| Gun turret, battle station seat | `421dxn`: blockade turret; `505ond`: Onderon turret; `107per`: Peragus hangar turret |

There are 93 KotOR II areas in all. Grep `catalog/tsl/areas.md` for the rest.
