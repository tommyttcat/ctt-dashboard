/* scripts/catalyst.test.mts — the headline, as the reader sees it.
 *
 * Headlines are stored HTML-escaped in KV and React escapes again on render,
 * so "Nvidia&#39;s" printed as itself on every table that showed one. The
 * decode is on the read path, which means it runs on text the feeds control:
 * the interesting cases are not the happy ones but double-escaping, partial
 * entities, and anything that could turn punctuation the publisher did not
 * write into punctuation the page claims they did.
 */

import { decodeEntities, headlineOf } from '../src/lib/catalyst.tsx';
import { tagOf, tagCounts, tapeLine, relTime, minutesSince, ageLabelMinutes, etDateKey, fmtMove } from '../src/lib/newsView.ts';
import { eq, done } from './testkit.mts';
import { headlineFromExhibit } from '../src/lib/indicators/newsAlt.ts';
import { RX_FUND_LETTER, RX_STOCK_PITCH, isQuestionFluff, pickBestNews, classifyNews, SEC_LABEL_ONLY } from '../src/lib/indicators/news.ts';

eq('numeric apostrophe', decodeEntities('Nvidia&#39;s AI Token Trade'), "Nvidia's AI Token Trade");
eq('hex numeric', decodeEntities('Nvidia&#x27;s'), "Nvidia's");
eq('hex is case-insensitive', decodeEntities('&#X27;'), "'");
eq('named ampersand', decodeEntities('S&amp;P 500'), 'S&P 500');
eq('quotes and angles', decodeEntities('&quot;Project Jupiter&quot; &lt;woes&gt;'), '"Project Jupiter" <woes>');
eq('non-breaking space becomes a space', decodeEntities('a&nbsp;b'), 'a b');
eq('several in one line', decodeEntities('AT&amp;T&#39;s Q3'), "AT&T's Q3");

/* The ampersand decodes LAST so an escaped entity stays an entity. Decoding
   &amp; first would turn "&amp;#39;" into "&#39;" and then into an apostrophe
   the publisher never wrote. */
eq('double-escaped entity stops one level short', decodeEntities('&amp;#39;'), '&#39;');
eq('double-escaped ampersand', decodeEntities('&amp;amp;'), '&amp;');

// Left alone rather than guessed at.
eq('unknown named entity is untouched', decodeEntities('&mdash; dash'), '&mdash; dash');
eq('a bare ampersand is untouched', decodeEntities('R&D spending'), 'R&D spending');
eq('an unterminated entity is untouched', decodeEntities('100 &#39 cents'), '100 &#39 cents');
eq('empty string', decodeEntities(''), '');

// headlineOf reads the three payload shapes and trims.
eq('reads thesis', headlineOf({ thesis: '  Why Is MARA Surging?  ' }), 'Why Is MARA Surging?');
eq('falls back to news', headlineOf({ news: 'Older shape' }), 'Older shape');
eq('falls back to headline', headlineOf({ headline: 'Oldest shape' }), 'Oldest shape');
eq('decodes on the way out', headlineOf({ thesis: 'AT&amp;T&#39;s Q3' }), "AT&T's Q3");
eq('nothing is null, not an empty string', headlineOf({}), null);
eq('whitespace only is null', headlineOf({ thesis: '   ' }), null);
eq('an entity that decodes to whitespace is null', headlineOf({ thesis: '&nbsp;' }), null);

/* ---- News page presentation (src/lib/newsView.ts) -------------------------
   Two feeds, two tag vocabularies, one key. And the ages: the wire has a
   timestamp, the scan rows only the label the scanner printed. */

// Tags from either feed fold to one key; the no-category placeholder is general.
eq('wire FDA', tagOf('FDA'), 'fda');
eq('wire WIIM', tagOf('WIIM'), 'wiim');
eq('wire placeholder is general', tagOf('TECH MOMENTUM'), 'general');
eq('pool FDA / Data', tagOf('FDA / Data'), 'fda');
eq('pool M&A', tagOf('M&A'), 'mna');
eq('pool delayed suffix is ignored', tagOf('Earnings (Delayed)'), 'earnings');
eq('pool placeholder is general', tagOf('Technical Momentum'), 'general');
eq('unknown tag is general, not a guess', tagOf('Crypto'), 'general');
eq('missing tag is general', tagOf(null), 'general');

// The hero line: most-cited first, general left out, singular vs plural.
const counted = tagCounts(['wiim', 'fda', 'general', 'wiim', 'mna', 'general', 'general', 'mna', 'wiim']);
eq('counts sort most-cited first', counted.map(c => c.tag).join(','), 'wiim,general,mna,fda');
eq('tape line', tapeLine(counted), "3 why-it's-moving stories · 2 takeover reports · 1 FDA");
eq('tape line singular', tapeLine([{ tag: 'upgrade', n: 1 }]), '1 upgrade');
eq('tape line is empty when all general', tapeLine([{ tag: 'general', n: 12 }]), '');
eq('tape line caps at max', tapeLine(tagCounts(['fda', 'earnings', 'mna', 'upgrade', 'macro']), 2).split(' · ').length, 2);

// Relative time reads in words.
eq('under a minute', relTime(0), 'just now');
eq('minutes', relTime(12), '12 min ago');
eq('hours', relTime(185), '3 hr ago');
eq('one day', relTime(24 * 60), '1 day ago');
eq('days', relTime(4 * 24 * 60), '4 days ago');
eq('unknown is empty', relTime(null), '');

const NOW = Date.parse('2026-09-24T20:00:00Z');
eq('minutes since an ISO time', minutesSince('2026-09-24T19:48:00Z', NOW), 12);
eq('a future timestamp is zero, not negative', minutesSince('2026-09-24T20:05:00Z', NOW), 0);
eq('an unparseable timestamp is null', minutesSince('yesterday', NOW), null);

// The scan rows' printed labels parse back to minutes.
eq('label hours', ageLabelMinutes('8h ago'), 480);
eq('label minutes', ageLabelMinutes('15m ago'), 15);
eq('label days', ageLabelMinutes('2d ago'), 2880);
eq('label spelled out', ageLabelMinutes('12 min ago'), 12);
eq('label just now', ageLabelMinutes('just now'), 0);
eq('an unreadable label is null', ageLabelMinutes('recently'), null);

// "Today" is New York's date: 01:00 UTC on the 25th is still the 24th in ET.
eq('ET date across UTC midnight', etDateKey(Date.parse('2026-09-25T01:00:00Z')), '2026-09-24');

eq('move up', fmtMove(4.27), '+4.3%');
eq('move down', fmtMove(-1.24), '-1.2%');
eq('move unknown', fmtMove(null), '');

// SEC exhibit headlines (26 Oct 2026, first live day): stacked tags, cover lines, entities, datelines
eq('exhibit: stacked EX-99.1 / Exhibit 99.1 tags go', headlineFromExhibit("EX-99.1 Exhibit 99.1 EQT Announces Strategic Acquisition of Range Resources, Creating America's Largest Gas Producer PITTSBURGH, Oct. 26, 2026 -- body"), "EQT Announces Strategic Acquisition of Range Resources, Creating America's Largest Gas Producer");
eq('exhibit: an all-caps dateline does not eat the last words', headlineFromExhibit('<p>Exhibit 99.1</p><p>HealthSpan Partners to Acquire Surgery Partners, Establishing a Leading Outpatient Platform</p><p>NASHVILLE, Tenn., Oct. 26, 2026 (BUSINESS WIRE) -- text</p>'), 'HealthSpan Partners to Acquire Surgery Partners, Establishing a Leading Outpatient Platform');
eq('exhibit: cover line and &reg; go', headlineFromExhibit('PRESENTATION DATED OCTOBER 26, 2026 Exhibit 99.1 &reg; Designing Proteins Delivering Medicines -- more'), 'Designing Proteins Delivering Medicines');
eq('exhibit: slide-deck glyphs + financial table is no headline (CLS 27 Oct)', headlineFromExhibit('Exhibit 99.1 •••• ➜➜➜ •••• ➜➜➜ ➜➜➜➜ •• ➜ • • • • ➜ • ✓✓ ✓✓ ✓✓ ✓✓ •••••• ••• ➜➜➜ (In millions of U.S. dollars, except percentages) FY 2025 FY 2024 FY 2023 Revenue $ 12,390.9 $ 9,646.0 $ 7,961.0 Net earnings 832.5'), null);
eq('exhibit: a table without glyphs is no headline either', headlineFromExhibit('Exhibit 99.1 Selected Financial Data (in thousands, except per share amounts) Revenue 1,204 980 Net income 88 61'), null);
eq('exhibit: a headline with one dollar figure survives', headlineFromExhibit('Exhibit 99.1 Acme Wins $1.2 Billion Navy Contract, Raises Full-Year Outlook DALLAS, Oct. 27, 2026 -- body'), 'Acme Wins $1.2 Billion Navy Contract, Raises Full-Year Outlook');
eq('exhibit: cover line before the 99.1 banner goes (UPS 27 Oct)', headlineFromExhibit('EX-99.1 2 exhibit991-earningspressre.htm EX-99.1 PRESS RELEASE FIRST QUARTER EARNINGS Document Exhibit 99.1 UPS RELEASES 3Q 2026 EARNINGS (BUSINESS WIRE) -- body'), 'UPS RELEASES 3Q 2026 EARNINGS');
eq('exhibit: an investor deck disclaimer is no headline (GLXY 27 Oct)', headlineFromExhibit('EX-99.2 3 exhibit992-glxyq32026ove.htm EX-99.2 exhibit992-glxyq32026ove 1 GALAXY As of September 30, 2026 Q3 26 Investor.galaxy.com Exhibit 99.2 2 GALAXY Disclaimer This presentation, and the information contained herein'), null);
eq("classify: 'After Blowout Q3' is earnings", classifyNews("CLS Stock Soars Premarket After Blowout Q3"), 'Earnings');
{
  // News page review, 27 Oct 2026: each of these reached a ★★ card.
  const at = Date.parse('2026-10-27T16:00:00Z');
  const one = (title: string, publisher: string, url = '') => pickBestNews([{ title, article_url: url, published_utc: '2026-10-27T14:00:00Z', tickers: ['X'], publisher: { name: publisher } }], 'X', at);
  eq('drop: Seeking Alpha contributor article', one('Lumentum: Sold Out Is Not The Same As Scalable', 'Seeking Alpha', 'https://seekingalpha.com/article/4957554-lumentum'), null);
  eq('keep: Seeking Alpha news item', one('Lumentum raises Q2 guidance on datacenter demand', 'Seeking Alpha', 'https://seekingalpha.com/news/4500000-lumentum')?.publisher, 'Seeking Alpha');
  eq('drop: earnings-date notice', one('Iovance Biotherapeutics to Report Third Quarter 2026 Financial Results and Corporate Updates on Thursday, November 5, 2026', 'GlobeNewsWire'), null);
  eq('drop: webinar notice', one('Recursion to Host Webinar Focused on Updated REC-4881 (FAP) Data', 'GlobeNewsWire'), null);
  eq('drop: 13F holdings post', one('Hewlett Packard Enterprise Company $HPE Stake Raised by Citizens Financial Group Inc.', 'Business Wire'), null);
  eq('drop: new-investment post', one('Citizens Financial Group Inc. RI Makes New $1.90 Million Investment in ProShares UltraPro QQQ', 'Business Wire'), null);
  eq('drop: small insider sale post', one('Zoom Communications (NASDAQ:ZM) Director Sells $69,283.71 in Stock', 'Business Wire'), null);
  eq('drop: Zacks #1 pitch', one('This Top Transportation Stock is a #1 (Strong Buy): Why It Should Be on Your Radar', 'Benzinga'), null);
  eq('drop: analyst roundup', one('UnitedHealth Group To Rally Over 29%? Here Are 10 Top Analyst Forecasts For Tuesday', 'Benzinga'), null);
  eq('drop: list ranking', one("GigaCloud Technology Inc Ranks Among Top 15 on Fortune's Fastest Growing Companies", 'GlobeNewswire'), null);
  eq('drop: MarketBeat network publisher', one('Danaher Corporation Announces Dividend', 'Defense World'), null);
  eq('keep: real earnings release', one('SoFi Reports Third Quarter 2026 with Record Net Revenue of $1.4 Billion and Raises Full-Year Guidance', 'Business Wire')?.tag, 'Earnings');
  eq('keep: real partnership', one("AMD and Meta Advance Strategic Partnership to Power Meta's Superintelligence Infrastructure", 'GlobeNewsWire')?.publisher, 'GlobeNewsWire');
  eq('zero-width characters do not hide a question', one('\u200b\u200bWill Nvidia Keep Rising?', 'Business Wire'), null);
}
{
  const at = Date.parse('2026-10-27T16:00:00Z');
  const label = { title: 'CELESTICA INC 8-K: reports quarterly results', description: '8-K items 2.02, 9.01: reports quarterly results', published_utc: '2026-10-27T11:00:00Z', tickers: ['CLS'], publisher: { name: 'SEC' }, keywords: [SEC_LABEL_ONLY] };
  const st = { title: "CLS Stock Soars Premarket After Blowout Q3 - Retail Calls It 'Very Inexpensive'", description: 'Celestica shares jumped premarket after third-quarter results topped estimates and the company raised its outlook.', published_utc: '2026-10-27T08:17:00Z', tickers: ['CLS', 'CRWV', 'NBIS'], publisher: { name: 'Stocktwits' } };
  eq('label-only 8-K yields to a same-day press headline', pickBestNews([label, st], 'CLS', at)?.publisher, 'Stocktwits');
  const real = { ...label, title: 'Celestica Reports Third Quarter 2026 Financial Results, Raises Outlook', keywords: undefined };
  eq('an 8-K with a real headline keeps the row', pickBestNews([real, st], 'CLS', at)?.publisher, 'SEC');
  eq('label-only 8-K still shows when nothing else exists', pickBestNews([label], 'CLS', at)?.publisher, 'SEC');
}
// Fund letters blocked (26 Oct 2026)
for (const t of ['Baron Health Care Fund Q3 2026 Top Contributors And Detractors', 'Ariel Fund Q3 2026 Leaders And Laggards', 'Longleaf Partners Q3 2026 Commentary', 'Greenlight Capital Q3 2026 Investor Letter'])
  eq(`fund letter blocked: ${t}`, RX_FUND_LETTER.test(t), true);
for (const t of ['WCN Stock Gains 11% After Reporting Q3 Earnings & Revenue Beat', 'EQT Announces Strategic Acquisition of Range Resources', 'Citigroup Lifts 2026 RoTCE Outlook', 'Intel Q3 Preview: Server CPU Shortage Sets Up A Pricing Tailwind', 'Nvidia reports Q3 2026 results'])
  eq(`real news kept: ${t}`, RX_FUND_LETTER.test(t), false);
// Speculative question headlines blocked (26 Oct 2026)
for (const t of ["Will JPMorgan's Nigeria Expansion Bolster Its Growth Prospects?", "Vince Holding's Wholesale Growth: Can Strong Momentum Continue?", "Etsy's Q3 Earnings Ahead: What's in Store for the Stock?", "Coca-Cola's Sports Beverage Portfolio: Can it Capture Fitness Demand?", 'Is Nvidia a Buy Before Earnings?'])
  eq(`question fluff blocked: ${t}`, isQuestionFluff(t), true);
for (const t of ['Why Is Nvidia Stock Soaring Today?', "What's Going On With Tesla Stock?", "Citigroup Lifts 2026 RoTCE Outlook: What's Fueling the Optimism?", 'Bon Secours Affiliate to Acquire Surgery Partners in $5.7 Billion Take-Private Deal', 'Intel Q3 Preview: Server CPU Shortage Sets Up A Pricing Tailwind'])
  eq(`kept: ${t}`, isQuestionFluff(t), false);
// Stock-pitch promos blocked (26 Oct 2026)
for (const t of ['Why Landmark Bancorp (LARK) is a Great Dividend Stock Right Now', 'Why Ameren (AEE) is a Top Dividend Stock for Your Portfolio', 'This is Why Shinhan Financial (SHG) is a Great Dividend Stock', 'Invesco (IVZ) Could Be a Great Choice'])
  eq(`pitch blocked: ${t}`, RX_STOCK_PITCH.test(t), true);
for (const t of ['SpaceX locks in $40B GPU financing deal with Apollo', 'TNGX Stock Falls 16% Despite Positive Pancreatic Cancer Study Data', 'Why Is Nvidia Stock Soaring Today?', 'Apple is a top supplier to the new console'])
  eq(`kept: ${t}`, RX_STOCK_PITCH.test(t), false);
done('catalyst headlines + news view');
