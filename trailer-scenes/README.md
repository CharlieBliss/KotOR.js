# Trailer scenes

Six GM-mode scene plans for cutting a short trailer. Each one nods to the original Star Wars films and to KotOR / KotOR II, and each is set somewhere that looks different from the others: a starship, desert, a treetop village, an ice field, a Jedi council chamber and an open deck in space.

All six run KotOR II content (`"content": "tsl"`). Fights are tuned for one level-15 Jedi Guardian fighting alongside the scene's allies.

## Running one

```bash
npm run gm:play -- trailer-scenes/01-boarding-the-endar-spire.json
```

This needs the dev server (`npm run dev`, localhost:8080). It opens a GM window hosting the scene and a player window. Run the beats in order from **Scenes > Scene plan**, waiting between them as each plan's GM notes say. To import a plan by hand instead: Scenes > Scene plan > Open file > Import and set the scene.

## The scenes

| # | File | Area | Star Wars | KotOR | What to film |
|---|---|---|---|---|---|
| 1 | `01-boarding-the-endar-spire.json` | KotOR `end_m01aa`, Endar Spire command module | *A New Hope*'s opening: troopers blast into a blockade runner, then Vader walks in through the smoke | KotOR's opening attack on the Endar Spire; Carth Onasi; Darth Malak | The Republic line firing at the door as it blows (beat 2), then Malak walking in alone (beat 3) and the saber duel (beat 4) |
| 2 | `02-twin-suns-dune-sea.json` | KotOR `tat_m18aa`, Tatooine Dune Sea | Twin suns; Tusken Raiders attack; an old hermit in a robe drives them off; the krayt dragon call | KotOR's Dune Sea, Sand People and krayt dragon; Jolee Bindo as the hermit | Wide empty desert and the farm (beat 1), raiders cresting the ridge (2), the hermit walking out of the haze (3), the krayt dragon on the far dune (4, it only watches) |
| 3 | `03-wookiee-treetops.json` | KotOR `kas_m23aa`, Rwookrrorro | Wookiees in battle (Chewbacca's people, Kashyyyk); a forest fight with the locals | Rwookrrorro, Czerka slavers, Trandoshan hunters, Zaalbar as chieftain | The village at peace (1), slavers coming off the lift with cages (2), the Wookiee roar and counter-charge (3), freeing the captives (4) |
| 4 | `04-battle-of-the-ice-plateau.json` | KotOR II `261tel`, Telos polar plateau | *The Empire Strikes Back*'s battle of Hoth: probe droid, trench line, walkers out of the snow, the evacuation | Telos, Atris's hidden academy, the Handmaidens, Telos security | The probe droid over the trench (1–2), the droid column crossing the ice (3), the tank droid and its escort (4) |
| 5 | `05-the-council-convenes.json` | KotOR `danm13`, Dantooine Jedi Enclave council chamber | A small, ancient master who speaks backwards (Yoda); *Return of the Jedi*'s quiet dark-side menace | KotOR's Jedi Council chamber; KotOR II's ending, where Kreia strips the surviving Masters of the Force; Master Vandar | The quiet one. Slow shots of the meditation circle (1), Vandar speaking (2), Kreia's walk in (3), the Masters falling (4). Beat 5 is an optional duel with Kreia |
| 6 | `06-the-dark-lords-throne.json` | KotOR `sta_m45ad`, Star Forge viewing platform | *Return of the Jedi*'s throne room: the master watches as apprentice and Jedi duel, then the apprentice turns on him | KotOR's finale: Malak among Jedi in stasis, Bastila fallen and redeemed | The standoff (1), the Bastila duel (2), Malak draining the captives (3), Bastila turning and the last fight (4) |

## Notes

- Areas are empty when they're borrowed from the other game: these plans place everything they need, and doorways stay open.
- Fight ratings are from the offline checker (`skills/kotor-gm-scenes/scripts/check_plan.py`) for one level-15 player. Change each file's `party` and re-run the checker if the party differs.
- In scene 2, the krayt dragon stands down by design. To make it a boss fight, turn it hostile from the GM panel; it is deadly at this level.
- In scene 5, the Masters turn neutral and stand down when they fall, so they stay down if you run the optional duel.
