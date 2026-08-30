import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true });
  }
  return _stripe;
}

export const STRIPE_PUBLISHABLE_KEY = 'pk_test_51U8gR0JA76bx8Cldoe42W0btG0aVrCZTsuGsT6HMi9BzRCxtKdyX8wMTi4tCl603TCnTWQhkYGj9YLxcwbPNqDye00AcrHnH0A';

export type Tier = 'starter' | 'indicators' | 'core' | 'core-max' | 'pro' | 'pro-max';

export const PRICES: Record<Tier, { monthly: string; yearly: string }> = {
  starter: {
    monthly: 'price_1U8guSJ7hrWJKGIDMAoIaBDK',
    yearly: 'price_1U8guRJ7hrWJKGIDoStIvvFq',
  },
  indicators: {
    monthly: 'price_1U9TjxJ7hrWJKGIDSuyhBa87',
    yearly: 'price_1U9TkyJ7hrWJKGIDWvqV0Ftz',
  },
  core: {
    monthly: 'price_1U8guUJ7hrWJKGIDyfhkan6N',
    yearly: 'price_1U8guRJ7hrWJKGID1cVHPggI',
  },
  'core-max': {
    monthly: 'price_1U9TltJ7hrWJKGIDMgGMYXgZ',
    yearly: 'price_1U9TmaJ7hrWJKGID1psiYxf3',
  },
  pro: {
    monthly: 'price_1U8guRJ7hrWJKGIDrN0x5x4t',
    yearly: 'price_1U8guRJ7hrWJKGIDsgr7MCXS',
  },
  'pro-max': {
    monthly: 'price_1U9TnEJ7hrWJKGID5zzz88Xu',
    yearly: 'price_1U9To0J7hrWJKGIDe1JzWoIg',
  },
};

const PRICE_TO_TIER: Record<string, Tier> = {};
for (const [tier, periods] of Object.entries(PRICES)) {
  for (const priceId of Object.values(periods)) {
    if (priceId) PRICE_TO_TIER[priceId] = tier as Tier;
  }
}

export function tierFromPriceId(priceId: string): Tier | null {
  return PRICE_TO_TIER[priceId] || null;
}

export function tierIncludesIndicators(tier: string): boolean {
  return tier === 'indicators' || tier === 'core-max' || tier === 'pro-max';
}

export function tierBaseName(tier: string): 'starter' | 'core' | 'pro' | 'indicators' {
  if (tier === 'core-max') return 'core';
  if (tier === 'pro-max') return 'pro';
  return tier as 'starter' | 'core' | 'pro' | 'indicators';
}
