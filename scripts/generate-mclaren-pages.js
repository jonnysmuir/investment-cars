#!/usr/bin/env node
/**
 * generate-mclaren-pages.js
 *
 * Generates blank listing pages for 21 McLaren base models by reading the
 * Ferrari 458 page as a template and performing targeted string replacements.
 *
 * Also creates empty data JSON files and updates data/models.json WITH
 * scraper source configurations (learning from the Ferrari empty-sources mistake).
 *
 * Usage:  /Users/jonnymuir/bin/node scripts/generate-mclaren-pages.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'public/cars/ferrari-458/index.html');
const MODELS_JSON_PATH = path.join(ROOT, 'data/models.json');

// ---------------------------------------------------------------------------
// 21 model configurations (with scraper sources!)
// ---------------------------------------------------------------------------

const MODELS = [
  {
    slug: 'm6gt',
    displayName: 'M6GT',
    fullName: 'McLaren M6GT',
    heroYears: '1969',
    heroEngine: '5.0L V8',
    heroBhp: '370 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren M6GT, built in 1969, was Bruce McLaren\'s attempt to create a road-going version of the dominant M6A Can-Am race car. Powered by a Chevrolet 5.0-litre V8, only three examples were completed before Bruce McLaren\'s tragic death in 1970, making it one of the rarest and most significant McLarens ever built.',
    getBody: `return 'coupe';`,
    getVariant: `return 'm6gt';`,
    getTransmission: `return 'manual';`,
    variantLabels: { m6gt: 'M6GT' },
    variantOrder: ['m6gt'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      carsandclassic: { makeId: 2180, model: 'm6gt' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=M6GT' },
    },
  },
  {
    slug: 'f1',
    displayName: 'F1',
    fullName: 'McLaren F1',
    heroYears: '1992 — 1998',
    heroEngine: '6.1L V12',
    heroBhp: '627 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/McLaren_F1_%2816612tried093%29.jpg/1920px-McLaren_F1_%2816612tried093%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY 2.0',
    description: 'The McLaren F1, produced from 1992 to 1998, is one of the most iconic supercars ever built. Designed by Gordon Murray with a central driving position and a BMW-developed 6.1-litre V12 producing 627 bhp, it held the world speed record for a production car for over a decade. Variants include the ultra-rare LM and GT race homologation specials.',
    getBody: `return 'coupe';`,
    getVariant: `if (/\\bLM\\b/i.test(title)) return 'lm';
      if (/\\bGT\\b/i.test(title)) return 'gt';
      return 'f1';`,
    getTransmission: `return 'manual';`,
    variantLabels: { f1: 'F1', lm: 'LM', gt: 'GT' },
    variantOrder: ['f1', 'lm', 'gt'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/f1' },
      carsandclassic: { makeId: 2180, model: 'f1' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=F1' },
    },
  },
  {
    slug: '12c',
    displayName: '12C',
    fullName: 'McLaren 12C',
    heroYears: '2011 — 2014',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '592 — 625 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/McLaren_MP4-12C_%287480507540%29.jpg/1920px-McLaren_MP4-12C_%287480507540%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY 2.0',
    description: 'The McLaren 12C (originally MP4-12C), produced from 2011 to 2014, was McLaren Automotive\'s first production road car. Powered by a bespoke 3.8-litre twin-turbo V8 producing up to 625 bhp, it featured a carbon fibre MonoCell chassis and was available as both coupe and spider.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: {
        searchUrl: 'https://www.pistonheads.com/buy/mclaren/12c',
        alternateUrls: ['https://www.pistonheads.com/buy/mclaren/12c-spider'],
      },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/12c' },
      carsandclassic: { makeId: 2180, model: 'mp4-12c' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=MP4-12C' },
    },
  },
  {
    slug: 'p1',
    displayName: 'P1',
    fullName: 'McLaren P1',
    heroYears: '2013 — 2015',
    heroEngine: '3.8L V8 Hybrid',
    heroBhp: '903 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/McLaren_P1_%2814482809362%29.jpg/1920px-McLaren_P1_%2814482809362%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 2.0',
    description: 'The McLaren P1, produced from 2013 to 2015, is McLaren\'s first hybrid hypercar and a member of the "Holy Trinity" alongside the LaFerrari and Porsche 918. Combining a 3.8-litre twin-turbo V8 with an electric motor for 903 bhp, only 375 road cars were built. The track-only P1 GTR pushed output to 986 bhp.',
    getBody: `return 'coupe';`,
    getVariant: `if (/GTR/i.test(title)) return 'gtr';
      return 'p1';`,
    getTransmission: `return 'dct';`,
    variantLabels: { p1: 'P1', gtr: 'GTR' },
    variantOrder: ['p1', 'gtr'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/p1' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/p1' },
      carsandclassic: { makeId: 2180, model: 'p1' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=P1' },
    },
  },
  {
    slug: '650s',
    displayName: '650S',
    fullName: 'McLaren 650S',
    heroYears: '2014 — 2017',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '641 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/2015_McLaren_650S_V8_SSG_3.8.jpg/1920px-2015_McLaren_650S_V8_SSG_3.8.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 4.0',
    description: 'The McLaren 650S, produced from 2014 to 2017, replaced the 12C as the core of McLaren\'s Super Series. With 641 bhp from its 3.8-litre twin-turbo V8 and styling influenced by the P1, it was available as both coupe and spider.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      if (/can-am|le\\s*mans/i.test(title)) return 'special';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider', special: 'Special Edition' },
    variantOrder: ['coupe', 'spider', 'special'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: {
        searchUrl: 'https://www.pistonheads.com/buy/mclaren/650s-coupe',
        alternateUrls: ['https://www.pistonheads.com/buy/mclaren/650s-spider'],
      },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/650s' },
      carsandclassic: { makeId: 2180, model: '650s' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=650S' },
    },
  },
  {
    slug: '625c',
    displayName: '625C',
    fullName: 'McLaren 625C',
    heroYears: '2015 — 2016',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '625 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren 625C, produced from 2015 to 2016, was a detuned version of the 650S designed primarily for Asian markets with softer suspension and a more comfort-oriented setup. With 625 bhp from the same 3.8-litre twin-turbo V8, it offered a more refined grand touring experience.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      carsandclassic: { makeId: 2180, model: '625c' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=625C' },
    },
  },
  {
    slug: '675lt',
    displayName: '675LT',
    fullName: 'McLaren 675LT',
    heroYears: '2015 — 2017',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '666 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/McLaren_675LT_%2820738816548%29.jpg/1920px-McLaren_675LT_%2820738816548%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 2.0',
    description: 'The McLaren 675LT, produced from 2015 to 2017, was the first modern McLaren to wear the Longtail badge. With 666 bhp and 100kg lighter than the 650S thanks to extensive use of carbon fibre, it delivered sharper, more track-focused performance. Available as coupe and spider, both limited to 500 units each.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/675lt' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/675lt' },
      carsandclassic: { makeId: 2180, model: '675lt' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=675LT' },
    },
  },
  {
    slug: '540c',
    displayName: '540C',
    fullName: 'McLaren 540C',
    heroYears: '2015 — 2020',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '533 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren 540C, produced from 2015 to 2020, was McLaren\'s most affordable model and the entry point to the Sports Series range. With 533 bhp from the 3.8-litre twin-turbo V8, it offered genuine supercar performance with everyday usability.',
    getBody: `return 'coupe';`,
    getVariant: `return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe' },
    variantOrder: ['coupe'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/540c' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/540c' },
      carsandclassic: { makeId: 2180, model: '540c' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=540C' },
    },
  },
  {
    slug: '570s',
    displayName: '570S',
    fullName: 'McLaren 570S',
    heroYears: '2015 — 2021',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '562 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/McLaren_570S_at_Geneva_Motor_Show_2015.jpg/1920px-McLaren_570S_at_Geneva_Motor_Show_2015.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 4.0',
    description: 'The McLaren 570S, produced from 2015 to 2021, was the most popular Sports Series model. With 562 bhp from the 3.8-litre twin-turbo V8 and McLaren\'s signature carbon fibre MonoCell II chassis, it combined supercar dynamics with daily usability. Available as coupe and spider.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: {
        searchUrl: 'https://www.pistonheads.com/buy/mclaren/570s',
        alternateUrls: ['https://www.pistonheads.com/buy/mclaren/570s-spider'],
      },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/570s' },
      carsandclassic: { makeId: 2180, model: '570s' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=570S' },
    },
  },
  {
    slug: '570gt',
    displayName: '570GT',
    fullName: 'McLaren 570GT',
    heroYears: '2017 — 2021',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '562 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren 570GT, produced from 2017 to 2021, was the grand touring variant of the Sports Series. Sharing the 570S\'s 562 bhp twin-turbo V8, it added a glass-roofed touring deck with 220 litres of luggage space, softer suspension, and enhanced sound insulation for long-distance comfort.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gt';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { gt: 'GT' },
    variantOrder: ['gt'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/570gt' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/570gt' },
      carsandclassic: { makeId: 2180, model: '570gt' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=570GT' },
    },
  },
  {
    slug: '600lt',
    displayName: '600LT',
    fullName: 'McLaren 600LT',
    heroYears: '2018 — 2021',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '592 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/2019_McLaren_600LT_V8_SSG_3.8.jpg/1920px-2019_McLaren_600LT_V8_SSG_3.8.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 4.0',
    description: 'The McLaren 600LT, produced from 2018 to 2021, was the second modern Longtail model. With 592 bhp, top-exit exhausts, and 96kg lighter than the 570S, it delivered an uncompromising track-focused driving experience. Available as coupe and spider.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/600lt' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/600lt' },
      carsandclassic: { makeId: 2180, model: '600lt' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=600LT' },
    },
  },
  {
    slug: '620r',
    displayName: '620R',
    fullName: 'McLaren 620R',
    heroYears: '2019 — 2021',
    heroEngine: '3.8L Twin-Turbo V8',
    heroBhp: '611 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren 620R, produced from 2019 to 2021, was a road-legal version of the 570S GT4 race car. Limited to 350 units worldwide, it featured 611 bhp, full carbon fibre body panels, and race-derived aerodynamics including a large carbon fibre rear wing. A true road-legal race car.',
    getBody: `return 'coupe';`,
    getVariant: `return '620r';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { '620r': '620R' },
    variantOrder: ['620r'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/620r' },
      carsandclassic: { makeId: 2180, model: '620r' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=620R' },
    },
  },
  {
    slug: '720s',
    displayName: '720S',
    fullName: 'McLaren 720S',
    heroYears: '2017 — 2023',
    heroEngine: '4.0L Twin-Turbo V8',
    heroBhp: '710 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/2018_McLaren_720S_V8_SSG_4.0.jpg/1920px-2018_McLaren_720S_V8_SSG_4.0.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 4.0',
    description: 'The McLaren 720S, produced from 2017 to 2023, redefined the Super Series with a new 4.0-litre twin-turbo V8 producing 710 bhp and the innovative Monocage II carbon fibre structure. Widely praised for its combination of performance, comfort, and dramatic design, it was available as coupe and spider.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/720s' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/720s' },
      carsandclassic: { makeId: 2180, model: '720s' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=720S' },
    },
  },
  {
    slug: '765lt',
    displayName: '765LT',
    fullName: 'McLaren 765LT',
    heroYears: '2020 — 2023',
    heroEngine: '4.0L Twin-Turbo V8',
    heroBhp: '755 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren 765LT, produced from 2020 to 2023, was the most extreme Longtail yet. With 755 bhp from the 4.0-litre twin-turbo V8 and 80kg lighter than the 720S, it delivered devastating track performance. Limited to 765 coupes and 765 spiders, both are highly sought after by collectors.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/765lt' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/765lt' },
      carsandclassic: { makeId: 2180, model: '765lt' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=765LT' },
    },
  },
  {
    slug: 'senna',
    displayName: 'Senna',
    fullName: 'McLaren Senna',
    heroYears: '2018 — 2020',
    heroEngine: '4.0L Twin-Turbo V8',
    heroBhp: '789 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/McLaren_Senna_%281%29.jpg/1920px-McLaren_Senna_%281%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 4.0',
    description: 'The McLaren Senna, produced from 2018 to 2020, is the most extreme road-legal McLaren ever built. Named after Ayrton Senna, it produces 789 bhp from its 4.0-litre twin-turbo V8 while weighing just 1,198kg dry. Limited to 500 road cars, with a further 75 track-only GTR variants producing even more downforce.',
    getBody: `return 'coupe';`,
    getVariant: `if (/GTR/i.test(title)) return 'gtr';
      return 'senna';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { senna: 'Senna', gtr: 'GTR' },
    variantOrder: ['senna', 'gtr'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/senna' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/senna' },
      carsandclassic: { makeId: 2180, model: 'senna' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=Senna' },
    },
  },
  {
    slug: 'gt',
    displayName: 'GT',
    fullName: 'McLaren GT',
    heroYears: '2019 — 2023',
    heroEngine: '4.0L Twin-Turbo V8',
    heroBhp: '612 BHP',
    heroImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/McLaren_GT%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS0958%29.jpg/1920px-McLaren_GT%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS0958%29.jpg',
    heroCredit: 'Wikimedia Commons / CC BY-SA 4.0',
    description: 'The McLaren GT, produced from 2019 to 2023, was McLaren\'s first true grand tourer. With 612 bhp from the 4.0-litre twin-turbo V8, a glazed rear luggage bay offering 420 litres of storage, and a focus on long-distance refinement, it aimed to combine supercar performance with genuine GT usability.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gt';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { gt: 'GT' },
    variantOrder: ['gt'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/gt' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/gt' },
      carsandclassic: { makeId: 2180, model: 'gt' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=GT' },
    },
  },
  {
    slug: 'speedtail',
    displayName: 'Speedtail',
    fullName: 'McLaren Speedtail',
    heroYears: '2020',
    heroEngine: '4.0L V8 Hybrid',
    heroBhp: '1,036 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren Speedtail, delivered from 2020, is a three-seat hybrid hyper-GT and the spiritual successor to the F1. With 1,036 bhp from its hybrid V8 powertrain and a top speed of 250 mph, it features a central driving position, teardrop body shape, and flexible carbon fibre rear ailerons. Limited to just 106 examples.',
    getBody: `return 'coupe';`,
    getVariant: `return 'speedtail';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { speedtail: 'Speedtail' },
    variantOrder: ['speedtail'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/speedtail' },
      carsandclassic: { makeId: 2180, model: 'speedtail' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=Speedtail' },
    },
  },
  {
    slug: 'elva',
    displayName: 'Elva',
    fullName: 'McLaren Elva',
    heroYears: '2020',
    heroEngine: '4.0L Twin-Turbo V8',
    heroBhp: '804 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren Elva, delivered from 2020, is a roofless, windscreen-less open-top roadster inspired by the original Bruce McLaren-Elva race cars of the 1960s. With 804 bhp and weighing just 1,148kg, it features an innovative Active Air Management System that deflects air over the cabin. Limited to 149 examples.',
    getBody: `return 'convertible';`,
    getVariant: `return 'elva';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { elva: 'Elva' },
    variantOrder: ['elva'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { convertible: 'Open' },
    bodyOrder: ['convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/elva' },
      carsandclassic: { makeId: 2180, model: 'elva' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=Elva' },
    },
  },
  {
    slug: 'artura',
    displayName: 'Artura',
    fullName: 'McLaren Artura',
    heroYears: '2022 — present',
    heroEngine: '3.0L Twin-Turbo V6 Hybrid',
    heroBhp: '671 — 700 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren Artura, produced from 2022, is McLaren\'s next-generation hybrid supercar. Featuring an all-new 3.0-litre twin-turbo V6 and electric motor producing up to 700 bhp, it rides on the new McLaren Carbon Lightweight Architecture. Available as coupe and spider.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'dct';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/artura' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/artura' },
      carsandclassic: { makeId: 2180, model: 'artura' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=Artura' },
    },
  },
  {
    slug: '750s',
    displayName: '750S',
    fullName: 'McLaren 750S',
    heroYears: '2023 — present',
    heroEngine: '4.0L Twin-Turbo V8',
    heroBhp: '740 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren 750S, produced from 2023, succeeds the 720S as the core of the Super Series. With 740 bhp from the upgraded 4.0-litre twin-turbo V8 and 30kg lighter than its predecessor, it delivers even sharper performance and improved aerodynamics. Available as coupe and spider.',
    getBody: `if (/spider|convertible/i.test(title)) return 'convertible';
      return 'coupe';`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      return 'coupe';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { coupe: 'Coupe', spider: 'Spider' },
    variantOrder: ['coupe', 'spider'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
    sources: {
      pistonheads: { searchUrl: 'https://www.pistonheads.com/buy/mclaren/750s' },
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/750s' },
      carsandclassic: { makeId: 2180, model: '750s' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=750S' },
    },
  },
  {
    slug: 'gts',
    displayName: 'GTS',
    fullName: 'McLaren GTS',
    heroYears: '2024 — present',
    heroEngine: '4.0L Twin-Turbo V8',
    heroBhp: '626 BHP',
    heroImage: '',
    heroCredit: '',
    description: 'The McLaren GTS, produced from 2024, succeeds the GT as McLaren\'s grand touring model. With 626 bhp from the 4.0-litre twin-turbo V8, it is lighter and more focused than its predecessor while retaining the practical luggage space and long-distance refinement that defined the GT.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gts';`,
    getTransmission: `return 'ssg';`,
    variantLabels: { gts: 'GTS' },
    variantOrder: ['gts'],
    transmissionLabels: { ssg: 'SSG' },
    transmissionOrder: ['ssg'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
    sources: {
      autotrader: { searchUrl: 'https://www.autotrader.co.uk/cars/used/mclaren/gts' },
      carsandclassic: { makeId: 2180, model: 'gts' },
      collectingcars: { searchUrl: 'https://www.collectingcars.com/search?make=McLaren&model=GTS' },
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
    `href="/analysis/mclaren-${model.slug}"`
  );

  // D. Auction empty text
  html = html.replace(
    /No Ferrari 458 auctions/,
    `No ${model.fullName} auctions`
  );

  // E. API fetch URL
  html = html.replace(
    /fetch\('\/api\/listings\/ferrari-458'\)/,
    `fetch('/api/listings/mclaren-${model.slug}')`
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

console.log('=== McLaren Page Generator ===\n');

// Verify template exists
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error(`Template not found: ${TEMPLATE_PATH}`);
  process.exit(1);
}

// Track what we create
let pagesCreated = 0;
let dataFilesCreated = 0;
const errors = [];

// Generate pages
for (const model of MODELS) {
  const slug = `mclaren-${model.slug}`;
  const pageDir = path.join(ROOT, 'public/cars', slug);
  const pagePath = path.join(pageDir, 'index.html');
  const dataPath = path.join(ROOT, 'data', `${slug}.json`);

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

    console.log(`  OK    ${slug}`);
  } catch (err) {
    errors.push({ slug, error: err.message });
    console.error(`  FAIL  ${slug}: ${err.message}`);
  }
}

// Update models.json WITH SOURCES (not empty!)
console.log('\nUpdating models.json...');
const modelsData = JSON.parse(fs.readFileSync(MODELS_JSON_PATH, 'utf8'));
const existingSlugs = new Set(modelsData.models.map(m => m.slug));

let modelsAdded = 0;
for (const model of MODELS) {
  const slug = `mclaren-${model.slug}`;
  if (existingSlugs.has(slug)) {
    continue;
  }

  modelsData.models.push({
    slug,
    make: 'McLaren',
    model: model.displayName,
    heroImage: model.heroImage || '',
    heroCredit: model.heroCredit || '',
    description: model.description,
    sources: model.sources, // <-- POPULATED sources, not {}!
  });
  modelsAdded++;
}

fs.writeFileSync(MODELS_JSON_PATH, JSON.stringify(modelsData, null, 2), 'utf8');
console.log(`  Added ${modelsAdded} new entries to models.json`);

// Summary
console.log(`\n=== Summary ===`);
console.log(`  Pages created:      ${pagesCreated}`);
console.log(`  Data files created: ${dataFilesCreated}`);
console.log(`  Models.json added:  ${modelsAdded}`);
console.log(`  Total models.json:  ${modelsData.models.length}`);
if (errors.length > 0) {
  console.log(`  Errors:             ${errors.length}`);
  errors.forEach(e => console.log(`    - ${e.slug}: ${e.error}`));
}
console.log('\nDone!');
