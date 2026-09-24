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

done('catalyst headlines + news view');
