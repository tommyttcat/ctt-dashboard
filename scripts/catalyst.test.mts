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

done('catalyst headlines');
