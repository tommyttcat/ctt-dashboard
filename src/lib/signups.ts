/**
 * Sign-ups closed (11 Nov 2026). CTT is now owner-only and non-commercial —
 * no new accounts from the invite code, pricing, subscribe or Stripe checkout.
 * Existing accounts still sign in; admins can still add users from /admin.
 * Stripe's portal and webhook stay up so any existing subscription can be
 * managed or cancelled. Flip to false to reopen.
 */
export const SIGNUPS_CLOSED = true;

export const SIGNUP_PAGES = ['/pricing', '/subscribe', '/invite', '/welcome'];
