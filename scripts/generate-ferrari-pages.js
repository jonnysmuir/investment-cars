#!/usr/bin/env node
/**
 * generate-ferrari-pages.js
 *
 * Generates blank listing pages for 59 Ferrari base models by reading the
 * Ferrari 458 page as a template and performing targeted string replacements.
 *
 * Also creates empty data JSON files and updates data/models.json.
 *
 * Usage:  /Users/jonnymuir/bin/node scripts/generate-ferrari-pages.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'public/cars/ferrari-458/index.html');
const MODELS_JSON_PATH = path.join(ROOT, 'data/models.json');

// ---------------------------------------------------------------------------
// Ferrari CDN image paths (extracted from ferrari.com past-models & car-range)
// ---------------------------------------------------------------------------

const CDN_BASE = 'https://cdn.ferrari.com/cms/network/media/img/resize/';
const CDN_PARAMS = '?width=1200&height=675';

const IMAGE_MAP = {
  // Past models page images
  '166-inter':        '5ddbda2d2cdb32285a79ac43-ferrari-166-inter1948-thumb',
  '195-inter':        '5ddbeee784077c3b2433d66b-ferrari-195-inter-thumb',
  '212-inter':        '5ddbf07af8fc7b0aa90819e7-ferrari-212-inter-1951-thumb',
  '342-america':      '5ddbf0dc2cdb32285a79b14f-ferrari-342-america-1951-thumb',
  '250-europa':       '5ddbf3020cf6995f44de9304-ferrari_250_europa_1953-thumb',
  '375-america':      '5ddbf359f8fc7b0aa9081a93-ferrari-375-america-1953-thumb',
  '250-gt':           '5ddd288cf8fc7b0aa90858f4-ferrari-250-gt-berlinetta-1956-thumb',
  '410-superamerica': '5ddd29f90cf6995f44de932c-ferrari-410-superamerica-1956-thumb',
  '250-california':   '5ddd2ffd2cdb32285a79f21c-ferrari-250-california-1957-thumb',
  '250-gto':          '5ddb9b72f8fc7b0aa90807a2-ferrari-250-gto-1962-thumb',
  '400-superamerica': '5defacf6d920210f0efa9827-ferrari-400-superamerica-1960-thumb',
  '275-gtb':          '5dc2975fc9ba7568b9921c57-ferrari-275-gtb-1964-thumb',
  '275-gts':          '5dc299bbc9ba7568b9921cbe-ferrari-275-gts-1965-thumb',
  '330-gt':           '5dc540263378a829c009b0f9-ferrari-330-gtc-1966-thumb',
  '500-superfast':    '5dc3da3195e21208efa329e5-ferrari-500-superfast-1964-thumb',
  '365':              '5dcae27af8fc7b0aa9048da4-ferrari-365-gtb4-thumb',
  'dino-206-gt':      '5dc56a7c3378a829c009bdc7-ferrari-dino-206-gt-1968-thumb',
  'dino-246':         '5dc56b1637497e4ff8d30428-ferrari-dino-246-gt-1969-thumb',
  'dino-308-gt4':     '5dd3b36e0cf6995f44de9101-ferrari-dino-308-gt4-1972-thumb',
  'dino-208-gt4':     '5dd3d23b0cf6995f44de9135-ferrari-dino-208-gt4-1975-thumb',
  '308':              '5dd3f14984077c3b24323c4d-ferrari-308-gtb-1975-thumb',
  '208':              '5de0fc86f8fc7b0aa90925cf-ferrari-208-gtb-1980-thumb',
  '400':              '5dd3f4b82cdb32285a78176c-ferrari-400-automatic-1976-thumb',
  '512-bb':           '5dd412db2cdb32285a781e9c-ferrari-512-bb-1976-thumb',
  'mondial':          '5de0f14684077c3b2434e088-ferrari-mondial-8-1980-thumb',
  'gto':              '5de62eb9b6285a70bc7cb36e-ferrari-gto-1984-thumb',
  'testarossa':       '5de63da6b6285a70bc7cb70e-ferrari-testarossa-1984-thumb',
  '328':              '5de668aa91756c07f10ad613-ferrrari-328-gtb-1985-thumb',
  '412':              '5de66046520ff40ac7218d4d-ferrari-412-1985-thumb',
  'f40':              '5de7925e520ff40ac721d0dc-ferrari-f40-1987-thumb',
  '348':              '5de7dc547953932d566b05d3-ferrari-348-tb-1989-thumb',
  '456':              '5dd518b184077c3b2432765b-ferrari-456-gt-1992-thumb',
  'f355':             '5dd52a270cf6995f44de91e5-ferrari-f355-berlinetta-1994-thumb',
  'f50':              '5ddd32102cdb32285a79f29a-ferrari-f50-1995-thumb',
  '550':              '5dd6afbe2cdb32285a78a3de-ferrari-550-maranello-1996-thumb',
  '575m':             '5dde9a532cdb32285a7a39c3-ferrari-575m-maranello-2002-thumb',
  'enzo':             '5dc59df837497e4ff8d30e51-ferrari-enzo-2002-thumb',
  '612':              '5dc45da801d20661709475b4-ferrari-612-scaglietti-2004-thumb',
  'fxx':              '5dc048c18c92940b3a3f2d13-ferrari-fxx-2005-thumb',
  'superamerica':     '5dc405d03378a829c00979e4-ferrari-superamerica-2005-thumb',
  'california':       '5ddd4f3b0cf6995f44de9359-ferrari-california-2008-thumb',
  'ff':               '5dc00c9848ab400ab445c46d-ferrari-ff-thumb',
  'laferrari':        '5ddb97a00cf6995f44de92de-laferrari-2013-thumb',
  'gtc4lusso':        '5fb3a1dc850aac6b67934c2e-ferrari-gtc4lusso-past-model-thumb',
  '812':              '60d1b4c09fdfa1733415e0e7-812 superfast',
  'portofino':        '5f5b4cec57f0c16d75e823f5-ferrari_portofino_share-2020-past',
  'f8':               '60d1bbd688780642c79ba8ca-f8 tributo',
  'roma':             '60d1bd14997c9a7a59e64395-roma',
  'sf90':             '60d1ba1007fbc76f1b331d6f-sf90 stradale',

  // Car-range page images (current models)
  '296':              '60d453eae26eb865e634a268',
  'f80':              '670e710357a595000f736188-ferrari-f80-lineup-desktop',
  '12cilindri':       '66335816a44e370010b54945-lineup-12cilindri-desk',
  'purosangue':       '631f431c482135455e01f05c-ferrari-purosangue-crop-line-up',
  'daytona-sp3':      '6198d2ed2ce9303ca1976d00-lineup-desktop-ferrari-daytona-sp3',
  'monza-sp1':        '5dd41596f8fc7b0aa90687f4-ferrari-monza-sp1-past-model-thumb',
  'monza-sp2':        '5dd41596f8fc7b0aa90687f4-ferrari-monza-sp1-past-model-thumb', // same image; SP2 is barely different visually
  'amalfi':           '68625aca91d0f900206e2b0f-scontorno_lineup_amalfi',
  '849-testarossa':   '68bfef18c155f200205688f5-lineup_849testarossa',
  'luce':             '698996912c206e00201ff696-ferrari-luce-line-up-assembly-v2',
};

function getHeroImage(slug) {
  const imagePath = IMAGE_MAP[slug];
  if (!imagePath) return '';
  // URL-encode spaces in the path
  const encodedPath = imagePath.replace(/ /g, '%20');
  return `${CDN_BASE}${encodedPath}${CDN_PARAMS}`;
}

// ---------------------------------------------------------------------------
// 59 model configurations
// ---------------------------------------------------------------------------

const MODELS = [
  {
    slug: '166-inter',
    displayName: '166 Inter',
    fullName: 'Ferrari 166 Inter',
    heroYears: '1948 — 1950',
    heroEngine: '2.0L V12',
    heroBhp: '110 BHP',
    description: 'The Ferrari 166 Inter, produced from 1948 to 1950, was among the very first Ferrari road cars. Powered by a Colombo-designed 2.0-litre V12, it established the template for decades of Ferrari grand tourers to come.',
    getBody: `return 'coupe';`,
    getVariant: `return 'inter';`,
    getTransmission: `return 'manual';`,
    variantLabels: { inter: 'Inter' },
    variantOrder: ['inter'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '195-inter',
    displayName: '195 Inter',
    fullName: 'Ferrari 195 Inter',
    heroYears: '1950 — 1951',
    heroEngine: '2.3L V12',
    heroBhp: '130 BHP',
    description: 'The Ferrari 195 Inter, produced from 1950 to 1951, succeeded the 166 Inter with a larger 2.3-litre Colombo V12. A rare early Ferrari road car, it bridged the gap between the 166 and the 212.',
    getBody: `return 'coupe';`,
    getVariant: `return 'inter';`,
    getTransmission: `return 'manual';`,
    variantLabels: { inter: 'Inter' },
    variantOrder: ['inter'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '212-inter',
    displayName: '212 Inter',
    fullName: 'Ferrari 212 Inter',
    heroYears: '1951 — 1953',
    heroEngine: '2.6L V12',
    heroBhp: '150 BHP',
    description: 'The Ferrari 212 Inter, produced from 1951 to 1953, featured a 2.6-litre Colombo V12. Offered in both road and competition forms, the 212 helped establish Ferrari as a maker of desirable grand touring cars.',
    getBody: `return 'coupe';`,
    getVariant: `return 'inter';`,
    getTransmission: `return 'manual';`,
    variantLabels: { inter: 'Inter' },
    variantOrder: ['inter'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '342-america',
    displayName: '342 America',
    fullName: 'Ferrari 342 America',
    heroYears: '1951 — 1953',
    heroEngine: '4.1L V12',
    heroBhp: '200 BHP',
    description: 'The Ferrari 342 America, produced from 1951 to 1953, featured a larger Lampredi-designed 4.1-litre V12. Aimed at the American market, only six examples were built, making it one of the rarest early Ferraris.',
    getBody: `return 'coupe';`,
    getVariant: `return 'america';`,
    getTransmission: `return 'manual';`,
    variantLabels: { america: 'America' },
    variantOrder: ['america'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '250-europa',
    displayName: '250 Europa',
    fullName: 'Ferrari 250 Europa',
    heroYears: '1953 — 1954',
    heroEngine: '3.0L V12',
    heroBhp: '200 BHP',
    description: 'The Ferrari 250 Europa, produced from 1953 to 1954, was the first Ferrari to use the 3.0-litre Colombo V12 that would define the marque for decades. It laid the foundation for the legendary 250 GT series.',
    getBody: `return 'coupe';`,
    getVariant: `return 'europa';`,
    getTransmission: `return 'manual';`,
    variantLabels: { europa: 'Europa' },
    variantOrder: ['europa'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '375-america',
    displayName: '375 America',
    fullName: 'Ferrari 375 America',
    heroYears: '1953 — 1955',
    heroEngine: '4.5L V12',
    heroBhp: '300 BHP',
    description: 'The Ferrari 375 America, produced from 1953 to 1955, was powered by a potent 4.5-litre Lampredi V12 derived from the Formula One engine. With only 12 examples built, it remains among the rarest and most valuable Ferraris.',
    getBody: `return 'coupe';`,
    getVariant: `return 'america';`,
    getTransmission: `return 'manual';`,
    variantLabels: { america: 'America' },
    variantOrder: ['america'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '250-gt',
    displayName: '250 GT',
    fullName: 'Ferrari 250 GT',
    heroYears: '1954 — 1964',
    heroEngine: '3.0L V12',
    heroBhp: '240 — 280 BHP',
    description: 'The Ferrari 250 GT, produced in many forms from 1954 to 1964, is the defining Ferrari grand tourer. Powered by the legendary Colombo 3.0-litre V12, variants include the Berlinetta, Cabriolet, California, passo corto (SWB), 2+2, and the exquisite Berlinetta Lusso.',
    getBody: `if (/cabrio|spider|california/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/lusso/i.test(title)) return 'lusso';
      if (/passo\\s*corto|swb|short/i.test(title)) return 'passo-corto';
      if (/2\\+2|2\\s*plus\\s*2/i.test(title)) return '2-plus-2';
      if (/cabrio/i.test(title)) return 'cabriolet';
      if (/california/i.test(title)) return 'california';
      if (/berlinetta/i.test(title)) return 'berlinetta';
      return 'coupe';`,
    getTransmission: `return 'manual';`,
    variantLabels: { coupe: 'Coup\u00e9', berlinetta: 'Berlinetta', cabriolet: 'Cabriolet', 'passo-corto': 'Passo Corto', '2-plus-2': '2+2', lusso: 'Lusso', california: 'California' },
    variantOrder: ['coupe', 'berlinetta', 'cabriolet', 'passo-corto', '2-plus-2', 'lusso', 'california'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '410-superamerica',
    displayName: '410 Superamerica',
    fullName: 'Ferrari 410 Superamerica',
    heroYears: '1956 — 1959',
    heroEngine: '5.0L V12',
    heroBhp: '340 BHP',
    description: 'The Ferrari 410 Superamerica, produced from 1956 to 1959, was Ferrari\'s most powerful road car of its era. With a 5.0-litre Lampredi V12, it was the ultimate expression of Ferrari\'s grand touring philosophy in the 1950s.',
    getBody: `return 'coupe';`,
    getVariant: `return 'superamerica';`,
    getTransmission: `return 'manual';`,
    variantLabels: { superamerica: 'Superamerica' },
    variantOrder: ['superamerica'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '250-california',
    displayName: '250 California',
    fullName: 'Ferrari 250 California',
    heroYears: '1957 — 1963',
    heroEngine: '3.0L V12',
    heroBhp: '240 BHP',
    description: 'The Ferrari 250 California, produced from 1957 to 1963, is one of the most beautiful and valuable Ferraris ever made. A convertible variant of the 250 GT, both long-wheelbase and short-wheelbase versions are among the most sought-after collector cars in the world.',
    getBody: `return 'convertible';`,
    getVariant: `if (/swb|short|passo\\s*corto/i.test(title)) return 'swb';
      return 'lwb';`,
    getTransmission: `return 'manual';`,
    variantLabels: { lwb: 'LWB', swb: 'SWB' },
    variantOrder: ['lwb', 'swb'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: '250-gto',
    displayName: '250 GTO',
    fullName: 'Ferrari 250 GTO',
    heroYears: '1962 — 1964',
    heroEngine: '3.0L V12',
    heroBhp: '300 BHP',
    description: 'The Ferrari 250 GTO, produced from 1962 to 1964, is widely considered the greatest Ferrari ever made. With only 36 examples built, the GTO is the most valuable car in the world, combining stunning Scaglietti bodywork with a race-bred 3.0-litre Colombo V12.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gto';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gto: 'GTO' },
    variantOrder: ['gto'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '400-superamerica',
    displayName: '400 Superamerica',
    fullName: 'Ferrari 400 Superamerica',
    heroYears: '1960 — 1964',
    heroEngine: '4.0L V12',
    heroBhp: '340 BHP',
    description: 'The Ferrari 400 Superamerica, produced from 1960 to 1964, succeeded the 410 SA with a Colombo-derived 4.0-litre V12. Available in both coupe and cabriolet forms with various coachbuilder bodies, only 47 were made.',
    getBody: `if (/cabrio|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `return 'superamerica';`,
    getTransmission: `return 'manual';`,
    variantLabels: { superamerica: 'Superamerica' },
    variantOrder: ['superamerica'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '275-gtb',
    displayName: '275 GTB',
    fullName: 'Ferrari 275 GTB',
    heroYears: '1964 — 1968',
    heroEngine: '3.3L V12',
    heroBhp: '280 — 300 BHP',
    description: 'The Ferrari 275 GTB, produced from 1964 to 1968, was a landmark Ferrari with independent rear suspension and a rear-mounted transaxle. The later GTB/4 variant with its four-cam engine is among the most desirable Ferraris of the 1960s.',
    getBody: `return 'coupe';`,
    getVariant: `if (/gtb\\s*\\/\\s*4|gtb4|four.?cam|4.?cam/i.test(title)) return 'gtb4';
      return 'gtb';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gtb: 'GTB', gtb4: 'GTB/4' },
    variantOrder: ['gtb', 'gtb4'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '275-gts',
    displayName: '275 GTS',
    fullName: 'Ferrari 275 GTS',
    heroYears: '1964 — 1966',
    heroEngine: '3.3L V12',
    heroBhp: '260 BHP',
    description: 'The Ferrari 275 GTS, produced from 1964 to 1966, was the open-top counterpart to the 275 GTB. With Pininfarina bodywork and a 3.3-litre Colombo V12, the GTS offered refined grand touring in convertible form.',
    getBody: `return 'convertible';`,
    getVariant: `return 'gts';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gts: 'GTS' },
    variantOrder: ['gts'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: '330-gt',
    displayName: '330',
    fullName: 'Ferrari 330',
    heroYears: '1963 — 1968',
    heroEngine: '4.0L V12',
    heroBhp: '300 BHP',
    description: 'The Ferrari 330, produced from 1963 to 1968, was available as the GT 2+2, GTC coupe, and GTS spider. Powered by a 4.0-litre Colombo V12, the 330 family represented Ferrari\'s refined grand touring range of the mid-1960s.',
    getBody: `if (/gts|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/gts|spider/i.test(title)) return 'gts';
      if (/gtc/i.test(title)) return 'gtc';
      return '2-plus-2';`,
    getTransmission: `return 'manual';`,
    variantLabels: { '2-plus-2': '2+2', gtc: 'GTC', gts: 'GTS' },
    variantOrder: ['2-plus-2', 'gtc', 'gts'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '500-superfast',
    displayName: '500 Superfast',
    fullName: 'Ferrari 500 Superfast',
    heroYears: '1964 — 1966',
    heroEngine: '5.0L V12',
    heroBhp: '400 BHP',
    description: 'The Ferrari 500 Superfast, produced from 1964 to 1966, was the most expensive and exclusive Ferrari of its era. With a 5.0-litre Colombo V12 producing 400 bhp, only 37 were built. It was the ultimate luxury Ferrari grand tourer.',
    getBody: `return 'coupe';`,
    getVariant: `return 'superfast';`,
    getTransmission: `return 'manual';`,
    variantLabels: { superfast: 'Superfast' },
    variantOrder: ['superfast'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '365',
    displayName: '365',
    fullName: 'Ferrari 365',
    heroYears: '1966 — 1976',
    heroEngine: '4.4L V12',
    heroBhp: '320 — 380 BHP',
    description: 'The Ferrari 365 family, produced from 1966 to 1976, encompasses some of the most iconic Ferraris ever made. From the California spider to the legendary GTB/4 Daytona, the GT4 BB, and the comfortable GT4 2+2, the 365 range defined an era of Ferrari excellence.',
    getBody: `if (/spider|california|gts|cabriolet/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/gt4\\s*bb|berlinetta\\s*boxer/i.test(title)) return 'gt4-bb';
      if (/gt4\\s*2\\+2|gt4\\s*2\\s*plus|365\\s*gt4(?!\\s*bb)/i.test(title)) return 'gt4-2-plus-2';
      if (/gtc\\s*4|gtc4/i.test(title)) return 'gtc4';
      if (/gts\\s*4|gts4/i.test(title)) return 'gts4';
      if (/gtb\\s*4|gtb4|daytona/i.test(title)) return 'gtb4';
      if (/gtc/i.test(title)) return 'gtc';
      if (/gts|spider/i.test(title)) return 'gts';
      if (/california/i.test(title)) return 'california';
      if (/gt\\s*2\\+2|2\\s*plus\\s*2/i.test(title)) return 'gt-2-plus-2';
      return 'gt';`,
    getTransmission: `return 'manual';`,
    variantLabels: { california: 'California', 'gt-2-plus-2': 'GT 2+2', gtb4: 'GTB/4 Daytona', gtc: 'GTC', gtc4: 'GTC/4', gts: 'GTS', gts4: 'GTS/4', 'gt4-bb': 'GT4 BB', 'gt4-2-plus-2': 'GT4 2+2', gt: 'GT' },
    variantOrder: ['california', 'gt-2-plus-2', 'gtb4', 'gtc', 'gtc4', 'gts', 'gts4', 'gt4-bb', 'gt4-2-plus-2'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'dino-206-gt',
    displayName: 'Dino 206 GT',
    fullName: 'Ferrari Dino 206 GT',
    heroYears: '1968 — 1969',
    heroEngine: '2.0L V6',
    heroBhp: '180 BHP',
    description: 'The Ferrari Dino 206 GT, produced from 1968 to 1969, was the first mid-engined Ferrari road car. Powered by a 2.0-litre V6 with an aluminium body, only 152 were built before being replaced by the steel-bodied 246.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gt';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gt: 'GT' },
    variantOrder: ['gt'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'dino-246',
    displayName: 'Dino 246',
    fullName: 'Ferrari Dino 246',
    heroYears: '1969 — 1974',
    heroEngine: '2.4L V6',
    heroBhp: '195 BHP',
    description: 'The Ferrari Dino 246, produced from 1969 to 1974, succeeded the 206 GT with a larger 2.4-litre V6 and steel body. Available as the GT coupe and GTS targa, the 246 is one of the most beautiful Ferraris ever made and highly sought after by collectors.',
    getBody: `if (/gts|targa|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/gts/i.test(title)) return 'gts';\n      return 'gt';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gt: 'GT', gts: 'GTS' },
    variantOrder: ['gt', 'gts'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'dino-308-gt4',
    displayName: 'Dino 308 GT4',
    fullName: 'Ferrari Dino 308 GT4',
    heroYears: '1973 — 1980',
    heroEngine: '3.0L V8',
    heroBhp: '255 BHP',
    description: 'The Ferrari Dino 308 GT4, produced from 1973 to 1980, was the first production Ferrari with a V8 engine and 2+2 seating. Designed by Bertone rather than Pininfarina, it featured a mid-mounted 3.0-litre V8.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gt4';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gt4: 'GT4' },
    variantOrder: ['gt4'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'dino-208-gt4',
    displayName: 'Dino 208 GT4',
    fullName: 'Ferrari Dino 208 GT4',
    heroYears: '1975 — 1980',
    heroEngine: '2.0L V8',
    heroBhp: '170 BHP',
    description: 'The Ferrari Dino 208 GT4, produced from 1975 to 1980, was a tax-friendly Italian-market variant of the 308 GT4 with a smaller 2.0-litre V8. Designed by Bertone, it shared the 308 GT4\'s Bertone-styled body.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gt4';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gt4: 'GT4' },
    variantOrder: ['gt4'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '308',
    displayName: '308',
    fullName: 'Ferrari 308',
    heroYears: '1975 — 1985',
    heroEngine: '3.0L V8',
    heroBhp: '205 — 255 BHP',
    description: 'The Ferrari 308, produced from 1975 to 1985, is one of the most recognisable Ferraris ever made. Available as GTB (coupe) and GTS (targa), later variants included fuel-injected GTBi/GTSi models and the Quattrovalvole four-valve versions.',
    getBody: `if (/gts|targa|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/quattrovalvole|qv/i.test(title) && /gts/i.test(title)) return 'gts-qv';
      if (/quattrovalvole|qv/i.test(title)) return 'gtb-qv';
      if (/gtsi/i.test(title)) return 'gtsi';
      if (/gtbi/i.test(title)) return 'gtbi';
      if (/gts/i.test(title)) return 'gts';
      return 'gtb';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gtb: 'GTB', gts: 'GTS', gtbi: 'GTBi', gtsi: 'GTSi', 'gtb-qv': 'GTB QV', 'gts-qv': 'GTS QV' },
    variantOrder: ['gtb', 'gts', 'gtbi', 'gtsi', 'gtb-qv', 'gts-qv'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '208',
    displayName: '208',
    fullName: 'Ferrari 208',
    heroYears: '1980 — 1989',
    heroEngine: '2.0L V8',
    heroBhp: '155 — 254 BHP',
    description: 'The Ferrari 208, produced from 1980 to 1989, was an Italian-market model with a 2.0-litre V8 to comply with tax regulations. Available as GTB and GTS, with later turbocharged variants offering significantly more power than the naturally aspirated versions.',
    getBody: `if (/gts|targa|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/gts\\s*turbo/i.test(title)) return 'gts-turbo';
      if (/gtb\\s*turbo/i.test(title)) return 'gtb-turbo';
      if (/gts/i.test(title)) return 'gts';
      return 'gtb';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gtb: 'GTB', gts: 'GTS', 'gtb-turbo': 'GTB Turbo', 'gts-turbo': 'GTS Turbo' },
    variantOrder: ['gtb', 'gts', 'gtb-turbo', 'gts-turbo'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '400',
    displayName: '400',
    fullName: 'Ferrari 400',
    heroYears: '1976 — 1985',
    heroEngine: '4.8L V12',
    heroBhp: '310 — 340 BHP',
    description: 'The Ferrari 400, produced from 1976 to 1985, was Ferrari\'s first car offered with an automatic transmission. A 2+2 grand tourer powered by a 4.8-litre V12, it was available as the Automatic and GT (manual), later updated to 400i with fuel injection.',
    getBody: `return 'coupe';`,
    getVariant: `if (/automatic\\s*i|auto.*i(?!c)/i.test(title)) return 'automatic-i';
      if (/gti/i.test(title)) return 'gti';
      if (/automatic|auto/i.test(title)) return 'automatic';
      return 'gt';`,
    getTransmission: `if (/auto/i.test(str)) return 'automatic';\n      return 'manual';`,
    variantLabels: { automatic: 'Automatic', gt: 'GT', 'automatic-i': 'Automatic i', gti: 'GTi' },
    variantOrder: ['automatic', 'gt', 'automatic-i', 'gti'],
    transmissionLabels: { manual: 'Manual', automatic: 'Automatic' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '512-bb',
    displayName: '512 BB',
    fullName: 'Ferrari 512 BB',
    heroYears: '1976 — 1984',
    heroEngine: '5.0L Flat-12',
    heroBhp: '340 — 360 BHP',
    description: 'The Ferrari 512 BB, produced from 1976 to 1984, succeeded the 365 GT4 BB with a larger 5.0-litre flat-12 engine. Available as the carburetted BB and fuel-injected BBi, plus the rare BB LM competition variant. The mid-engined flagship defined Ferrari\'s top-of-the-range sports car.',
    getBody: `return 'coupe';`,
    getVariant: `if (/bb\\s*lm|le\\s*mans/i.test(title)) return 'bb-lm';
      if (/bbi/i.test(title)) return 'bbi';
      return 'bb';`,
    getTransmission: `return 'manual';`,
    variantLabels: { bb: 'BB', bbi: 'BBi', 'bb-lm': 'BB LM' },
    variantOrder: ['bb', 'bbi', 'bb-lm'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'mondial',
    displayName: 'Mondial',
    fullName: 'Ferrari Mondial',
    heroYears: '1980 — 1993',
    heroEngine: '3.0 — 3.4L V8',
    heroBhp: '214 — 300 BHP',
    description: 'The Ferrari Mondial, produced from 1980 to 1993, was Ferrari\'s mid-engined 2+2. Evolving through Mondial 8, Quattrovalvole, 3.2, Cabriolet, and T versions, it offered four-seat practicality in a mid-engine package.',
    getBody: `if (/cabrio|spider|convertible/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/\\bt\\b/i.test(title) && !/turbo/i.test(title)) return 't';
      if (/3\\.2|3,2/i.test(title)) return '3-2';
      if (/cabrio/i.test(title)) return 'cabriolet';
      if (/quattrovalvole|qv/i.test(title)) return 'qv';
      return '8';`,
    getTransmission: `return 'manual';`,
    variantLabels: { '8': '8', qv: 'Quattrovalvole', cabriolet: 'Cabriolet', '3-2': '3.2', t: 'T' },
    variantOrder: ['8', 'qv', 'cabriolet', '3-2', 't'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'gto',
    displayName: '288 GTO',
    fullName: 'Ferrari 288 GTO',
    heroYears: '1984 — 1987',
    heroEngine: '2.9L Twin-Turbo V8',
    heroBhp: '400 BHP',
    description: 'The Ferrari 288 GTO, produced from 1984 to 1987, was Ferrari\'s first turbocharged road car and the spiritual predecessor to the F40. Built to homologate for Group B racing, only 272 were made. Its twin-turbocharged 2.9-litre V8 made it one of the fastest cars of its era.',
    getBody: `return 'coupe';`,
    getVariant: `return 'gto';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gto: 'GTO' },
    variantOrder: ['gto'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'testarossa',
    displayName: 'Testarossa',
    fullName: 'Ferrari Testarossa',
    heroYears: '1984 — 1996',
    heroEngine: '4.9L Flat-12',
    heroBhp: '380 — 440 BHP',
    description: 'The Ferrari Testarossa, produced from 1984 to 1996, is one of the most iconic supercars ever made. Evolving through Testarossa, 512 TR, and F512 M variants, its side-strake design and flat-12 engine defined the supercar genre of the 1980s and 1990s.',
    getBody: `return 'coupe';`,
    getVariant: `if (/f512\\s*m/i.test(title)) return 'f512m';
      if (/512\\s*tr/i.test(title)) return '512tr';
      return 'testarossa';`,
    getTransmission: `return 'manual';`,
    variantLabels: { testarossa: 'Testarossa', '512tr': '512 TR', f512m: 'F512 M' },
    variantOrder: ['testarossa', '512tr', 'f512m'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '328',
    displayName: '328',
    fullName: 'Ferrari 328',
    heroYears: '1985 — 1989',
    heroEngine: '3.2L V8',
    heroBhp: '270 BHP',
    description: 'The Ferrari 328, produced from 1985 to 1989, succeeded the 308 with a larger 3.2-litre V8 and refined styling. Available as GTB (coupe) and GTS (targa), it is widely regarded as one of the most reliable and accessible classic Ferraris.',
    getBody: `if (/gts|targa|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/gts/i.test(title)) return 'gts';\n      return 'gtb';`,
    getTransmission: `return 'manual';`,
    variantLabels: { gtb: 'GTB', gts: 'GTS' },
    variantOrder: ['gtb', 'gts'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '412',
    displayName: '412',
    fullName: 'Ferrari 412',
    heroYears: '1985 — 1989',
    heroEngine: '5.0L V12',
    heroBhp: '340 BHP',
    description: 'The Ferrari 412, produced from 1985 to 1989, was the final evolution of the 400/400i series. A front-engined 2+2 grand tourer powered by a 5.0-litre V12, it was available with both manual and automatic transmissions.',
    getBody: `return 'coupe';`,
    getVariant: `return '412';`,
    getTransmission: `if (/auto/i.test(str)) return 'automatic';\n      return 'manual';`,
    variantLabels: { '412': '412' },
    variantOrder: ['412'],
    transmissionLabels: { manual: 'Manual', automatic: 'Automatic' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'f40',
    displayName: 'F40',
    fullName: 'Ferrari F40',
    heroYears: '1987 — 1992',
    heroEngine: '2.9L Twin-Turbo V8',
    heroBhp: '478 BHP',
    description: 'The Ferrari F40, produced from 1987 to 1992, was the last Ferrari personally approved by Enzo Ferrari. Built to celebrate the company\'s 40th anniversary, its twin-turbocharged 2.9-litre V8, lightweight construction, and raw driving experience made it the definitive supercar of its era.',
    getBody: `return 'coupe';`,
    getVariant: `return 'f40';`,
    getTransmission: `return 'manual';`,
    variantLabels: { f40: 'F40' },
    variantOrder: ['f40'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '348',
    displayName: '348',
    fullName: 'Ferrari 348',
    heroYears: '1989 — 1995',
    heroEngine: '3.4L V8',
    heroBhp: '296 — 320 BHP',
    description: 'The Ferrari 348, produced from 1989 to 1995, succeeded the 328 with a longitudinally-mounted 3.4-litre V8. Available as TB/TS (testa-mounted belt), later updated to GTB/GTS and Spider variants with improved handling and refinement.',
    getBody: `if (/ts\\b|gts|spider|convertible/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      if (/gts/i.test(title)) return 'gts';
      if (/gtb/i.test(title)) return 'gtb';
      if (/\\bts\\b/i.test(title)) return 'ts';
      return 'tb';`,
    getTransmission: `return 'manual';`,
    variantLabels: { tb: 'TB', ts: 'TS', gtb: 'GTB', gts: 'GTS', spider: 'Spider' },
    variantOrder: ['tb', 'ts', 'gtb', 'gts', 'spider'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '456',
    displayName: '456',
    fullName: 'Ferrari 456',
    heroYears: '1992 — 2003',
    heroEngine: '5.5L V12',
    heroBhp: '436 — 442 BHP',
    description: 'The Ferrari 456, produced from 1992 to 2003, was a front-engined V12 grand tourer. Available as GT (manual) and GTA (automatic), with a mid-life update to the 456M. The 456 offered effortless performance and long-distance comfort.',
    getBody: `return 'coupe';`,
    getVariant: `if (/456\\s*m\\s*gt\\s*a|456m\\s*gta/i.test(title)) return '456m-gta';
      if (/456\\s*m\\s*gt|456m\\s*gt(?!a)/i.test(title)) return '456m-gt';
      if (/gta/i.test(title)) return 'gta';
      return 'gt';`,
    getTransmission: `if (/auto|gta/i.test(str)) return 'automatic';\n      return 'manual';`,
    variantLabels: { gt: 'GT', gta: 'GTA', '456m-gt': '456M GT', '456m-gta': '456M GTA' },
    variantOrder: ['gt', 'gta', '456m-gt', '456m-gta'],
    transmissionLabels: { manual: 'Manual', automatic: 'Automatic' },
    transmissionOrder: ['manual', 'automatic'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'f355',
    displayName: 'F355',
    fullName: 'Ferrari F355',
    heroYears: '1994 — 1999',
    heroEngine: '3.5L V8',
    heroBhp: '380 BHP',
    description: 'The Ferrari F355, produced from 1994 to 1999, is widely considered one of the finest mid-engine V8 Ferraris. Available as Berlinetta (coupe), GTS (targa), and Spider, the F355 combined a 3.5-litre V8 with sublime handling. Manual gearbox cars are particularly sought after.',
    getBody: `if (/spider|gts|targa/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/spider/i.test(title)) return 'spider';
      if (/gts/i.test(title)) return 'gts';
      return 'berlinetta';`,
    getTransmission: `if (/f1|paddle|semi.?auto|automated/i.test(str)) return 'f1';\n      return 'manual';`,
    variantLabels: { berlinetta: 'Berlinetta', gts: 'GTS', spider: 'Spider' },
    variantOrder: ['berlinetta', 'gts', 'spider'],
    transmissionLabels: { manual: 'Manual', f1: 'F1' },
    transmissionOrder: ['manual', 'f1'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'f50',
    displayName: 'F50',
    fullName: 'Ferrari F50',
    heroYears: '1995 — 1997',
    heroEngine: '4.7L V12',
    heroBhp: '513 BHP',
    description: 'The Ferrari F50, produced from 1995 to 1997, was a thinly-disguised Formula One car for the road. With a 4.7-litre V12 derived from the 1990 F1 engine, carbon-fibre construction, and only 349 built, the F50 is one of the most exclusive supercars ever made.',
    getBody: `return 'convertible';`,
    getVariant: `return 'f50';`,
    getTransmission: `return 'manual';`,
    variantLabels: { f50: 'F50' },
    variantOrder: ['f50'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: '550',
    displayName: '550',
    fullName: 'Ferrari 550',
    heroYears: '1996 — 2001',
    heroEngine: '5.5L V12',
    heroBhp: '485 BHP',
    description: 'The Ferrari 550 Maranello, produced from 1996 to 2001, marked Ferrari\'s return to a front-mounted V12 berlinetta. Its 5.5-litre V12 and perfectly balanced chassis made it an instant classic. The limited Barchetta Pininfarina open-top variant is exceptionally collectible.',
    getBody: `if (/barchetta|spider|open/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/barchetta/i.test(title)) return 'barchetta';\n      return 'maranello';`,
    getTransmission: `return 'manual';`,
    variantLabels: { maranello: 'Maranello', barchetta: 'Barchetta Pininfarina' },
    variantOrder: ['maranello', 'barchetta'],
    transmissionLabels: { manual: 'Manual' },
    transmissionOrder: ['manual'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: '575m',
    displayName: '575M Maranello',
    fullName: 'Ferrari 575M Maranello',
    heroYears: '2002 — 2006',
    heroEngine: '5.7L V12',
    heroBhp: '515 BHP',
    description: 'The Ferrari 575M Maranello, produced from 2002 to 2006, succeeded the 550 with a larger 5.7-litre V12 and available F1-style automated gearbox. A refined grand tourer with improved power and technology, manual gearbox cars command a premium.',
    getBody: `return 'coupe';`,
    getVariant: `return 'maranello';`,
    getTransmission: `if (/f1|paddle|semi.?auto|automated/i.test(str)) return 'f1';\n      return 'manual';`,
    variantLabels: { maranello: 'Maranello' },
    variantOrder: ['maranello'],
    transmissionLabels: { manual: 'Manual', f1: 'F1' },
    transmissionOrder: ['manual', 'f1'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'enzo',
    displayName: 'Enzo',
    fullName: 'Ferrari Enzo',
    heroYears: '2002 — 2004',
    heroEngine: '6.0L V12',
    heroBhp: '651 BHP',
    description: 'The Ferrari Enzo, produced from 2002 to 2004, was named after the company\'s founder and represented the pinnacle of Ferrari road car technology. With a 6.0-litre V12 producing 651 bhp, Formula One-derived aerodynamics, and only 400 built, the Enzo remains one of the most celebrated supercars ever made.',
    getBody: `return 'coupe';`,
    getVariant: `return 'enzo';`,
    getTransmission: `return 'f1';`,
    variantLabels: { enzo: 'Enzo' },
    variantOrder: ['enzo'],
    transmissionLabels: { f1: 'F1' },
    transmissionOrder: ['f1'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '612',
    displayName: '612 Scaglietti',
    fullName: 'Ferrari 612 Scaglietti',
    heroYears: '2004 — 2011',
    heroEngine: '5.7L V12',
    heroBhp: '533 — 540 BHP',
    description: 'The Ferrari 612 Scaglietti, produced from 2004 to 2011, was Ferrari\'s front-engined V12 grand tourer. Named after legendary coachbuilder Sergio Scaglietti, its aluminium body and 5.7-litre V12 delivered effortless performance in a luxurious 2+2 package.',
    getBody: `return 'coupe';`,
    getVariant: `return 'scaglietti';`,
    getTransmission: `if (/f1|paddle|semi.?auto|automated/i.test(str)) return 'f1';\n      return 'manual';`,
    variantLabels: { scaglietti: 'Scaglietti' },
    variantOrder: ['scaglietti'],
    transmissionLabels: { manual: 'Manual', f1: 'F1' },
    transmissionOrder: ['manual', 'f1'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'fxx',
    displayName: 'FXX',
    fullName: 'Ferrari FXX',
    heroYears: '2005 — 2007',
    heroEngine: '6.3L V12',
    heroBhp: '789 BHP',
    description: 'The Ferrari FXX, produced from 2005 to 2007, was a track-only development of the Enzo. With a 6.3-litre V12 producing 789 bhp and only 30 built, the FXX was part of Ferrari\'s Corse Clienti programme. It represents the extreme of Ferrari\'s engineering capabilities.',
    getBody: `return 'coupe';`,
    getVariant: `return 'fxx';`,
    getTransmission: `return 'f1';`,
    variantLabels: { fxx: 'FXX' },
    variantOrder: ['fxx'],
    transmissionLabels: { f1: 'F1' },
    transmissionOrder: ['f1'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'superamerica',
    displayName: 'Superamerica',
    fullName: 'Ferrari 575 Superamerica',
    heroYears: '2005 — 2006',
    heroEngine: '5.7L V12',
    heroBhp: '533 BHP',
    description: 'The Ferrari 575 Superamerica, produced from 2005 to 2006, featured a unique electrochromic rotating roof that could transform from coupe to open-top in seconds. Based on the 575M, only 559 were built, making it a rare and innovative collector\'s piece.',
    getBody: `return 'convertible';`,
    getVariant: `return 'superamerica';`,
    getTransmission: `if (/f1|paddle|semi.?auto|automated/i.test(str)) return 'f1';\n      return 'manual';`,
    variantLabels: { superamerica: 'Superamerica' },
    variantOrder: ['superamerica'],
    transmissionLabels: { manual: 'Manual', f1: 'F1' },
    transmissionOrder: ['manual', 'f1'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: 'california',
    displayName: 'California',
    fullName: 'Ferrari California',
    heroYears: '2008 — 2017',
    heroEngine: '4.3 — 3.9L V8',
    heroBhp: '453 — 552 BHP',
    description: 'The Ferrari California, produced from 2008 to 2017, was Ferrari\'s front-engined V8 grand tourer with a retractable hard top. Evolving through California, California 30, and the turbocharged California T, it combined open-top motoring with everyday usability.',
    getBody: `return 'convertible';`,
    getVariant: `if (/california\\s*t\\b/i.test(title)) return 't';
      if (/\\b30\\b/i.test(title)) return '30';
      return 'california';`,
    getTransmission: `return 'dct';`,
    variantLabels: { california: 'California', '30': '30', t: 'T' },
    variantOrder: ['california', '30', 't'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: 'ff',
    displayName: 'FF',
    fullName: 'Ferrari FF',
    heroYears: '2011 — 2016',
    heroEngine: '6.3L V12',
    heroBhp: '651 BHP',
    description: 'The Ferrari FF, produced from 2011 to 2016, was Ferrari\'s first all-wheel-drive production car and its first four-seat grand tourer. With a 6.3-litre V12 producing 651 bhp and a unique shooting brake design, the FF was a revolutionary departure for Ferrari.',
    getBody: `return 'coupe';`,
    getVariant: `return 'ff';`,
    getTransmission: `return 'dct';`,
    variantLabels: { ff: 'FF' },
    variantOrder: ['ff'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: 'laferrari',
    displayName: 'LaFerrari',
    fullName: 'Ferrari LaFerrari',
    heroYears: '2013 — 2018',
    heroEngine: '6.3L V12 Hybrid',
    heroBhp: '950 BHP',
    description: 'The Ferrari LaFerrari, produced from 2013 to 2018, was Ferrari\'s first hybrid hypercar. Combining a 6.3-litre V12 with an electric motor for a combined 950 bhp, only 500 coupes and 210 Aperta open-top versions were made.',
    getBody: `if (/aperta|spider|open/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/aperta/i.test(title)) return 'aperta';\n      return 'laferrari';`,
    getTransmission: `return 'dct';`,
    variantLabels: { laferrari: 'LaFerrari', aperta: 'Aperta' },
    variantOrder: ['laferrari', 'aperta'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'gtc4lusso',
    displayName: 'GTC4Lusso',
    fullName: 'Ferrari GTC4Lusso',
    heroYears: '2016 — 2020',
    heroEngine: '6.3L V12 / 3.9L V8T',
    heroBhp: '602 — 681 BHP',
    description: 'The Ferrari GTC4Lusso, produced from 2016 to 2020, succeeded the FF as Ferrari\'s four-seat grand tourer. Available with a 6.3-litre V12 (GTC4Lusso) or twin-turbo 3.9-litre V8 (GTC4Lusso T), it combined everyday usability with Ferrari performance.',
    getBody: `return 'coupe';`,
    getVariant: `if (/lusso\\s*t\\b|lusso.*v8/i.test(title)) return 't';\n      return 'gtc4lusso';`,
    getTransmission: `return 'dct';`,
    variantLabels: { gtc4lusso: 'GTC4Lusso', t: 'T' },
    variantOrder: ['gtc4lusso', 't'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '812',
    displayName: '812',
    fullName: 'Ferrari 812',
    heroYears: '2017 — 2022',
    heroEngine: '6.5L V12',
    heroBhp: '789 — 819 BHP',
    description: 'The Ferrari 812 Superfast, produced from 2017 to 2022, featured the most powerful naturally aspirated production V12 in history. Available as Superfast, GTS (retractable hard top), and the limited Competizione and Competizione Aperta track-focused variants.',
    getBody: `if (/gts|aperta|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/competizione\\s*a(perta)?/i.test(title)) return 'competizione-aperta';
      if (/competizione/i.test(title)) return 'competizione';
      if (/gts/i.test(title)) return 'gts';
      return 'superfast';`,
    getTransmission: `return 'dct';`,
    variantLabels: { superfast: 'Superfast', gts: 'GTS', competizione: 'Competizione', 'competizione-aperta': 'Competizione Aperta' },
    variantOrder: ['superfast', 'gts', 'competizione', 'competizione-aperta'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'portofino',
    displayName: 'Portofino',
    fullName: 'Ferrari Portofino',
    heroYears: '2018 — 2023',
    heroEngine: '3.9L Twin-Turbo V8',
    heroBhp: '592 — 612 BHP',
    description: 'The Ferrari Portofino, produced from 2018 to 2023, succeeded the California T as Ferrari\'s entry-level grand tourer with a retractable hard top. The updated Portofino M added an 8-speed gearbox and more power.',
    getBody: `return 'convertible';`,
    getVariant: `if (/portofino\\s*m\\b/i.test(title)) return 'm';\n      return 'portofino';`,
    getTransmission: `return 'dct';`,
    variantLabels: { portofino: 'Portofino', m: 'M' },
    variantOrder: ['portofino', 'm'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: 'f8',
    displayName: 'F8',
    fullName: 'Ferrari F8',
    heroYears: '2019 — 2022',
    heroEngine: '3.9L Twin-Turbo V8',
    heroBhp: '710 — 720 BHP',
    description: 'The Ferrari F8, produced from 2019 to 2022, was the final evolution of Ferrari\'s mid-engine twin-turbo V8 sports car lineage that began with the 488. Available as Tributo (coupe) and Spider, it delivered 710 bhp from its award-winning 3.9-litre V8.',
    getBody: `if (/spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/spider/i.test(title)) return 'spider';\n      return 'tributo';`,
    getTransmission: `return 'dct';`,
    variantLabels: { tributo: 'Tributo', spider: 'Spider' },
    variantOrder: ['tributo', 'spider'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'roma',
    displayName: 'Roma',
    fullName: 'Ferrari Roma',
    heroYears: '2020 — present',
    heroEngine: '3.9L Twin-Turbo V8',
    heroBhp: '612 BHP',
    description: 'The Ferrari Roma, produced from 2020, is a front-engined V8 grand tourer inspired by the carefree lifestyle of 1960s Rome. With elegant Pininfarina-influenced styling and a 3.9-litre twin-turbo V8, the Roma blends classic beauty with modern performance.',
    getBody: `if (/spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `return 'roma';`,
    getTransmission: `return 'dct';`,
    variantLabels: { roma: 'Roma' },
    variantOrder: ['roma'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'sf90',
    displayName: 'SF90',
    fullName: 'Ferrari SF90',
    heroYears: '2020 — present',
    heroEngine: '4.0L V8 Hybrid',
    heroBhp: '986 — 1,016 BHP',
    description: 'The Ferrari SF90 Stradale, produced from 2020, is Ferrari\'s plug-in hybrid supercar. Combining a 4.0-litre twin-turbo V8 with three electric motors for a combined 986 bhp, it is the most powerful series-production Ferrari. Available as Stradale and Spider variants, plus the extreme XX versions.',
    getBody: `if (/spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/xx.*spider/i.test(title)) return 'xx-spider';
      if (/xx/i.test(title)) return 'xx-stradale';
      if (/spider/i.test(title)) return 'spider';
      return 'stradale';`,
    getTransmission: `return 'dct';`,
    variantLabels: { stradale: 'Stradale', spider: 'Spider', 'xx-stradale': 'XX Stradale', 'xx-spider': 'XX Spider' },
    variantOrder: ['stradale', 'spider', 'xx-stradale', 'xx-spider'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'daytona-sp3',
    displayName: 'Daytona SP3',
    fullName: 'Ferrari Daytona SP3',
    heroYears: '2022 — present',
    heroEngine: '6.5L V12',
    heroBhp: '829 BHP',
    description: 'The Ferrari Daytona SP3, produced from 2022, is part of Ferrari\'s Icona series paying homage to legendary racing prototypes. With a 6.5-litre V12 producing 829 bhp — the most powerful Ferrari internal combustion engine ever — and open-top targa bodywork, only 599 will be made.',
    getBody: `return 'convertible';`,
    getVariant: `return 'sp3';`,
    getTransmission: `return 'dct';`,
    variantLabels: { sp3: 'SP3' },
    variantOrder: ['sp3'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: 'purosangue',
    displayName: 'Purosangue',
    fullName: 'Ferrari Purosangue',
    heroYears: '2023 — present',
    heroEngine: '6.5L V12',
    heroBhp: '715 BHP',
    description: 'The Ferrari Purosangue, produced from 2023, is Ferrari\'s first four-door, four-seat car. Powered by a naturally aspirated 6.5-litre V12 producing 715 bhp, it features suicide rear doors, all-wheel drive, and active suspension.',
    getBody: `return 'coupe';`,
    getVariant: `return 'purosangue';`,
    getTransmission: `return 'dct';`,
    variantLabels: { purosangue: 'Purosangue' },
    variantOrder: ['purosangue'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '296',
    displayName: '296',
    fullName: 'Ferrari 296',
    heroYears: '2022 — present',
    heroEngine: '3.0L V6 Hybrid',
    heroBhp: '819 — 830 BHP',
    description: 'The Ferrari 296, produced from 2022, marks the return of a mid-rear-engined V6 to Ferrari\'s road car range. Its 3.0-litre twin-turbo V6 hybrid produces up to 830 bhp. Available as GTB, GTS, and the track-focused Speciale variants.',
    getBody: `if (/gts|spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/speciale\\s*a(perta)?/i.test(title)) return 'speciale-aperta';
      if (/speciale/i.test(title)) return 'speciale';
      if (/gts/i.test(title)) return 'gts';
      return 'gtb';`,
    getTransmission: `return 'dct';`,
    variantLabels: { gtb: 'GTB', gts: 'GTS', speciale: 'Speciale', 'speciale-aperta': 'Speciale Aperta' },
    variantOrder: ['gtb', 'gts', 'speciale', 'speciale-aperta'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'f80',
    displayName: 'F80',
    fullName: 'Ferrari F80',
    heroYears: '2025 — present',
    heroEngine: '3.0L V6 Hybrid',
    heroBhp: '1,200 BHP',
    description: 'The Ferrari F80, announced in 2024, is the most powerful Ferrari ever made. Combining a 3.0-litre twin-turbo V6 with three electric motors for a combined 1,200 bhp, only 799 will be built. It succeeds the LaFerrari as Ferrari\'s flagship hypercar.',
    getBody: `return 'coupe';`,
    getVariant: `return 'f80';`,
    getTransmission: `return 'dct';`,
    variantLabels: { f80: 'F80' },
    variantOrder: ['f80'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
  },
  {
    slug: '12cilindri',
    displayName: '12Cilindri',
    fullName: 'Ferrari 12Cilindri',
    heroYears: '2024 — present',
    heroEngine: '6.5L V12',
    heroBhp: '819 BHP',
    description: 'The Ferrari 12Cilindri, produced from 2024, is Ferrari\'s front-engined V12 grand tourer succeeding the 812. With a naturally aspirated 6.5-litre V12 producing 819 bhp, it is available as a coupe and Spider.',
    getBody: `if (/spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/spider/i.test(title)) return 'spider';\n      return '12cilindri';`,
    getTransmission: `return 'dct';`,
    variantLabels: { '12cilindri': '12Cilindri', spider: 'Spider' },
    variantOrder: ['12cilindri', 'spider'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'monza-sp1',
    displayName: 'Monza SP1',
    fullName: 'Ferrari Monza SP1',
    heroYears: '2019 — 2020',
    heroEngine: '6.5L V12',
    heroBhp: '799 BHP',
    description: 'The Ferrari Monza SP1, produced from 2019, is a single-seat barchetta from Ferrari\'s Icona series. Powered by the most powerful Ferrari V12 at the time with 799 bhp, the SP1 pays homage to legendary Ferrari racing barchettas of the 1950s. Only 499 SP1 and SP2 combined were built.',
    getBody: `return 'convertible';`,
    getVariant: `return 'sp1';`,
    getTransmission: `return 'dct';`,
    variantLabels: { sp1: 'SP1' },
    variantOrder: ['sp1'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: 'monza-sp2',
    displayName: 'Monza SP2',
    fullName: 'Ferrari Monza SP2',
    heroYears: '2019 — 2020',
    heroEngine: '6.5L V12',
    heroBhp: '799 BHP',
    description: 'The Ferrari Monza SP2, produced from 2019, is a two-seat barchetta from Ferrari\'s Icona series, sharing the SP1\'s 6.5-litre V12 producing 799 bhp. The SP2 adds a passenger seat and windscreen, offering a slightly more practical take on the open-top speedster concept.',
    getBody: `return 'convertible';`,
    getVariant: `return 'sp2';`,
    getTransmission: `return 'dct';`,
    variantLabels: { sp2: 'SP2' },
    variantOrder: ['sp2'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: 'amalfi',
    displayName: 'Amalfi',
    fullName: 'Ferrari Amalfi',
    heroYears: '2025 — present',
    heroEngine: '3.0L V6 Hybrid',
    heroBhp: 'TBC',
    description: 'The Ferrari Amalfi is one of Ferrari\'s newest models, continuing the brand\'s tradition of combining cutting-edge technology with Italian design excellence.',
    getBody: `return 'convertible';`,
    getVariant: `return 'amalfi';`,
    getTransmission: `return 'dct';`,
    variantLabels: { amalfi: 'Amalfi' },
    variantOrder: ['amalfi'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { convertible: 'Convertible' },
    bodyOrder: ['convertible'],
  },
  {
    slug: '849-testarossa',
    displayName: '849 Testarossa',
    fullName: 'Ferrari 849 Testarossa',
    heroYears: '2025 — present',
    heroEngine: 'V12',
    heroBhp: 'TBC',
    description: 'The Ferrari 849 Testarossa pays homage to the legendary Testarossa lineage. Available as a coupe and spider, it continues Ferrari\'s tradition of iconic mid-engined grand tourers.',
    getBody: `if (/spider/i.test(title)) return 'convertible';\n      return null;`,
    getVariant: `if (/spider/i.test(title)) return 'spider';\n      return '849-testarossa';`,
    getTransmission: `return 'dct';`,
    variantLabels: { '849-testarossa': '849 Testarossa', spider: 'Spider' },
    variantOrder: ['849-testarossa', 'spider'],
    transmissionLabels: { dct: 'DCT' },
    transmissionOrder: ['dct'],
    bodyLabels: { coupe: 'Coupe', convertible: 'Convertible' },
    bodyOrder: ['coupe', 'convertible'],
  },
  {
    slug: 'luce',
    displayName: 'Luce',
    fullName: 'Ferrari Luce',
    heroYears: '2025 — present',
    heroEngine: 'Electric',
    heroBhp: 'TBC',
    description: 'The Ferrari Luce is Ferrari\'s first all-electric vehicle, representing a bold new chapter for the marque. It combines Ferrari\'s design philosophy and performance DNA with zero-emission electric powertrain technology.',
    getBody: `return 'coupe';`,
    getVariant: `return 'luce';`,
    getTransmission: `return 'electric';`,
    variantLabels: { luce: 'Luce' },
    variantOrder: ['luce'],
    transmissionLabels: { electric: 'Electric' },
    transmissionOrder: ['electric'],
    bodyLabels: { coupe: 'Coupe' },
    bodyOrder: ['coupe'],
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
    `href="/analysis/ferrari-${model.slug}"`
  );

  // D. Auction empty text
  html = html.replace(
    /No Ferrari 458 auctions/,
    `No ${model.fullName} auctions`
  );

  // E. API fetch URL
  html = html.replace(
    /fetch\('\/api\/listings\/ferrari-458'\)/,
    `fetch('/api/listings/ferrari-${model.slug}')`
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

console.log('=== Ferrari Page Generator ===\n');

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
  const slug = `ferrari-${model.slug}`;
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
        heroImage: getHeroImage(model.slug),
        heroCredit: 'Ferrari S.p.A.',
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

// Update models.json
console.log('\nUpdating models.json...');
const modelsData = JSON.parse(fs.readFileSync(MODELS_JSON_PATH, 'utf8'));
const existingSlugs = new Set(modelsData.models.map(m => m.slug));

let modelsAdded = 0;
for (const model of MODELS) {
  const slug = `ferrari-${model.slug}`;
  if (existingSlugs.has(slug)) {
    continue;
  }

  modelsData.models.push({
    slug,
    make: 'Ferrari',
    model: model.displayName,
    heroImage: getHeroImage(model.slug),
    heroCredit: 'Ferrari S.p.A.',
    description: model.description,
    sources: {},
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
