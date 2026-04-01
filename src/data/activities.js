/**
 * Activities Catalog - Additional resort activities beyond skiing.
 *
 * Each activity specifies its season, build cost, daily financials,
 * guest capacity, target demographic(s), satisfaction bonus, and a
 * short description shown in the build menu.
 *
 * season values: 'winter' | 'summer' | 'year-round'
 * targetDemographic: one or more of 'family' | 'teenager' | 'expert' |
 *                    'beginner' | 'tourist' | 'senior' | 'all'
 */

// ---------------------------------------------------------------------------
// Winter activities
// ---------------------------------------------------------------------------

const WINTER_ACTIVITIES = [
  {
    id: 'terrain-park-basic',
    name: 'Basic Terrain Park',
    season: 'winter',
    buildCost: 1_000_000,
    dailyRevenue: 8_000,
    dailyExpense: 3_000,
    guestCapacity: 200,
    targetDemographic: 'teenager',
    satisfactionBonus: 0.10,
    description:
      'Jumps, rails, and boxes for freestyle skiing and snowboarding. ' +
      'Attracts younger riders and improves the resort\'s trick-skiing reputation.',
  },
  {
    id: 'terrain-park-competition',
    name: 'Competition Terrain Park',
    season: 'winter',
    buildCost: 3_000_000,
    dailyRevenue: 20_000,
    dailyExpense: 8_000,
    guestCapacity: 400,
    targetDemographic: 'teenager',
    satisfactionBonus: 0.20,
    description:
      'A full-size competition-standard terrain park with halfpipe, superpipe, ' +
      'and big-air features. Host events to attract sponsorship revenue.',
  },
  {
    id: 'cross-country-trails',
    name: 'Cross-Country Trail Network',
    season: 'winter',
    buildCost: 500_000,
    dailyRevenue: 5_000,
    dailyExpense: 1_500,
    guestCapacity: 150,
    targetDemographic: ['senior', 'family'],
    satisfactionBonus: 0.08,
    description:
      'Groomed Nordic trails winding through forested terrain. Popular with ' +
      'fitness-focused guests and families looking for a quieter mountain experience.',
  },
  {
    id: 'snowshoe-tours',
    name: 'Guided Snowshoe Tours',
    season: 'winter',
    buildCost: 200_000,
    dailyRevenue: 3_000,
    dailyExpense: 800,
    guestCapacity: 60,
    targetDemographic: ['tourist', 'senior'],
    satisfactionBonus: 0.05,
    description:
      'Guided wilderness snowshoe experiences for guests who want to explore ' +
      'the mountain without skis. Low barrier-to-entry and high satisfaction.',
  },
  {
    id: 'tubing-park',
    name: 'Snow Tubing Park',
    season: 'winter',
    buildCost: 800_000,
    dailyRevenue: 12_000,
    dailyExpense: 2_000,
    guestCapacity: 300,
    targetDemographic: 'family',
    satisfactionBonus: 0.12,
    description:
      'Dedicated tubing lanes with a carpet lift return. One of the most ' +
      'popular family attractions on the mountain — no ski experience needed.',
  },
  {
    id: 'ice-skating-rink',
    name: 'Outdoor Ice Skating Rink',
    season: 'winter',
    buildCost: 1_500_000,
    dailyRevenue: 8_000,
    dailyExpense: 3_000,
    guestCapacity: 200,
    targetDemographic: ['family', 'tourist'],
    satisfactionBonus: 0.08,
    description:
      'A refrigerated outdoor rink in the village plaza. Skate rentals ' +
      'included in the ticket price. Great for après-ski evenings.',
  },
  {
    id: 'backcountry-tours',
    name: 'Guided Backcountry Tours',
    season: 'winter',
    buildCost: 300_000,
    dailyRevenue: 6_000,
    dailyExpense: 2_000,
    guestCapacity: 40,
    targetDemographic: 'expert',
    satisfactionBonus: 0.06,
    description:
      'Small-group guided tours into the resort\'s backcountry zones with ' +
      'certified avalanche guides. A premium offering for expert adventurers.',
  },
  {
    id: 'ski-lessons-center',
    name: 'Ski & Snowboard Lessons Center',
    season: 'winter',
    buildCost: 2_000_000,
    dailyRevenue: 25_000,
    dailyExpense: 10_000,
    guestCapacity: 500,
    targetDemographic: ['beginner', 'family'],
    satisfactionBonus: 0.15,
    description:
      'A dedicated lessons hub with certified instructors offering group and ' +
      'private sessions for all ages and skill levels. Boosts beginner retention.',
  },
  {
    id: 'kids-adventure-zone',
    name: 'Kids\' Adventure Zone',
    season: 'winter',
    buildCost: 1_000_000,
    dailyRevenue: 10_000,
    dailyExpense: 4_000,
    guestCapacity: 250,
    targetDemographic: 'family',
    satisfactionBonus: 0.10,
    description:
      'A dedicated ski area for children featuring gentle terrain, themed ' +
      'obstacles, and supervised play zones. Makes the resort highly appealing ' +
      'to families with young children.',
  },
];

// ---------------------------------------------------------------------------
// Summer activities
// ---------------------------------------------------------------------------

const SUMMER_ACTIVITIES = [
  {
    id: 'zip-line',
    name: 'Zip Line Course',
    season: 'summer',
    buildCost: 2_000_000,
    dailyRevenue: 15_000,
    dailyExpense: 3_000,
    guestCapacity: 150,
    targetDemographic: ['tourist', 'teenager'],
    satisfactionBonus: 0.10,
    description:
      'A multi-stage zip line network traversing the upper mountain. Thrilling ' +
      'views and high repeatability make this a summer revenue cornerstone.',
  },
  {
    id: 'bungee-jump',
    name: 'Bungee Jump Platform',
    season: 'summer',
    buildCost: 1_000_000,
    dailyRevenue: 8_000,
    dailyExpense: 2_000,
    guestCapacity: 80,
    targetDemographic: 'teenager',
    satisfactionBonus: 0.06,
    description:
      'A fixed bungee platform off a scenic cliff face. Draws thrill-seekers ' +
      'and generates strong social-media word-of-mouth during summer.',
  },
  {
    id: 'mountain-biking',
    name: 'Mountain Bike Park',
    season: 'summer',
    buildCost: 1_500_000,
    dailyRevenue: 12_000,
    dailyExpense: 4_000,
    guestCapacity: 300,
    targetDemographic: ['expert', 'teenager'],
    satisfactionBonus: 0.10,
    description:
      'A network of lift-accessed downhill and cross-country trails for mountain ' +
      'bikers. Bike rentals and a pump track round out the offering.',
  },
  {
    id: 'sightseeing-gondola',
    name: 'Sightseeing Gondola',
    season: 'summer',
    buildCost: 500_000,
    dailyRevenue: 20_000,
    dailyExpense: 5_000,
    guestCapacity: 2_000,
    targetDemographic: ['tourist', 'family'],
    satisfactionBonus: 0.08,
    description:
      'Enable an existing gondola for scenic summer sightseeing rides. ' +
      'High capacity and low additional build cost make this an easy win.',
  },
  {
    id: 'hiking-trails',
    name: 'Maintained Hiking Trail Network',
    season: 'summer',
    buildCost: 300_000,
    dailyRevenue: 3_000,
    dailyExpense: 500,
    guestCapacity: 500,
    targetDemographic: 'all',
    satisfactionBonus: 0.05,
    description:
      'Well-marked and maintained hiking trails from the village to the summit. ' +
      'Accessible to all fitness levels and broadens the resort\'s guest appeal.',
  },
  {
    id: 'alpine-coaster',
    name: 'Alpine Coaster',
    season: 'summer',
    buildCost: 3_000_000,
    dailyRevenue: 18_000,
    dailyExpense: 5_000,
    guestCapacity: 400,
    targetDemographic: ['family', 'teenager'],
    satisfactionBonus: 0.12,
    description:
      'A gravity-fed mountain coaster winding down a dedicated slope. Riders ' +
      'control their own speed and the experience is suitable for all ages.',
  },
  {
    id: 'ropes-course',
    name: 'Aerial Ropes Course',
    season: 'summer',
    buildCost: 800_000,
    dailyRevenue: 6_000,
    dailyExpense: 2_000,
    guestCapacity: 100,
    targetDemographic: ['family', 'teenager'],
    satisfactionBonus: 0.06,
    description:
      'A treetop ropes course and aerial adventure park set among the mountain ' +
      'pines. Encourages teamwork and is a popular group-booking activity.',
  },
  {
    id: 'disc-golf',
    name: 'Disc Golf Course',
    season: 'summer',
    buildCost: 100_000,
    dailyRevenue: 1_000,
    dailyExpense: 200,
    guestCapacity: 200,
    targetDemographic: 'all',
    satisfactionBonus: 0.03,
    description:
      'An 18-hole disc golf course routed through the alpine meadows. Very ' +
      'low cost to build and maintain; keeps guests on-site longer.',
  },
];

// ---------------------------------------------------------------------------
// Exported catalog
// ---------------------------------------------------------------------------

export const ACTIVITIES = [...WINTER_ACTIVITIES, ...SUMMER_ACTIVITIES];

export default ACTIVITIES;
