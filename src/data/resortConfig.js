export const RESORT_CONFIG = {
  name: 'Whistler Blackcomb',
  operator: 'Vail Resorts',
  location: { lat: 50.1163, lng: -122.9574 },
  elevation: { base: 675, village: 675, whistlerPeak: 2182, blackcombPeak: 2440, highestLift: 2284 },
  skiableAcres: 8171,
  namedRuns: 200,
  longestRun: 11, // km
  averageSnowfall: 1164, // cm per year
  seasonDates: { open: '11-22', close: '05-24' },
  epicPassPrice: 979,
  dayPassPrice: 239,
  operatingCosts: {
    dailyBase: 450000,
    liftOperationsPerLift: 8000,
    snowmakingPerHour: 12000,
    groomingPerRun: 2500,
    staffPerEmployee: 180,
  },
  staffing: {
    liftOps: 400, patrol: 120, instructors: 250, grooming: 80,
    foodService: 350, retail: 150, admin: 100, maintenance: 90
  },
  popularTimes: {
    weekday: [0.3, 0.5, 0.8, 1.0, 0.9, 0.7, 0.4, 0.2],
    weekend: [0.5, 0.8, 1.0, 1.0, 0.9, 0.8, 0.6, 0.3],
    holiday: [0.7, 0.9, 1.0, 1.0, 1.0, 0.9, 0.8, 0.5]
  },
  upgrades: [
    { id: 'new-gondola', name: 'New High-Speed Gondola', cost: 25000000, effect: { liftCapacity: 0.15 }, description: 'Install a new 10-person gondola' },
    { id: 'snowmaking-expansion', name: 'Snowmaking Expansion', cost: 8000000, effect: { snowCoverage: 0.2 }, description: 'Expand snowmaking to 30% more terrain' },
    { id: 'luxury-hotel', name: 'Luxury Hotel Development', cost: 45000000, effect: { hotelRevenue: 0.25 }, description: 'Build a new 5-star hotel in the village' },
    { id: 'terrain-park', name: 'World-Class Terrain Park', cost: 3000000, effect: { teenSatisfaction: 0.3 }, description: 'Build a competition-grade terrain park' },
    { id: 'village-expansion', name: 'Village Retail Expansion', cost: 15000000, effect: { shopRevenue: 0.2 }, description: 'Add new retail spaces to the village' },
    { id: 'parking-structure', name: 'Multi-Level Parking', cost: 12000000, effect: { parkingCapacity: 0.5 }, description: 'Build a multi-level parking structure' },
    { id: 'night-skiing', name: 'Night Skiing Infrastructure', cost: 7000000, effect: { operatingHours: 0.3 }, description: 'Install lighting for night skiing on select runs' },
    { id: 'restaurant-upgrade', name: 'On-Mountain Dining Upgrade', cost: 5000000, effect: { foodRevenue: 0.15 }, description: 'Renovate and expand on-mountain restaurants' },
  ]
};
