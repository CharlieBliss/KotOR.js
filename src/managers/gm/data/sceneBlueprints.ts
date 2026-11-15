import type { GMSceneBlueprint } from "@/managers/gm/GMTypes";

// Pre-Built Multi-Placeable Scene Blueprints (Office Building, Temple, Command Center, MedLab, Cantina, Warehouse)
export const SCENE_BLUEPRINTS: GMSceneBlueprint[] = [
  {
    id: 'office_building',
    title: 'Office Building & Executive Suite',
    category: 'Urban / Corporate',
    description: 'Complete corporate office layout: Front reception desk & terminal, waiting chairs, 4 open-plan office cubicles with desks, chairs, computer workstations & filing lockers, plus an Executive Director office with a locked vault safe.',
    recommendedModule: 'danm14aa',
    items: [
      // Front Reception Area
      {
        dx: 0, dy: 4.0, dz: 0, yawDeg: 180,
        config: {
          name: 'Reception Front Desk', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table', 'counter'], scale: 1.25,
          useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_i_progspike01'],
          barkText: '[Reception Desk]: Visitor passes and floor directory.'
        }
      },
      {
        dx: 0.9, dy: 4.0, dz: 0.65, yawDeg: 180,
        config: {
          name: 'Reception Check-In Terminal', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'panel', 'terminal'], scale: 0.75,
          useable: true, hasInventory: false, locked: false, openLockDC: 12, lootResRefs: [],
          barkText: '[Reception Terminal]: Welcome to Czerka / Republic Sector Headquarters. Please sign in.'
        }
      },
      {
        dx: -3.2, dy: 2.2, dz: 0, yawDeg: 90,
        config: {
          name: 'Lobby Waiting Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Waiting Area Chair]: Visitors please wait to be called.'
        }
      },
      {
        dx: 3.2, dy: 2.2, dz: 0, yawDeg: -90,
        config: {
          name: 'Lobby Waiting Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Waiting Area Chair]: Visitors please wait to be called.'
        }
      },

      // Cubicle Row 1 (Left & Right)
      {
        dx: -4.2, dy: 8.0, dz: 0, yawDeg: 90,
        config: {
          name: 'Workstation Desk A1 (Operations)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
          useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_i_progspike01'],
          barkText: '[Workstation A1]: Logistics & shipping manifests.'
        }
      },
      {
        dx: -5.3, dy: 8.0, dz: 0, yawDeg: 90,
        config: {
          name: 'Office Chair A1', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: -4.0, dy: 8.7, dz: 0, yawDeg: 90,
        config: {
          name: 'Terminal A1', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal'], scale: 0.85,
          useable: true, hasInventory: false, locked: false, openLockDC: 12, lootResRefs: [],
          barkText: '[Terminal A1]: Quarterly trade route spreadsheets displayed.'
        }
      },
      {
        dx: -5.8, dy: 9.4, dz: 0, yawDeg: 0,
        config: {
          name: 'Filing Cabinet A1', category: 'Office & Furniture', appearanceId: 52, modelKeywords: ['locker', 'footlker'], scale: 1.0,
          useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_i_medeqpmnt01'],
          barkText: '[Filing Locker A1]: Archived invoices.'
        }
      },

      {
        dx: 4.2, dy: 8.0, dz: 0, yawDeg: -90,
        config: {
          name: 'Workstation Desk B1 (Security)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
          useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_i_secspike01'],
          barkText: '[Workstation B1]: Internal security incident reports.'
        }
      },
      {
        dx: 5.3, dy: 8.0, dz: 0, yawDeg: -90,
        config: {
          name: 'Office Chair B1', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 4.0, dy: 8.7, dz: 0, yawDeg: -90,
        config: {
          name: 'Terminal B1', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal'], scale: 0.85,
          useable: true, hasInventory: false, locked: false, openLockDC: 14, lootResRefs: [],
          barkText: '[Terminal B1]: Perimeter sensor logs and badge access control.'
        }
      },
      {
        dx: 5.8, dy: 9.4, dz: 0, yawDeg: 0,
        config: {
          name: 'Filing Cabinet B1', category: 'Office & Furniture', appearanceId: 52, modelKeywords: ['locker', 'footlker'], scale: 1.0,
          useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_secspike01', 'g_w_blstrpstl001'],
          barkText: '[Filing Locker B1]: Confiscated visitor items.'
        }
      },

      // Cubicle Row 2 (Left & Right)
      {
        dx: -4.2, dy: 12.0, dz: 0, yawDeg: 90,
        config: {
          name: 'Workstation Desk A2 (Research)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
          useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_progspike01'],
          barkText: '[Workstation A2]: R&D project notes and holodiscs.'
        }
      },
      {
        dx: -5.3, dy: 12.0, dz: 0, yawDeg: 90,
        config: {
          name: 'Office Chair A2', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 4.2, dy: 12.0, dz: 0, yawDeg: -90,
        config: {
          name: 'Workstation Desk B2 (Finance)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
          useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_progspike01'],
          barkText: '[Workstation B2]: Payroll and off-world account ledgers.'
        }
      },
      {
        dx: 5.3, dy: 12.0, dz: 0, yawDeg: -90,
        config: {
          name: 'Office Chair B2', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },

      // Executive Director Suite (Back Center)
      {
        dx: -2.6, dy: 14.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Executive Suite Pillar (Left)', category: 'Office & Furniture', appearanceId: 50, modelKeywords: ['pillar', 'column', 'sign'], scale: 1.3,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 2.6, dy: 14.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Executive Suite Pillar (Right)', category: 'Office & Furniture', appearanceId: 50, modelKeywords: ['pillar', 'column', 'sign'], scale: 1.3,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 0, dy: 16.5, dz: 0, yawDeg: 180,
        config: {
          name: 'Executive Director Desk', category: 'Office & Furniture', appearanceId: 45, modelKeywords: ['desk', 'table'], scale: 1.35,
          useable: true, hasInventory: true, locked: false, openLockDC: 16, lootResRefs: ['g_i_progspike01', 'g_i_secspike01'],
          barkText: '[Executive Desk]: Polished hardwood desk of the Sector Director.'
        }
      },
      {
        dx: 0, dy: 17.8, dz: 0, yawDeg: 180,
        config: {
          name: 'Executive Director Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.15,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: -1.8, dy: 17.2, dz: 0, yawDeg: 150,
        config: {
          name: 'Executive Mainframe Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'console', 'terminal'], scale: 1.05,
          useable: true, hasInventory: false, locked: false, openLockDC: 18, lootResRefs: [],
          barkText: '[Director Mainframe]: Master override access to all building systems and classified archives.'
        }
      },
      {
        dx: 2.0, dy: 17.2, dz: 0, yawDeg: -150,
        config: {
          name: 'Executive Vault Safe (Locked DC 18)', category: 'Office & Furniture', appearanceId: 54, modelKeywords: ['safe', 'vault', 'metal', 'box'], scale: 1.1,
          useable: true, hasInventory: true, locked: true, openLockDC: 18,
          lootResRefs: ['g_w_lghtsbr04', 'g_w_blstrpstl001', 'g_i_medeqpmnt03', 'g_i_secspike01'],
          barkText: '[Director Vault]: High-security biometric vault.'
        }
      }
    ],
    creatures: [
      {
        dx: 0, dy: 5.1, dz: 0, yawDeg: 180,
        config: {
          name: 'Receptionist Protocol Droid', templateResRef: 'c_drdprot', appearanceId: 63, factionId: 5, hp: 45, level: 3, classId: 1,
          barkText: 'Welcome to the Executive Office Complex! Do you have an appointment with the Director?'
        }
      },
      {
        dx: 0, dy: 17.4, dz: 0, yawDeg: 180,
        config: {
          name: 'Sector Director', templateResRef: 'n_czerkaoff', appearanceId: 18, factionId: 5, hp: 75, level: 6, classId: 2, rightHandResRef: 'g_w_blstrpstl001',
          barkText: 'Who authorized you to enter my private office? Security!'
        }
      }
    ]
  },
  {
    id: 'ancient_temple',
    title: 'Ancient Jedi / Sith Temple Sanctuary',
    category: 'Sacred / Ruins',
    description: 'Monumental Force sanctuary: 2 towering entrance Guardian Statues, processional colonnade of 6 sacred temple obelisks, ceremonial braziers, central raised Sacred Altar / Sarcophagus, Holocron pedestal, and Relic Chest.',
    recommendedModule: 'danm14aa',
    items: [
      // Entrance Guardian Statues & Braziers
      {
        dx: -3.8, dy: 3.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Ancient Guardian Statue (West)', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['statue', 'idol', 'monument'], scale: 1.5,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Ancient Guardian Statue]: Inscribed in High Galactic — "Only those who master the Force may pass."'
        }
      },
      {
        dx: 3.8, dy: 3.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Ancient Guardian Statue (East)', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['statue', 'idol', 'monument'], scale: 1.5,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Ancient Guardian Statue]: Inscribed in High Galactic — "Beware the shadow that dwells within."'
        }
      },
      {
        dx: -2.4, dy: 3.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Threshold Brazier (West)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame', 'light'], scale: 1.15,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Sacred Brazier]: Blue-white temple flames burn without fuel.'
        }
      },
      {
        dx: 2.4, dy: 3.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Threshold Brazier (East)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame', 'light'], scale: 1.15,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Sacred Brazier]: Blue-white temple flames burn without fuel.'
        }
      },

      // Colonnade of 6 Temple Obelisks / Pillars
      {
        dx: -4.2, dy: 7.5, dz: 0, yawDeg: 90,
        config: {
          name: 'Temple Colonnade Pillar I', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 4.2, dy: 7.5, dz: 0, yawDeg: -90,
        config: {
          name: 'Temple Colonnade Pillar II', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: -4.2, dy: 11.5, dz: 0, yawDeg: 90,
        config: {
          name: 'Temple Colonnade Pillar III', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 4.2, dy: 11.5, dz: 0, yawDeg: -90,
        config: {
          name: 'Temple Colonnade Pillar IV', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: -4.2, dy: 15.5, dz: 0, yawDeg: 90,
        config: {
          name: 'Temple Colonnade Pillar V', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 4.2, dy: 15.5, dz: 0, yawDeg: -90,
        config: {
          name: 'Temple Colonnade Pillar VI', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
          useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },

      // Inner Sanctum Altar, Holocron Pedestal, Braziers & Relic Chest
      {
        dx: 0, dy: 16.5, dz: 0, yawDeg: 180,
        config: {
          name: 'High Altar of the Force', category: 'Temple & Sacred', appearanceId: 64, modelKeywords: ['sarcoph', 'altar', 'tomb'], scale: 1.3,
          useable: true, hasInventory: true, locked: false, openLockDC: 20,
          lootResRefs: ['g_w_lghtsbr01', 'g_w_dblsbr001', 'g_a_mstrrobe01', 'g_a_mstrrobe02'],
          barkText: '[High Altar]: Ancient kyber crystals and sacred vestments rest within the stone vault.'
        }
      },
      {
        dx: 0, dy: 13.5, dz: 0, yawDeg: 180,
        config: {
          name: 'Ancient Holocron Pedestal', category: 'Temple & Sacred', appearanceId: 57, modelKeywords: ['starmap', 'holo', 'pedestal', 'panel'], scale: 1.1,
          useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
          barkText: '[Holocron Pedestal]: A glowing geometric holocron awakens at your approach: "Peace is a lie... or is there only the Force?"'
        }
      },
      {
        dx: -2.8, dy: 16.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Sanctum Brazier (Left)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame'], scale: 1.25,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 2.8, dy: 16.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Sanctum Brazier (Right)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame'], scale: 1.25,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 0, dy: 18.8, dz: 0, yawDeg: 180,
        config: {
          name: 'Sanctified Relic Chest', category: 'Temple & Sacred', appearanceId: 53, modelKeywords: ['ornate', 'chest', 'wicker', 'box'], scale: 1.15,
          useable: true, hasInventory: true, locked: false, openLockDC: 18,
          lootResRefs: ['g_w_lghtsbr03', 'g_w_lghtsbr05', 'g_a_kghtrobe01'],
          barkText: '[Sacred Reliquary]: Relics preserved from the Old Republic.'
        }
      }
    ],
    creatures: [
      {
        dx: 0, dy: 14.8, dz: 0, yawDeg: 180,
        config: {
          name: 'Ancient Temple Guardian', templateResRef: 'n_jedicounm', appearanceId: 214, factionId: 5, hp: 160, level: 12, classId: 3,
          rightHandResRef: 'g_w_dblsbr001', armorResRef: 'g_a_mstrrobe01',
          barkText: 'State your purpose, seeker. This sanctuary has stood for a thousand generations.'
        }
      }
    ]
  },
  {
    id: 'command_center',
    title: 'Military Command & Tactical Operations Center',
    category: 'Military / Sci-Fi',
    description: 'Tactical war room: Central Holo-Projector briefing table surrounded by 4 sensor, defense, and communications consoles, 2 armory weapons lockers, power core, and workbench.',
    recommendedModule: 'danm14aa',
    items: [
      {
        dx: 0, dy: 9.0, dz: 0, yawDeg: 0,
        config: {
          name: 'Central Tactical Holo-Table', category: 'Tech & Consoles', appearanceId: 58, modelKeywords: ['holo', 'table', 'comp'], scale: 1.4,
          useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
          barkText: '[Tactical Holo-Map]: Live orbital battle-group telemetry and planetary defense sectors.'
        }
      },
      {
        dx: -3.2, dy: 9.0, dz: 0, yawDeg: 90,
        config: {
          name: 'Orbital Sensor Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 1.05,
          useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
          barkText: '[Sensor Console]: Long-range scanners detect vessels exiting hyperspace.'
        }
      },
      {
        dx: 3.2, dy: 9.0, dz: 0, yawDeg: -90,
        config: {
          name: 'Planetary Defense Grid Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 1.05,
          useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
          barkText: '[Defense Grid Console]: Turbolaser batteries and shield generators online.'
        }
      },
      {
        dx: 0, dy: 12.4, dz: 0, yawDeg: 180,
        config: {
          name: 'Subspace Communications Array', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 1.1,
          useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
          barkText: '[Comms Console]: Encrypted holo-channel open to Fleet Command.'
        }
      },
      {
        dx: -4.8, dy: 13.5, dz: 0, yawDeg: 135,
        config: {
          name: 'Armory Heavy Weapons Locker', category: 'Storage & Cargo', appearanceId: 54, modelKeywords: ['rack', 'weapon', 'metal', 'locker'], scale: 1.15,
          useable: true, hasInventory: true, locked: false, openLockDC: 16,
          lootResRefs: ['g_w_hvrptbltr01', 'g_w_blstrrfl001', 'g_w_blstrpstl001', 'g_a_class8001'],
          barkText: '[Armory Locker]: Heavy repeating blasters and battle armor.'
        }
      },
      {
        dx: 4.8, dy: 13.5, dz: 0, yawDeg: -135,
        config: {
          name: 'Ordnance & Demolitions Locker', category: 'Storage & Cargo', appearanceId: 52, modelKeywords: ['locker', 'footlker', 'box'], scale: 1.15,
          useable: true, hasInventory: true, locked: false, openLockDC: 16,
          lootResRefs: ['g_i_secspike01', 'g_i_progspike01', 'g_i_medeqpmnt02', 'g_w_vbrdblswd01'],
          barkText: '[Ordnance Locker]: Field tech supplies and melee weapons.'
        }
      },
      {
        dx: 0, dy: 15.2, dz: 0, yawDeg: 180,
        config: {
          name: 'Auxiliary Reactor Core', category: 'Tech & Consoles', appearanceId: 60, modelKeywords: ['gen', 'power', 'turbine'], scale: 1.3,
          useable: true, hasInventory: false, locked: false, openLockDC: 18, lootResRefs: [],
          barkText: '[Reactor Core]: Command bunker fusion generator operating nominal.'
        }
      }
    ],
    creatures: [
      {
        dx: 0, dy: 10.6, dz: 0, yawDeg: 180,
        config: {
          name: 'Tactical Commander', templateResRef: 'n_repoff', appearanceId: 37, factionId: 2, hp: 95, level: 8, classId: 0, rightHandResRef: 'g_w_blstrpstl001',
          barkText: 'Gather around the holo-table. Our strike team deploys on your mark!'
        }
      },
      {
        dx: -3.5, dy: 5.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Command Security Droid', templateResRef: 'c_drdwar', appearanceId: 236, factionId: 2, hp: 80, level: 6, classId: 0, rightHandResRef: 'g_w_blstrrfl001',
          barkText: 'Command deck perimeter secure.'
        }
      }
    ]
  },
  {
    id: 'medical_lab',
    title: 'Medical Bay & Kolto Research Facility',
    category: 'Medical / Science',
    description: 'Field hospital & research clinic: 3 pressurized Kolto healing tanks, 2 surgical examination beds, diagnostic bio-scanner consoles, research workbench, and trauma supply cabinets.',
    recommendedModule: 'danm14aa',
    items: [
      {
        dx: -3.2, dy: 12.5, dz: 0, yawDeg: 180,
        config: {
          name: 'Kolto Regeneration Tank Alpha', category: 'Medical & Lab', appearanceId: 39, modelKeywords: ['kolto', 'bacta', 'tank'], scale: 1.2,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Kolto Tank Alpha]: Nutrient-rich Manaan Kolto suspension ready for critically injured patients.'
        }
      },
      {
        dx: 0, dy: 12.5, dz: 0, yawDeg: 180,
        config: {
          name: 'Kolto Regeneration Tank Beta', category: 'Medical & Lab', appearanceId: 39, modelKeywords: ['kolto', 'bacta', 'tank'], scale: 1.2,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Kolto Tank Beta]: Vital signs stabilized.'
        }
      },
      {
        dx: 3.2, dy: 12.5, dz: 0, yawDeg: 180,
        config: {
          name: 'Kolto Regeneration Tank Gamma', category: 'Medical & Lab', appearanceId: 39, modelKeywords: ['kolto', 'bacta', 'tank'], scale: 1.2,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Kolto Tank Gamma]: Pressurized Kolto synthesizer online.'
        }
      },
      {
        dx: -3.5, dy: 7.5, dz: 0, yawDeg: 90,
        config: {
          name: 'Surgical Recovery Bed 1', category: 'Medical & Lab', appearanceId: 40, modelKeywords: ['bed', 'cot', 'table'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Surgical Bed 1]: Sterile bio-foam mattress with neural monitor.'
        }
      },
      {
        dx: 3.5, dy: 7.5, dz: 0, yawDeg: -90,
        config: {
          name: 'Surgical Recovery Bed 2', category: 'Medical & Lab', appearanceId: 40, modelKeywords: ['bed', 'cot', 'table'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Surgical Bed 2]: Ready for triage patients.'
        }
      },
      {
        dx: -1.8, dy: 9.8, dz: 0, yawDeg: 180,
        config: {
          name: 'Bio-Scanner Diagnostic Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 0.95,
          useable: true, hasInventory: false, locked: false, openLockDC: 12, lootResRefs: [],
          barkText: '[Medical Console]: Midi-chlorian and cellular regeneration analysis active.'
        }
      },
      {
        dx: 2.2, dy: 9.8, dz: 0, yawDeg: 180,
        config: {
          name: 'Pharmaceutical Synthesis Workbench', category: 'Medical & Lab', appearanceId: 68, modelKeywords: ['workbench', 'bench', 'table'], scale: 1.0,
          useable: true, hasInventory: true, locked: false, openLockDC: 10,
          lootResRefs: ['g_i_medeqpmnt01', 'g_i_medeqpmnt02', 'g_i_medeqpmnt03'],
          barkText: '[Medical Workbench]: Synthesize medpacs, stimulants, and antidotes.'
        }
      },
      {
        dx: 0, dy: 5.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Emergency Trauma Supply Locker', category: 'Medical & Lab', appearanceId: 52, modelKeywords: ['med', 'locker', 'footlker'], scale: 1.05,
          useable: true, hasInventory: true, locked: false, openLockDC: 12,
          lootResRefs: ['g_i_medeqpmnt02', 'g_i_medeqpmnt03', 'g_i_medeqpmnt03'],
          barkText: '[Trauma Locker]: Stocked with Advanced Medpacs and Life Support Packs.'
        }
      }
    ],
    creatures: [
      {
        dx: 0, dy: 8.5, dz: 0, yawDeg: 180,
        config: {
          name: 'Chief Medical Officer Droid', templateResRef: 'c_drdprot', appearanceId: 63, factionId: 2, hp: 60, level: 5, classId: 1,
          barkText: 'Please state the nature of your medical emergency. Step into a Kolto tank if you require immediate healing.'
        }
      }
    ]
  },
  {
    id: 'cantina_lounge',
    title: 'Outer Rim Cantina & VIP Pazaak Lounge',
    category: 'Social / Cantina',
    description: 'Lively cantina setup: Bar counter with drink cylinders, jukebox music console, 3 booth tables with 6 chairs, VIP Pazaak table, and Bartender.',
    recommendedModule: 'danm14aa',
    items: [
      // Bar Counter
      {
        dx: -1.4, dy: 13.0, dz: 0, yawDeg: 180,
        config: {
          name: 'Cantina Bar Counter (Left)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['counter', 'desk', 'table'], scale: 1.2,
          useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_i_medeqpmnt01'],
          barkText: '[Cantina Bar]: Corellian ale and Tarisianitzel on tap.'
        }
      },
      {
        dx: 1.4, dy: 13.0, dz: 0, yawDeg: 180,
        config: {
          name: 'Cantina Bar Counter (Right)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['counter', 'desk', 'table'], scale: 1.2,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Cantina Bar]: Wipe marks from countless smugglers and bounty hunters.'
        }
      },
      {
        dx: -3.2, dy: 14.2, dz: 0, yawDeg: 180,
        config: {
          name: 'Cantina Jukebox Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'panel', 'terminal'], scale: 0.95,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Jukebox]: Playing upbeat Bith cantina swing music across the lounge!'
        }
      },
      // Booth 1 (Left)
      {
        dx: -4.2, dy: 7.5, dz: 0, yawDeg: 0,
        config: {
          name: 'Cantina Booth Table West', category: 'Office & Furniture', appearanceId: 45, modelKeywords: ['table', 'pazaak', 'desk'], scale: 1.05,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Booth Table]: A shadowy corner booth ideal for clandestine deals.'
        }
      },
      {
        dx: -4.2, dy: 6.3, dz: 0, yawDeg: 0,
        config: {
          name: 'Booth Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: -4.2, dy: 8.7, dz: 0, yawDeg: 180,
        config: {
          name: 'Booth Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      // Booth 2 (Right)
      {
        dx: 4.2, dy: 7.5, dz: 0, yawDeg: 0,
        config: {
          name: 'VIP Pazaak Table East', category: 'Office & Furniture', appearanceId: 45, modelKeywords: ['pazaak', 'table', 'desk'], scale: 1.05,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
          barkText: '[Pazaak Table]: High-stakes Pazaak den — pure +/- decks welcome.'
        }
      },
      {
        dx: 4.2, dy: 6.3, dz: 0, yawDeg: 0,
        config: {
          name: 'Pazaak Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      },
      {
        dx: 4.2, dy: 8.7, dz: 0, yawDeg: 180,
        config: {
          name: 'Pazaak Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
          useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
        }
      }
    ],
    creatures: [
      {
        dx: 0, dy: 14.3, dz: 0, yawDeg: 180,
        config: {
          name: 'Twi\'lek Cantina Bartender', templateResRef: 'n_twilekf', appearanceId: 47, factionId: 5, hp: 55, level: 4, classId: 2,
          barkText: 'Welcome to the cantina! Keep your blasters holstered and pay your tab.'
        }
      }
    ]
  },
  {
    id: 'cargo_warehouse',
    title: 'Smuggler\'s Cargo Warehouse & Armory',
    category: 'Industrial / Cargo',
    description: 'Multi-level stacked cargo crates, plasteel cylinders, quartermaster manifest desk, upgrade workbench, and locked contraband vault.',
    recommendedModule: 'danm14aa',
    items: [
      {
        dx: -3.5, dy: 7.5, dz: 0, yawDeg: 15,
        config: {
          name: 'Heavy Cargo Crate 101', category: 'Storage & Cargo', appearanceId: 51, modelKeywords: ['crate', 'cargo', 'box'], scale: 1.25,
          useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_w_blstrrfl001', 'g_i_medeqpmnt01']
        }
      },
      {
        dx: -3.5, dy: 7.5, dz: 1.15, yawDeg: -10,
        config: {
          name: 'Stacked Upper Cargo Crate 102', category: 'Storage & Cargo', appearanceId: 51, modelKeywords: ['crate', 'cargo', 'box'], scale: 1.05, zOffset: 1.15,
          useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_secspike01', 'g_i_progspike01']
        }
      },
      {
        dx: 3.5, dy: 7.5, dz: 0, yawDeg: -20,
        config: {
          name: 'Heavy Cargo Crate 201', category: 'Storage & Cargo', appearanceId: 51, modelKeywords: ['crate', 'cargo', 'box'], scale: 1.25,
          useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_w_vbroswrd01']
        }
      },
      {
        dx: 3.5, dy: 9.8, dz: 0, yawDeg: 0,
        config: {
          name: 'Plasteel Contraband Cylinder', category: 'Storage & Cargo', appearanceId: 53, modelKeywords: ['cylinder', 'plasteel', 'canister'], scale: 1.1,
          useable: true, hasInventory: true, locked: false, openLockDC: 15, lootResRefs: ['g_w_hvrptbltr01', 'g_a_class6001']
        }
      },
      {
        dx: -3.5, dy: 10.5, dz: 0, yawDeg: 90,
        config: {
          name: 'Smuggler Upgrade Workbench', category: 'Storage & Cargo', appearanceId: 68, modelKeywords: ['workbench', 'bench'], scale: 1.1,
          useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_w_lghtsbr04', 'g_w_blstrpstl001'],
          barkText: '[Smuggler Workbench]: Custom illegal blaster & lightsaber modifications.'
        }
      },
      {
        dx: 0, dy: 12.5, dz: 0, yawDeg: 180,
        config: {
          name: 'Quartermaster Manifest Desk', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.1,
          useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_progspike01'],
          barkText: '[Manifest Desk]: Smuggling route logs for the Outer Rim.'
        }
      },
      {
        dx: 1.8, dy: 12.8, dz: 0, yawDeg: 180,
        config: {
          name: 'Locked Contraband Vault (DC 18)', category: 'Storage & Cargo', appearanceId: 54, modelKeywords: ['safe', 'vault', 'metal', 'box'], scale: 1.15,
          useable: true, hasInventory: true, locked: true, openLockDC: 18,
          lootResRefs: ['g_w_dblsbr001', 'g_w_lghtsbr05', 'g_a_mstrrobe01', 'g_i_medeqpmnt03'],
          barkText: '[Contraband Vault]: High-value Exchange shipment.'
        }
      }
    ],
    creatures: [
      {
        dx: 0, dy: 13.7, dz: 0, yawDeg: 180,
        config: {
          name: 'Warehouse Quartermaster', templateResRef: 'n_smuggler', appearanceId: 179, factionId: 5, hp: 90, level: 7, classId: 2, rightHandResRef: 'g_w_blstrpstl001',
          barkText: 'Don\'t touch the crates unless you\'ve got credits or clearance from the boss.'
        }
      }
    ]
  }
];
