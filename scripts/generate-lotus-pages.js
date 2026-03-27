#!/usr/bin/env node
/**
 * @deprecated Use scripts/generate-pages.js instead — the universal page generator
 * handles all makes from models.json without needing per-make scripts.
 *
 * generate-lotus-pages.js
 *
 * Generates blank listing pages for 20 road-legal Lotus models by reading the
 * Ferrari 458 page as a template and performing targeted string replacements.
 *
 * Also creates empty data JSON files and updates data/models.json WITH
 * scraper source configurations.
 *
 * Usage:  ~/bin/node scripts/generate-lotus-pages.js
 *         ~/bin/node scripts/generate-lotus-pages.js --force   (overwrite existing)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'public/cars/ferrari-458/index.html');
const MODELS_JSON_PATH = path.join(ROOT, 'data/models.json');

// ---------------------------------------------------------------------------
// 20 model configurations
// ---------------------------------------------------------------------------

const MODELS = [
  {
    slug: 'seven',
    displayName: 'Seven',
    fullName: 'Lotus Seven',
    heroYears: '1957 — 1972',
    heroEngine: '1.0 — 1.6L I4',
    heroBhp: '40 — 115 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/1963_Lotus_Seven_Series_2.jpg/1920px-1963_Lotus_Seven_Series_2.jpg',
    heroCredit: 'Calreyn88 / CC BY-SA 4.0',
    description: 'The Lotus Seven, produced from 1957 to 1972, is the iconic lightweight sports car that defined the kit car genre. Designed by Colin Chapman, its minimalist aluminium-panelled body and tubular steel chassis delivered extraordinary performance at low cost. After Lotus ceased production, the design was licensed to Caterham Cars.',
    getBody: `return 'convertible';`,
    getVariant: `if (/s4|series\\s*4/i.test(title)) return 's4';
      if (/s3|series\\s*3/i.test(title)) return 's3';
      if (/s2|series\\s*2/i.test(title)) return 's2';
      if (/s1|series\\s*1/i.test(title)) return 's1';
      return 'seven';`,
    getTransmission: `return 'manual';`,
    variantLabels: { seven: 'Seven', s1: 'Series 1', s2: 'Series 2', s3: 'Series 3', s4: 'Series 4' },
    variantOrder: ['seven', 's1', 's2', 's3', 's4'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/seven' },
      carsandclassic: { makeId: 29, model: 'seven' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Seven' },
    },
  },
  {
    slug: 'elite-type-14',
    displayName: 'Elite (Type 14)',
    fullName: 'Lotus Elite (Type 14)',
    heroYears: '1957 — 1963',
    heroEngine: '1.2L I4',
    heroBhp: '75 — 105 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Lotus_Elite_Reg_1962_1460_cc.JPG/1920px-Lotus_Elite_Reg_1962_1460_cc.JPG',
    heroCredit: 'Charles01 / CC BY-SA 3.0',
    description: 'The Lotus Elite (Type 14), produced from 1957 to 1963, was the world\'s first fibreglass monocoque production car. Powered by a Coventry Climax 1.2-litre engine, it combined stunning aerodynamics with a featherweight chassis to dominate its class at Le Mans. Around 1,030 were built, making it a prized collector\'s piece.',
    getBody: `return 'coupe';`,
    getVariant: `if (/super\\s*95/i.test(title)) return 'super95';
      if (/super\\s*100/i.test(title)) return 'super100';
      if (/super\\s*105/i.test(title)) return 'super105';
      return 'elite';`,
    getTransmission: `return 'manual';`,
    variantLabels: { elite: 'Elite', super95: 'Super 95', super100: 'Super 100', super105: 'Super 105' },
    variantOrder: ['elite', 'super95', 'super100', 'super105'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      carsandclassic: { makeId: 29, model: 'elite' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Elite' },
    },
  },
  {
    slug: 'elan',
    displayName: 'Elan',
    fullName: 'Lotus Elan',
    heroYears: '1962 — 1975',
    heroEngine: '1.6L I4',
    heroBhp: '105 — 126 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/XBY212F_1968_Lotus_Elan.jpg/1920px-XBY212F_1968_Lotus_Elan.jpg',
    heroCredit: 'kitmasterbloke / CC BY 2.0',
    description: 'The Lotus Elan, produced from 1962 to 1975, is regarded as one of the finest handling sports cars ever made. Its backbone chassis, all-independent suspension and twin-cam 1.6-litre engine set the template for every Lotus that followed. Available as both roadster and fixed-head coupe, with the Sprint being the most desirable variant.',
    getBody: `if (/dhc|drop\\s*head|roadster|convertible|spider/i.test(title)) return 'convertible';
      if (/fhc|fixed\\s*head|coupe/i.test(title)) return 'coupe';
      return null;`,
    getVariant: `if (/sprint/i.test(title)) return 'sprint';
      if (/\\+2|plus\\s*2/i.test(title)) return 'plus2';
      if (/s4|series\\s*4/i.test(title)) return 's4';
      if (/s3|series\\s*3/i.test(title)) return 's3';
      if (/s2|series\\s*2/i.test(title)) return 's2';
      if (/s1|series\\s*1/i.test(title)) return 's1';
      return 'elan';`,
    getTransmission: `return 'manual';`,
    variantLabels: { elan: 'Elan', s1: 'S1', s2: 'S2', s3: 'S3', s4: 'S4', sprint: 'Sprint', plus2: '+2' },
    variantOrder: ['elan', 's1', 's2', 's3', 's4', 'sprint', 'plus2'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/elan' },
      carsandclassic: { makeId: 29, model: 'elan' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Elan' },
    },
  },
  {
    slug: 'europa',
    displayName: 'Europa',
    fullName: 'Lotus Europa',
    heroYears: '1966 — 1975',
    heroEngine: '1.5 — 1.6L I4',
    heroBhp: '78 — 126 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/1966_Lotus_Europa_Series_1_%2815622859369%29.jpg/1920px-1966_Lotus_Europa_Series_1_%2815622859369%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY 2.0',
    description: 'The Lotus Europa, produced from 1966 to 1975, was the first affordable mid-engined road car. Its radical styling by Ron Hickman and race-bred chassis made it a favourite among enthusiasts. The twin-cam Special is the most sought-after variant, offering 126 bhp and a close-ratio five-speed gearbox.',
    getBody: `return 'coupe';`,
    getVariant: `if (/special|twin\\s*cam/i.test(title)) return 'special';
      if (/s2|series\\s*2/i.test(title)) return 's2';
      if (/s1|series\\s*1/i.test(title)) return 's1';
      return 'europa';`,
    getTransmission: `return 'manual';`,
    variantLabels: { europa: 'Europa', s1: 'S1', s2: 'S2', special: 'Special' },
    variantOrder: ['europa', 's1', 's2', 'special'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/europa' },
      carsandclassic: { makeId: 29, model: 'europa' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Europa' },
    },
  },
  {
    slug: 'elite',
    displayName: 'Elite',
    fullName: 'Lotus Elite',
    heroYears: '1974 — 1982',
    heroEngine: '2.0 — 2.2L I4',
    heroBhp: '155 — 174 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Lotus_Elite_registered_June_1979_1973cc.JPG/1920px-Lotus_Elite_registered_June_1979_1973cc.JPG',
    heroCredit: 'Charles01 / CC BY-SA 4.0',
    description: 'The Lotus Elite (Type 75), produced from 1974 to 1982, was Lotus\'s ambitious move into the GT market. A 2+2 coupe with a fibreglass body bonded to a backbone chassis, it featured the Lotus 907 slant-four engine and offered a level of refinement new to the marque. It was the basis for the Eclat and later the Excel.',
    getBody: `return 'coupe';`,
    getVariant: `if (/riviera/i.test(title)) return 'riviera';
      return 'elite';`,
    getTransmission: `if (/auto/i.test(title)) return 'automatic';
      return 'manual';`,
    variantLabels: { elite: 'Elite', riviera: 'Riviera' },
    variantOrder: ['elite', 'riviera'],
    transmissionLabels: { manual: 'Manual', automatic: 'Automatic' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      carsandclassic: { makeId: 29, model: 'elite' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Elite' },
    },
  },
  {
    slug: 'eclat',
    displayName: 'Eclat',
    fullName: 'Lotus Eclat',
    heroYears: '1975 — 1982',
    heroEngine: '2.0 — 2.2L I4',
    heroBhp: '160 — 174 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Lotus_Eclat_reg_1979_1973_cc.JPG/1920px-Lotus_Eclat_reg_1979_1973_cc.JPG',
    heroCredit: 'Charles01 / CC BY-SA 3.0',
    description: 'The Lotus Eclat, produced from 1975 to 1982, was the fastback sibling to the Elite. Sharing the same backbone chassis and 2.0/2.2-litre slant-four engine, its sleeker two-door body offered a sportier character. The Riviera and Excel-spec versions with improved interior trim are the most collectible.',
    getBody: `return 'coupe';`,
    getVariant: `if (/riviera/i.test(title)) return 'riviera';
      if (/excel/i.test(title)) return 'excel';
      return 'eclat';`,
    getTransmission: `if (/auto/i.test(title)) return 'automatic';
      return 'manual';`,
    variantLabels: { eclat: 'Eclat', riviera: 'Riviera', excel: 'Excel' },
    variantOrder: ['eclat', 'riviera', 'excel'],
    transmissionLabels: { manual: 'Manual', automatic: 'Automatic' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      carsandclassic: { makeId: 29, model: 'eclat' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Eclat' },
    },
  },
  {
    slug: 'esprit',
    displayName: 'Esprit',
    fullName: 'Lotus Esprit',
    heroYears: '1976 — 2004',
    heroEngine: '2.0 — 3.5L I4 / V8',
    heroBhp: '160 — 500 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Lotus_Esprit_S4_registered_August_1998_1974cc.JPG/1920px-Lotus_Esprit_S4_registered_August_1998_1974cc.JPG',
    heroCredit: 'Charles01 / CC BY-SA 4.0',
    description: 'The Lotus Esprit, produced from 1976 to 2004, is one of the most recognisable supercars of the 20th century. Styled by Giorgetto Giugiaro and later Peter Stevens, it evolved from the wedge-shaped S1 through to the rounded V8 twin-turbo producing 500 bhp. Its appearance in The Spy Who Loved Me cemented its icon status.',
    getBody: `return 'coupe';`,
    getVariant: `if (/\\bv8\\b/i.test(title)) return 'v8';
      if (/\\bgt3\\b/i.test(title)) return 'gt3';
      if (/turbo\\s*se/i.test(title)) return 'turbo-se';
      if (/turbo/i.test(title)) return 'turbo';
      if (/\\bs4s\\b/i.test(title)) return 's4s';
      if (/\\bs4\\b|series\\s*4/i.test(title)) return 's4';
      if (/\\bs3\\b|series\\s*3/i.test(title)) return 's3';
      if (/\\bs2\\.2\\b/i.test(title)) return 's2.2';
      if (/\\bs2\\b|series\\s*2/i.test(title)) return 's2';
      if (/\\bs1\\b|series\\s*1/i.test(title)) return 's1';
      return 'esprit';`,
    getTransmission: `return 'manual';`,
    variantLabels: { esprit: 'Esprit', s1: 'S1', s2: 'S2', 's2.2': 'S2.2', s3: 'S3', s4: 'S4', s4s: 'S4s', turbo: 'Turbo', 'turbo-se': 'Turbo SE', gt3: 'GT3', v8: 'V8' },
    variantOrder: ['esprit', 's1', 's2', 's2.2', 's3', 's4', 's4s', 'turbo', 'turbo-se', 'gt3', 'v8'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/esprit' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/esprit' },
      carsandclassic: { makeId: 29, model: 'esprit' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Esprit' },
    },
  },
  {
    slug: 'excel',
    displayName: 'Excel',
    fullName: 'Lotus Excel',
    heroYears: '1982 — 1992',
    heroEngine: '2.2L I4',
    heroBhp: '160 — 180 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/1985_Lotus_Excel_%2815222453991%29.jpg/1920px-1985_Lotus_Excel_%2815222453991%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY 2.0',
    description: 'The Lotus Excel, produced from 1982 to 1992, was the final evolution of the Elite/Eclat platform. It featured the 2.2-litre slant-four engine mated to a Toyota five-speed gearbox, improving reliability considerably. The SE model with 180 bhp and the rare SA automatic are the most notable variants.',
    getBody: `return 'coupe';`,
    getVariant: `if (/\\bse\\b/i.test(title)) return 'se';
      if (/\\bsa\\b/i.test(title)) return 'sa';
      return 'excel';`,
    getTransmission: `if (/auto|\\bsa\\b/i.test(title)) return 'automatic';
      return 'manual';`,
    variantLabels: { excel: 'Excel', se: 'SE', sa: 'SA' },
    variantOrder: ['excel', 'se', 'sa'],
    transmissionLabels: { manual: 'Manual', automatic: 'Automatic' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      carsandclassic: { makeId: 29, model: 'excel' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Excel' },
    },
  },
  {
    slug: 'elan-m100',
    displayName: 'Elan M100',
    fullName: 'Lotus Elan M100',
    heroYears: '1989 — 1995',
    heroEngine: '1.6L I4 Turbo',
    heroBhp: '162 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/1995_Lotus_Elan_M100.jpg/1920px-1995_Lotus_Elan_M100.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 4.0',
    description: 'The Lotus Elan M100, produced from 1989 to 1995, was a front-wheel-drive departure from Lotus tradition. Powered by an Isuzu 1.6-litre turbocharged engine, it was engineered to handle so well that its drivetrain layout was irrelevant. The SE turbo model is the one to have, with a loyal following among enthusiasts.',
    getBody: `return 'convertible';`,
    getVariant: `if (/\\bse\\b/i.test(title)) return 'se';
      if (/\\bs2\\b|series\\s*2/i.test(title)) return 's2';
      return 'elan-m100';`,
    getTransmission: `return 'manual';`,
    variantLabels: { 'elan-m100': 'Elan M100', se: 'SE', s2: 'S2' },
    variantOrder: ['elan-m100', 'se', 's2'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/elan' },
      carsandclassic: { makeId: 29, model: 'elan' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Elan' },
    },
  },
  {
    slug: 'carlton',
    displayName: 'Carlton',
    fullName: 'Lotus Carlton',
    heroYears: '1990 — 1992',
    heroEngine: '3.6L I6 Twin-Turbo',
    heroBhp: '377 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Lotus_Carlton_registered_April_1993_3615cc.JPG/1920px-Lotus_Carlton_registered_April_1993_3615cc.JPG',
    heroCredit: 'Charles01 / CC BY-SA 4.0',
    description: 'The Lotus Carlton, produced from 1990 to 1992, was the world\'s fastest production saloon at launch. Based on the Vauxhall Carlton, Lotus fitted a 3.6-litre twin-turbo straight-six producing 377 bhp and a top speed of 176 mph. Just 440 right-hand-drive examples were built, making it hugely collectible.',
    getBody: `return 'saloon';`,
    getVariant: `return 'carlton';`,
    getTransmission: `return 'manual';`,
    variantLabels: { carlton: 'Carlton' },
    variantOrder: ['carlton'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { saloon: 'Saloon' },
    bodyOrder: ['saloon'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/carlton' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/carlton' },
      carsandclassic: { makeId: 29, model: 'carlton' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Carlton' },
    },
  },
  {
    slug: 'elise',
    displayName: 'Elise',
    fullName: 'Lotus Elise',
    heroYears: '1996 — 2021',
    heroEngine: '1.6 — 1.8L I4',
    heroBhp: '118 — 243 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Lotus_Elise_Serie_1_(2019-06-02_Sp_r).JPG/1920px-Lotus_Elise_Serie_1_(2019-06-02_Sp_r).JPG',
    heroCredit: 'Lothar Spurzem / CC BY-SA 2.0 DE',
    description: 'The Lotus Elise, produced from 1996 to 2021, revolutionised lightweight sports car design with its bonded aluminium chassis. Across three series it remained true to Colin Chapman\'s ethos of simplicity and lightness, with the Cup and Sport variants offering stripped-out track focus. One of the most popular Lotuses ever made.',
    getBody: `return 'convertible';`,
    getVariant: `if (/cup\\s*250/i.test(title)) return 'cup-250';
      if (/cup\\s*220/i.test(title)) return 'cup-220';
      if (/cup/i.test(title)) return 'cup';
      if (/sport\\s*220/i.test(title)) return 'sport-220';
      if (/sport/i.test(title)) return 'sport';
      if (/\\b111[sr]\\b/i.test(title)) return '111';
      if (/\\bs3\\b|series\\s*3/i.test(title)) return 's3';
      if (/\\bs2\\b|series\\s*2/i.test(title)) return 's2';
      if (/\\bs1\\b|series\\s*1/i.test(title)) return 's1';
      return 'elise';`,
    getTransmission: `return 'manual';`,
    variantLabels: { elise: 'Elise', s1: 'S1', s2: 'S2', s3: 'S3', '111': '111S/R', sport: 'Sport', 'sport-220': 'Sport 220', cup: 'Cup', 'cup-220': 'Cup 220', 'cup-250': 'Cup 250' },
    variantOrder: ['elise', 's1', 's2', 's3', '111', 'sport', 'sport-220', 'cup', 'cup-220', 'cup-250'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/elise' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/elise' },
      carsandclassic: { makeId: 29, model: 'elise' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Elise' },
    },
  },
  {
    slug: '340r',
    displayName: '340R',
    fullName: 'Lotus 340R',
    heroYears: '2000',
    heroEngine: '1.8L I4',
    heroBhp: '177 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Lotus_340r_car.jpg/1920px-Lotus_340r_car.jpg',
    heroCredit: 'Wikimedia Commons',
    description: 'The Lotus 340R, built in 2000, is a limited-edition open-top sports car based on the Elise platform. With its striking exposed body panels and Rover K-Series 1.8-litre engine producing 177 bhp in a car weighing just 701 kg, it offered supercar-rivalling performance. Exactly 340 were built, all pre-sold.',
    getBody: `return 'convertible';`,
    getVariant: `return '340r';`,
    getTransmission: `return 'manual';`,
    variantLabels: { '340r': '340R' },
    variantOrder: ['340r'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/340r' },
      carsandclassic: { makeId: 29, model: '340r' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=340R' },
    },
  },
  {
    slug: 'exige',
    displayName: 'Exige',
    fullName: 'Lotus Exige',
    heroYears: '2000 — 2021',
    heroEngine: '1.8L I4 / 3.5L V6',
    heroBhp: '177 — 430 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Side_view_-Lotus_Exige_S_(Grey).JPG/1920px-Side_view_-Lotus_Exige_S_(Grey).JPG',
    heroCredit: 'Wikimedia Commons / CC BY-SA 3.0',
    description: 'The Lotus Exige, produced from 2000 to 2021, is the hardtop, track-focused sibling of the Elise. Across three series it evolved from a Rover K-Series-powered lightweight to a supercharged Toyota V6 powerhouse. The final Sport 390 and Cup 430 editions are among the most focused road cars Lotus ever built.',
    getBody: `if (/roadster|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/cup\\s*430/i.test(title)) return 'cup-430';
      if (/cup\\s*380/i.test(title)) return 'cup-380';
      if (/cup/i.test(title)) return 'cup';
      if (/sport\\s*410/i.test(title)) return 'sport-410';
      if (/sport\\s*390/i.test(title)) return 'sport-390';
      if (/sport\\s*380/i.test(title)) return 'sport-380';
      if (/sport\\s*350/i.test(title)) return 'sport-350';
      if (/sport/i.test(title)) return 'sport';
      if (/\\bs3\\b|\\bv6\\b/i.test(title)) return 's3';
      if (/\\bs2\\b|series\\s*2/i.test(title)) return 's2';
      if (/\\bs1\\b|series\\s*1/i.test(title)) return 's1';
      return 'exige';`,
    getTransmission: `return 'manual';`,
    variantLabels: { exige: 'Exige', s1: 'S1', s2: 'S2', s3: 'S3/V6', sport: 'Sport', 'sport-350': 'Sport 350', 'sport-380': 'Sport 380', 'sport-390': 'Sport 390', 'sport-410': 'Sport 410', cup: 'Cup', 'cup-380': 'Cup 380', 'cup-430': 'Cup 430' },
    variantOrder: ['exige', 's1', 's2', 's3', 'sport', 'sport-350', 'sport-380', 'sport-390', 'sport-410', 'cup', 'cup-380', 'cup-430'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/exige' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/exige' },
      carsandclassic: { makeId: 29, model: 'exige' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Exige' },
    },
  },
  {
    slug: 'europa-s',
    displayName: 'Europa S',
    fullName: 'Lotus Europa S',
    heroYears: '2006 — 2010',
    heroEngine: '2.0L I4 Turbo',
    heroBhp: '200 — 225 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/2007_Lotus_Europa_S_2.0_Front.jpg/1920px-2007_Lotus_Europa_S_2.0_Front.jpg',
    heroCredit: 'Wikimedia Commons',
    description: 'The Lotus Europa S, produced from 2006 to 2010, was a GT car based on the Elise platform. Its 2.0-litre turbocharged engine and fixed-roof coupe body offered a more refined, long-distance alternative to the Elise and Exige. The SE model with 225 bhp and uprated brakes is the pick of the range.',
    getBody: `return 'coupe';`,
    getVariant: `if (/\\bse\\b/i.test(title)) return 'se';
      return 'europa-s';`,
    getTransmission: `return 'manual';`,
    variantLabels: { 'europa-s': 'Europa S', se: 'SE' },
    variantOrder: ['europa-s', 'se'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/europa' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/europa' },
      carsandclassic: { makeId: 29, model: 'europa' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Europa' },
    },
  },
  {
    slug: '2-eleven',
    displayName: '2-Eleven',
    fullName: 'Lotus 2-Eleven',
    heroYears: '2007 — 2011',
    heroEngine: '1.8L I4 Supercharged',
    heroBhp: '252 — 266 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Lotus_2-Eleven_-_Flickr_-_exfordy.jpg/1920px-Lotus_2-Eleven_-_Flickr_-_exfordy.jpg',
    heroCredit: 'Brian Snelson / CC BY 2.0',
    description: 'The Lotus 2-Eleven, produced from 2007 to 2011, is an open-cockpit track car with a road-legal variant. Powered by a supercharged Toyota 1.8-litre engine producing up to 266 bhp in a car weighing just 670 kg, it was the fastest road-legal Lotus at the time. Around 400 were built across road and track specifications.',
    getBody: `return 'convertible';`,
    getVariant: `if (/road/i.test(title)) return 'road';
      if (/track|gt4/i.test(title)) return 'track';
      return '2-eleven';`,
    getTransmission: `return 'manual';`,
    variantLabels: { '2-eleven': '2-Eleven', road: 'Road', track: 'Track' },
    variantOrder: ['2-eleven', 'road', 'track'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/2-eleven' },
      carsandclassic: { makeId: 29, model: '2-eleven' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=2-Eleven' },
    },
  },
  {
    slug: 'evora',
    displayName: 'Evora',
    fullName: 'Lotus Evora',
    heroYears: '2009 — 2021',
    heroEngine: '3.5L V6 / V6 Supercharged',
    heroBhp: '276 — 430 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Lotus_Evora_at_Beaulieu.jpg/1920px-Lotus_Evora_at_Beaulieu.jpg',
    heroCredit: 'Wikimedia Commons',
    description: 'The Lotus Evora, produced from 2009 to 2021, was Lotus\'s flagship mid-engined sports car. Powered by a Toyota 3.5-litre V6, the supercharged 400/410/GT430 variants delivered up to 430 bhp. Its blend of everyday usability with Lotus handling precision made it a genuine rival to Porsche\'s 911.',
    getBody: `if (/roadster|convertible|spider/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/gt430/i.test(title)) return 'gt430';
      if (/gt410/i.test(title)) return 'gt410';
      if (/sport\\s*410/i.test(title)) return 'sport-410';
      if (/\\b400\\b/i.test(title)) return '400';
      if (/\\bs\\b/i.test(title)) return 's';
      return 'evora';`,
    getTransmission: `if (/auto|ipc/i.test(title)) return 'automatic';
      return 'manual';`,
    variantLabels: { evora: 'Evora', s: 'S', '400': '400', 'sport-410': 'Sport 410', gt410: 'GT410', gt430: 'GT430' },
    variantOrder: ['evora', 's', '400', 'sport-410', 'gt410', 'gt430'],
    transmissionLabels: { manual: 'Manual', automatic: 'Automatic' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/evora' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/evora' },
      carsandclassic: { makeId: 29, model: 'evora' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Evora' },
    },
  },
  {
    slug: '3-eleven',
    displayName: '3-Eleven',
    fullName: 'Lotus 3-Eleven',
    heroYears: '2015 — 2017',
    heroEngine: '3.5L V6 Supercharged',
    heroBhp: '410 — 450 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Lotus_3-Eleven_(51977933288).jpg/1920px-Lotus_3-Eleven_(51977933288).jpg',
    heroCredit: 'Wikimedia Commons / CC BY 2.0',
    description: 'The Lotus 3-Eleven, produced from 2015 to 2017, was the fastest and most expensive road-legal Lotus of its era. An open-cockpit design powered by a supercharged 3.5-litre V6, it produced up to 450 bhp in track spec. Just 311 were built across road and race specifications.',
    getBody: `return 'convertible';`,
    getVariant: `if (/road/i.test(title)) return 'road';
      if (/race|track/i.test(title)) return 'race';
      return '3-eleven';`,
    getTransmission: `return 'manual';`,
    variantLabels: { '3-eleven': '3-Eleven', road: 'Road', race: 'Race' },
    variantOrder: ['3-eleven', 'road', 'race'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/3-eleven' },
      carsandclassic: { makeId: 29, model: '3-eleven' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=3-Eleven' },
    },
  },
  {
    slug: 'emira',
    displayName: 'Emira',
    fullName: 'Lotus Emira',
    heroYears: '2022 — present',
    heroEngine: '2.0L I4 Turbo / 3.5L V6',
    heroBhp: '360 — 400 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/The_frontview_of_Lotus_EMIRA_(type_131).jpg/1920px-The_frontview_of_Lotus_EMIRA_(type_131).jpg',
    heroCredit: 'Wikimedia Commons',
    description: 'The Lotus Emira, launched in 2022, is Lotus\'s last petrol-powered sports car. Available with either a Mercedes-AMG 2.0-litre turbo four or Toyota 3.5-litre supercharged V6, it combines classic Lotus handling with a more refined interior. The V6 First Edition was the launch model, with the I4 following.',
    getBody: `return 'coupe';`,
    getVariant: `if (/\\bv6\\b|first\\s*edition/i.test(title)) return 'v6';
      if (/\\bi4\\b|2\\.0/i.test(title)) return 'i4';
      return 'emira';`,
    getTransmission: `if (/auto|dct/i.test(title)) return 'automatic';
      return 'manual';`,
    variantLabels: { emira: 'Emira', v6: 'V6', i4: 'I4' },
    variantOrder: ['emira', 'v6', 'i4'],
    transmissionLabels: { manual: 'Manual', automatic: 'DCT' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/emira' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/emira' },
      carsandclassic: { makeId: 29, model: 'emira' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Emira' },
    },
  },
  {
    slug: 'eletre',
    displayName: 'Eletre',
    fullName: 'Lotus Eletre',
    heroYears: '2023 — present',
    heroEngine: 'Dual Electric Motors',
    heroBhp: '603 — 905 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/2022_Lotus_Eletre_(37479).jpg/1920px-2022_Lotus_Eletre_(37479).jpg',
    heroCredit: 'Wikimedia Commons',
    description: 'The Lotus Eletre, delivered from 2023, is Lotus\'s first SUV and first fully electric production car. Built on a dedicated EV platform, it produces up to 905 bhp in R+ guise with a 0-62 time of 2.95 seconds. Its active aerodynamics and lidar sensors represent a new chapter for the marque.',
    getBody: `return 'suv';`,
    getVariant: `if (/r\\+/i.test(title)) return 'r-plus';
      if (/\\br\\b/i.test(title)) return 'r';
      if (/\\bs\\b/i.test(title)) return 's';
      return 'eletre';`,
    getTransmission: `return 'automatic';`,
    variantLabels: { eletre: 'Eletre', s: 'S', r: 'R', 'r-plus': 'R+' },
    variantOrder: ['eletre', 's', 'r', 'r-plus'],
    transmissionLabels: { automatic: 'Automatic' },
    transmissionOrder: ['automatic'],
    bodyLabels: { suv: 'SUV' },
    bodyOrder: ['suv'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/eletre' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/eletre' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Eletre' },
    },
  },
  {
    slug: 'emeya',
    displayName: 'Emeya',
    fullName: 'Lotus Emeya',
    heroYears: '2024 — present',
    heroEngine: 'Dual Electric Motors',
    heroBhp: '603 — 905 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Lotus_Emeya_001.jpg/1920px-Lotus_Emeya_001.jpg',
    heroCredit: 'Wikimedia Commons',
    description: 'The Lotus Emeya, delivered from 2024, is Lotus\'s all-electric four-door GT. Sharing its platform with the Eletre, it produces up to 905 bhp in R+ form and features active aerodynamics, lidar and a 102 kWh battery. It represents Lotus\'s vision for high-performance electric grand touring.',
    getBody: `return 'saloon';`,
    getVariant: `if (/r\\+/i.test(title)) return 'r-plus';
      if (/\\br\\b/i.test(title)) return 'r';
      if (/\\bs\\b/i.test(title)) return 's';
      return 'emeya';`,
    getTransmission: `return 'automatic';`,
    variantLabels: { emeya: 'Emeya', s: 'S', r: 'R', 'r-plus': 'R+' },
    variantOrder: ['emeya', 's', 'r', 'r-plus'],
    transmissionLabels: { automatic: 'Automatic' },
    transmissionOrder: ['automatic'],
    bodyLabels: { saloon: 'Saloon' },
    bodyOrder: ['saloon'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/lotus/emeya' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/lotus/emeya' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=Lotus&model=Emeya' },
    },
  },
];

// ---------------------------------------------------------------------------
// Template transformation
// ---------------------------------------------------------------------------

const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

function generatePage(model) {
  let html = template;

  // A. <title> tag
  html = html.replace(
    /<title>Ferrari 458 Listings — Collectorly<\/title>/,
    `<title>${model.fullName} Listings \u2014 Collectorly</title>`
  );

  // B. Hero banner
  html = html.replace(
    /alt="Ferrari 458"/,
    `alt="${model.fullName}"`
  );
  html = html.replace(
    /<h1 class="hero-model-name">Ferrari 458<\/h1>/,
    `<h1 class="hero-model-name">${model.fullName}</h1>`
  );
  html = html.replace(
    /<p class="hero-model-years">2009 — 2015 &middot; 4\.5L V8 &middot; 562 BHP<\/p>/,
    `<p class="hero-model-years">${model.heroYears} &middot; ${model.heroEngine} &middot; ${model.heroBhp}</p>`
  );

  // C. Analysis link
  html = html.replace(
    /href="\/analysis\/ferrari-458"/,
    `href="/analysis/lotus-${model.slug}"`
  );

  // D. Auction empty text
  html = html.replace(
    /No Ferrari 458 auctions/,
    `No ${model.fullName} auctions`
  );

  // E. API fetch URL
  html = html.replace(
    /fetch\('\/api\/listings\/ferrari-458'\)/,
    `fetch('/api/listings/lotus-${model.slug}')`
  );

  // F. getBody(), getVariant(), getTransmissionGroup() functions
  html = html.replace(
    /function getBody\(title\) \{[\s\S]*?\n    \}\n/,
    `function getBody(title) {\n      ${model.getBody}\n    }\n`
  );

  html = html.replace(
    /function getVariant\(title\) \{[^}]+\}/,
    `function getVariant(title) {\n      ${model.getVariant}\n    }`
  );

  html = html.replace(
    /function getTransmissionGroup\(str\) \{[^}]+\}/,
    `function getTransmissionGroup(str) {\n      if (!str) return '${model.transmissionOrder[0]}';\n      ${model.getTransmission}\n    }`
  );

  // G. FILTER_CONFIG
  const variantLabelsStr = JSON.stringify(model.variantLabels);
  const variantOrderStr = JSON.stringify(model.variantOrder);
  const bodyLabelsStr = JSON.stringify(model.bodyLabels);
  const bodyOrderStr = JSON.stringify(model.bodyOrder);
  const transLabelsStr = JSON.stringify(model.transmissionLabels);
  const transOrderStr = JSON.stringify(model.transmissionOrder);

  const hasMultipleBodies = Object.keys(model.bodyLabels).length >= 2;
  const bodyMinDistinct = hasMultipleBodies ? '' : ', minDistinct: 2';

  const newFilterConfig = `const FILTER_CONFIG = {
      year:         { detect: l => l.year ? String(l.year) : null, labels: {}, sortOrder: null, mode: 'multi' },
      body:         { detect: l => (l.bodyType || '').toLowerCase() || getBody(l.title), labels: ${bodyLabelsStr}, sortOrder: ${bodyOrderStr}, mode: 'single'${bodyMinDistinct} },
      variant:      { detect: l => getVariant(l.title), labels: ${variantLabelsStr}, sortOrder: ${variantOrderStr}, mode: 'single', minDistinct: 2 },
      transmission: { detect: l => getTransmissionGroup(l.transmission), labels: ${transLabelsStr}, sortOrder: ${transOrderStr}, mode: 'single' },
      source:       { detect: l => (l.sources||[]).map(s => s.name), labels: {}, sortOrder: ['PistonHeads','AutoTrader','Cars & Classic'], mode: 'single', isMultiValue: true },
    }`;

  html = html.replace(
    /const FILTER_CONFIG = \{[\s\S]*?\n    \}/,
    newFilterConfig
  );

  return html;
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

console.log('=== Lotus Page Generator ===\n');

// Verify template exists
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error(`Template not found: ${TEMPLATE_PATH}`);
  process.exit(1);
}

// Track what we create
let pagesCreated = 0;
let dataFilesCreated = 0;
let historyFilesCreated = 0;
const errors = [];

// Generate pages
for (const model of MODELS) {
  const slug = `lotus-${model.slug}`;
  const pageDir = path.join(ROOT, 'public/cars', slug);
  const pagePath = path.join(pageDir, 'index.html');
  const dataPath = path.join(ROOT, 'data', `${slug}.json`);
  const historyPath = path.join(ROOT, 'data/history', `${slug}.json`);

  // Skip if page already exists (use --force to overwrite)
  if (fs.existsSync(pagePath) && !process.argv.includes('--force')) {
    console.log(`  SKIP  ${slug} (page already exists)`);
    continue;
  }

  try {
    // Create page directory
    fs.mkdirSync(pageDir, { recursive: true });

    // Generate and write HTML
    const html = generatePage(model);
    fs.writeFileSync(pagePath, html, 'utf8');
    pagesCreated++;

    // Create data file with metadata if it doesn't exist
    if (!fs.existsSync(dataPath)) {
      const dataContent = {
        model: model.fullName,
        slug,
        heroImage: model.heroImage || '',
        heroCredit: model.heroCredit || '',
        description: model.description,
        listings: [],
      };
      fs.writeFileSync(dataPath, JSON.stringify(dataContent, null, 2), 'utf8');
      dataFilesCreated++;
    }

    // Create history file if it doesn't exist
    if (!fs.existsSync(historyPath)) {
      fs.writeFileSync(historyPath, '[]', 'utf8');
      historyFilesCreated++;
    }

    console.log(`  OK    ${slug}`);
  } catch (err) {
    errors.push({ slug, error: err.message });
    console.error(`  FAIL  ${slug}: ${err.message}`);
  }
}

// Update models.json WITH SOURCES
console.log('\nUpdating models.json...');
const modelsData = JSON.parse(fs.readFileSync(MODELS_JSON_PATH, 'utf8'));
const existingSlugs = new Set(modelsData.models.map(m => m.slug));

let modelsAdded = 0;
for (const model of MODELS) {
  const slug = `lotus-${model.slug}`;
  if (existingSlugs.has(slug)) {
    continue;
  }

  modelsData.models.push({
    slug,
    make: 'Lotus',
    model: model.displayName,
    heroImage: model.heroImage || '',
    heroCredit: model.heroCredit || '',
    description: model.description,
    sources: model.sources,
  });
  modelsAdded++;
}

fs.writeFileSync(MODELS_JSON_PATH, JSON.stringify(modelsData, null, 2), 'utf8');
console.log(`  Added ${modelsAdded} new entries to models.json`);

// Summary
console.log(`\n=== Summary ===`);
console.log(`  Pages created:        ${pagesCreated}`);
console.log(`  Data files created:   ${dataFilesCreated}`);
console.log(`  History files created: ${historyFilesCreated}`);
console.log(`  Models.json added:    ${modelsAdded}`);
console.log(`  Total models.json:    ${modelsData.models.length}`);
if (errors.length > 0) {
  console.log(`  Errors:               ${errors.length}`);
  errors.forEach(e => console.log(`    - ${e.slug}: ${e.error}`));
}
console.log('\nDone!');
