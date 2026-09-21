// lib/freeAccess.ts — everyone who signs up gets in, for now.
//
// WHAT IT DOES
// ------------
// While NEXT_PUBLIC_FREE_ACCESS is '1', any ACTIVE signed-in user reaches
// every gated page regardless of the tier on their record, and a trial clock
// that has run out does not lock them out. Sign-up and sign-in are unchanged:
// people still create an account and still prove the email is theirs by
// clicking a magic link. Nothing is free that was not already behind a login;
// what is free is the tier.
//
// WHY A FLAG AND NOT A TIER CHANGE
// --------------------------------
// The other way to do this is to write 'pro' onto every new account. That is
// one line too, and it is a trap: when billing turns on, every account created
// during the free period is a pro row that has never paid, and someone has to
// find and rewrite them all by hand. A flag writes nothing. Turn it off and
// tier gating is exactly what it was, with every record still true.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH
// -----------------------------------
//   ADMIN. /admin still requires isAdmin. A flag that could hand out the admin
//   panel would be a different kind of thing entirely.
//   EMAILS. Who receives which briefing is still decided by tier and by each
//   user's own preferences — free access to the site is not a licence to start
//   mailing everybody.
//   BILLING. Stripe is untouched. Existing subscriptions keep working and the
//   pricing page still sells.
//
// NEXT_PUBLIC_ so one variable serves both sides: the middleware reads it to
// open the gate, the nav and the help modal read it to stop offering upgrades
// for things the reader already has. It is a feature flag, not a secret — its
// effect is visible to anyone who loads the site. Being inlined at build time,
// changing it takes a redeploy, not just an env edit.

export const FREE_ACCESS = process.env.NEXT_PUBLIC_FREE_ACCESS === '1';
