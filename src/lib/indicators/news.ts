/* News — Polygon article selection and classification
   ==================================================================
   Takes the raw results from Polygon's /v2/reference/news and picks the one
   article, if any, that actually explains why a stock is moving.

   ------------------------------------------------------------------
   WHY THIS REPLACED BENZINGA WIIM

   WIIM matched 3 of 80 scanned names — under 4% — and 58 fell through to
   "Technical Momentum". The cause turned out to be an entitlement rather
   than genuine coverage: the news endpoint returns an empty JSON array for
   an authenticated key without the news product, which is indistinguishable
   from a quiet news day and had therefore been invisible.

   Polygon's feed is aggregated from publishers rather than written by an
   editorial desk, so small-cap coverage is BETTER, not worse. What it does
   not give you is the "why is it moving" framing WIIM was built around —
   that has to be inferred from the headline, which is what this module does.

   ------------------------------------------------------------------
   THE REAL PROBLEM IS NOT COVERAGE, IT IS SIGNAL-TO-NOISE.

   An aggregated feed carries everything: Zacks rank updates generated on a
   schedule, Motley Fool listicles, Simply Wall St auto-valuations, "3 Stocks
   To Buy Before August". Those are WORSE THAN NO CATALYST, because a row
   showing a headline reads as a stock with a reason to move, and a technical
   mover dressed in a Zacks headline is a false positive you will act on.
   "No catalyst" is honest; a filler headline is a lie with a link.

   So the bulk of this file is rejection, in three layers:

     PUBLISHER   who wrote it — primary sources beat wires beat aggregators
     SHAPE       what kind of article it is — listicles, valuations, spam
     CONTENT     does the headline say WHY, or merely restate the move

   The third layer is the one that matters most and is the least obvious.
   "NVDA Shares Rise 5%" is not a catalyst; it is the move you already knew
   about, reflected back. "NVDA Rises On Blackwell Orders" is a catalyst. The
   difference is whether a causal clause exists, and it is detectable.
   ================================================================== */

export interface PolygonNewsRaw {
  id?: string;
  title?: string;
  description?: string;
  article_url?: string;
  published_utc?: string;
  author?: string;
  tickers?: string[];
  keywords?: string[];
  publisher?: { name?: string; homepage_url?: string };
  insights?: { ticker?: string; sentiment?: string; sentiment_reasoning?: string }[];
}

/* Marks an SEC 8-K whose title is only its item label (newsAlt) — see qualityOf. */
export const SEC_LABEL_ONLY = 'sec-label-only';

export type CatalystTier ='strong' | 'neutral' | 'headline' | 'negative' | 'none';
export type NewsSentiment = 'positive' | 'negative' | 'neutral' | null;

export interface NewsItem {
  title: string;
  url: string | null;
  publisher: string;
  publishedUtc: string;
  ageHours: number;
  ageLabel: string;
  tickerCount: number;
  tag: string;
  tier: CatalystTier;
  sentiment: NewsSentiment;
  sentimentReason: string | null;
  quality: number;
  /* True when the headline states a REASON rather than restating the price
     move. The single most useful bit here — see the header. */
  causal: boolean;
}

/* ---- Publishers ---------------------------------------------------------
   Tiered by how close the publisher sits to the actual event.

   PRIMARY is the company talking: press-release wires carry the 8-K, the
   contract award, the trial result. If a name is moving on something real,
   the wire usually has it first and without interpretation.

   PRESS is journalism — someone decided the story mattered enough to write.
   Slower than the wire but the selection itself is information.

   AGGREGATOR is content generated to fill a feed. Zacks publishes rank
   changes on a schedule whether or not anything happened; Simply Wall St
   produces a valuation piece for every ticker it covers; the Fool writes
   listicles continuously. NONE OF IT IS EVIDENCE THAT ANYTHING OCCURRED,
   which is exactly the property a catalyst needs.

   Unlisted publishers land in the middle rather than being rejected — the
   list cannot be exhaustive and a new wire service should not be treated as
   a listicle mill. */
const PUBLISHER_PRIMARY = new Set([
  'globenewswire', 'pr newswire', 'prnewswire', 'business wire', 'businesswire',
  'accesswire', 'newsfile', 'ein presswire', 'cision', 'sec',
]);

const PUBLISHER_PRESS = new Set([
  'reuters', 'the associated press', 'associated press', 'bloomberg',
  'the wall street journal', 'wall street journal', 'cnbc', 'barrons',
  "barron's", 'financial times', 'marketwatch', 'benzinga', 'stocktwits', 'axios',
  'the information', 'stat news', 'endpoints news', 'the new york times',
  'forbes', 'fortune', 'business insider', 'seeking alpha',
]);

/* BLOCKED publishers produce content that looks like catalyst coverage but
   is structurally incapable of being one: opinion listicles, "why did it
   move" rehashes, valuation takes, and "should you buy" framing. They pass
   the causal test because their headlines are engineered to sound causal,
   but they are never the REASON a stock moved — they are commentary ABOUT
   the move, published hours later and dressed in SEO keywords. Blocked
   publishers are rejected unconditionally regardless of headline quality. */
const PUBLISHER_BLOCKED = new Set([
  'the motley fool', 'motley fool', 'fool.com',
  'simply wall st', 'simply wall street',
  'insider monkey', 'validea',
  'talkmarkets', 'invezz',
  'stocknews.com', 'stocknews',
  'quiverquant',
  '24/7 wall st', '24/7 wall street', '247 wallst', '247wallst',
  /* MarketBeat's syndication network (27 Oct 2026): auto-written 13F and Form 4 posts
     ("Citizens Financial Makes New $1.90 Million Investment in…", "Director Sells $69,283"). */
  'defense world', 'marketbeat', 'etf daily news', 'american banking news', 'ticker report',
  'the enterprise leader', 'the cerbat gem', 'modern readers', 'the lincolnian online', 'wkrb news',
  'finbold',   // crypto-market opinion ("Which AI bubble burst?")
]);

const PUBLISHER_AGGREGATOR = new Set([
  'zacks investment research', 'zacks',
  'investorplace', 'gurufocus',
  'the street', 'thestreet', 'kiplinger', 'nasdaq',
]);

type PublisherTier = 'primary' | 'press' | 'unknown' | 'aggregator' | 'blocked';

const publisherTier = (name: string): PublisherTier => {
  const n = name.toLowerCase().trim();
  if (!n) return 'unknown';
  if (PUBLISHER_BLOCKED.has(n)) return 'blocked';
  if (PUBLISHER_PRIMARY.has(n)) return 'primary';
  if (PUBLISHER_PRESS.has(n)) return 'press';
  if (PUBLISHER_AGGREGATOR.has(n)) return 'aggregator';

  for (const p of PUBLISHER_BLOCKED) if (n.includes(p)) return 'blocked';
  for (const p of PUBLISHER_PRIMARY) if (n.includes(p)) return 'primary';
  for (const p of PUBLISHER_AGGREGATOR) if (n.includes(p)) return 'aggregator';
  for (const p of PUBLISHER_PRESS) if (n.includes(p)) return 'press';
  return 'unknown';
};

/* ---- Shape rejection ----------------------------------------------------
   Article formats that cannot be a catalyst regardless of who published
   them or how recent they are. */

// "3 Stocks To Buy", "5 Reasons", "Top 10 AI Plays" — the stock is one of a
// list, so nothing here is about this company.
const RX_LISTICLE = /^\s*(?:the\s+)?(?:top\s+)?\d+\s+(?:best\s+|top\s+|cheap\s+|hot\s+|growth\s+|dividend\s+|ai\s+|magnificent\s+)?(?:stocks?|reasons?|things?|charts?|plays?|picks?|companies|etfs?|ways?)\b/i;

// Auto-generated valuation and rank content. Published on a schedule.
const RX_ALGO_CONTENT = /\b(?:intrinsic value|fair value estimate|is (?:it|this stock) (?:over|under)valued|dcf (?:model|valuation)|zacks rank|style scores?|value score|momentum score|earnings esp|analyst blog highlights|new strong buy|added to (?:the )?zacks)\b/i;

/* News page review, 27 Oct 2026 — headlines that reached ★★ cards without saying why anything moved:
   event notices ("to Report Third Quarter Results on November 5", "to Host Webinar"), fund-holding
   and small insider-sale posts, Zacks "#1 (Strong Buy)" pitches, analyst roundups, list rankings. */
export const RX_EVENT_NOTICE = /\bto (?:report|announce|release|host|hold|present at|participate in|webcast)\b.{0,80}\b(?:results|earnings|conference call|webcast|webinar|investor day|conference|fireside chat)\b|\b(?:announces|schedules|sets) (?:the )?(?:date|timing|release date)\b|\b(?:conference call|earnings call|webcast) (?:date|schedule|notification)\b/i;
const RX_HOLDINGS = /\b(?:stake|position|holdings?|shares)\s+(?:in\s+.{1,40}?\s+)?(?:raised|lowered|cut|trimmed|boosted|increased|decreased|reduced|sold|acquired|purchased|bought)\s+by\b|\bmakes? (?:a )?new \$[\d.,]+\s*(?:million|thousand|billion|[mkb])?\s+investment in\b|\bshares (?:newly )?(?:acquired|bought|sold) by\b|\b(?:director|officer|insider|evp|svp|vp|cfo|coo|cto|ceo|president|chairman)\b.{0,40}\bsells? \$[\d,.]+ in stock\b/i;
const RX_ROUNDUP = /#\d+ \((?:strong )?buy\)|should be on your radar|\btop (?:wall street )?analyst (?:forecasts|research calls|calls|ratings)\b|\d+ top analyst forecasts|\branks? (?:among|#\d|no\. ?\d)|\bnamed (?:to|one of|among) .{0,40}\b(?:list|best|top|fastest)\b|\bleads \d+ stocks\b/i;

/** The 27 Oct rules in one call, for the market feed (/api/news) as well as pickBestNews. */
export const isNewsNoise = (title: string, url?: string | null): boolean =>
  RX_EVENT_NOTICE.test(title) || RX_HOLDINGS.test(title) || RX_ROUNDUP.test(title)
  /* Seeking Alpha's /article/ pages are contributor opinion ("Lumentum: Sold Out Is Not The Same
     As Scalable", "Wait For A Further Pullback"); its reporting lives under /news/. */
  || /seekingalpha\.com\/article\//i.test(url || '');

// Opinion and advice framing rather than event reporting.
const RX_OPINION = /\b(?:should you (?:buy|sell|own)|should (?:investors?|you) (?:consider|worry|care)|is (?:it|now) (?:a|the) (?:good )?time to buy|here(?:'?s| is) (?:why|what)|what (?:investors?|you) (?:need|should|must) (?:to )?know|my top pick|better buy|bull (?:vs\.?|versus) bear|prediction:|where will .{1,30} be in \d+ years?|is under pressure|could (?:be|make)|(?:will|can) .{1,30} keep (?:rising|falling|going)|how to (?:play|trade|invest)|worth (?:buying|selling|watching)|the case (?:for|against)|reasons? to (?:buy|sell|own|avoid)|still a buy|is it too late)\b/i;

// Legal solicitation. Carried over from the WIIM spam filter — these flood
// any feed and describe a lawsuit being organised, not a company event.
/* Fund letters (26 Oct 2026, owner: block them) — Seeking Alpha republishes managers' quarterly
   letters tagged to every holding: "Baron Health Care Fund Q3 2026 Top Contributors And
   Detractors", "Ariel Fund Q3 2026 Leaders And Laggards". Not news about the stock. */
export const RX_FUND_LETTER = /\b(?:top contributors(?:\s+(?:and|&)\s+detractors)?|contributors\s+(?:and|&)\s+detractors|leaders\s+(?:and|&)\s+laggards|(?:quarterly|investor|shareholder|annual|semi-?annual|partners?|client)\s+letter|(?:q[1-4]|quarterly|monthly|annual)\s+(?:20\d\d\s+)?(?:commentary|letter|review)|fund\s+(?:commentary|letter)|(?:fund|portfolio|strategy|etf)\s+q[1-4]\s+20\d\d)\b/i;
/* Speculative question headlines (26 Oct 2026, owner: block them) — "Will JPMorgan's Nigeria
   Expansion Bolster Its Growth Prospects?", "Wholesale Growth: Can Strong Momentum Continue?",
   "Q3 Earnings Ahead: What's in Store for the Stock?". A question that EXPLAINS a move stays:
   "Why Is X Stock Soaring Today?", "What's Going On With X Stock?". */
const RX_QUESTION_FLUFF = /(?:^|:\s*)(?:will|can|could|should|is|are|does|do|has|have|would)\b[^?]*\?\s*$|what(?:'|’)?s in store|what(?:'|’)?s (?:next|ahead) for|what lies ahead/i;
const RX_QUESTION_KEEP = /\bwhy\b|what(?:'|’)?s going on/i;
/* Stock-pitch promos (26 Oct 2026, owner: block them) — "Why Ameren (AEE) is a Top Dividend Stock for
   Your Portfolio", "This is Why Shinhan Financial (SHG) is a Great Dividend Stock", "Invesco (IVZ)
   Could Be a Great Choice". They get past the question rule because they start with "Why". */
export const RX_STOCK_PITCH = /\b(?:is|are|could be|might be|may be|makes?|looks? like|remains?)\s+(?:a|an)\s+(?:great|top|strong|solid|smart|good|compelling|excellent|winning|attractive|terrific|must-own|top-ranked)\s+(?:(?:dividend|value|growth|income|momentum|long-term|bargain)\s+)?(?:stock|pick|choice|buy|investment|bet|play|option)\b|\bfor your portfolio\b/i;
export const isQuestionFluff = (title: string): boolean => RX_QUESTION_FLUFF.test(title) && !RX_QUESTION_KEEP.test(title);
const RX_LAW_FIRM = /\b(?:rosen|pomerantz|glancy|kaskela|bronstein|schall|johnson\s*fistel|bragar|eagel|squire|gross\s*law|faruqi|portnoy|block\s*&?\s*leviton|hagens\s*berman|halper\s*sadeh|levi\s*&?\s*korsinsky|robbins\s*geller|kessler\s*topaz|monteverde|wolf\s*haldenstein|berger\s*montague|kahn\s*swick|kirby\s*mcinerney|labaton|bernstein\s*liebhard|howard\s*g\.?\s*smith|kuehn\s*law|grabar|rigrodsky|weiss\s*law|ademi|federman|claimsfiler|holzer)\b/i;

const RX_LEGAL_BOILERPLATE = /\b(?:class\s*action|securities\s*fraud|shareholder\s*(?:alert|rights|investigation|deadline)|investors?\s+(?:are\s+)?(?:urged|encouraged|reminded|alerted|notified|advised)|suffered\s+losses|lead\s+plaintiff|investor\s*alert|deadline\s+approach|law\s*(?:firm|offices)|is\s+investigating)\b/i;

/* ---- The causal test ----------------------------------------------------
   THE MOST IMPORTANT FUNCTION IN THIS FILE.

   A headline that restates the price move tells you nothing you did not
   already know from the CHG% column. "Shares Of X Jump 12%" is the scan's
   own finding, laundered through a news feed and returned as if it were
   evidence. Worse, it looks like a catalyst on the row, so it converts a
   technical mover into an apparently news-driven one.

   A headline is CAUSAL when it contains a because-clause: "on", "after",
   "as", "following", "amid" joining the move to an event. That is a shallow
   test and it is deliberately shallow — the alternative is entity
   extraction, and the failure mode of getting it slightly wrong is much
   worse than the failure mode of occasionally passing a weak headline.

   Headlines with NO move-language at all are treated as causal by default.
   "Acme Wins $400M Defense Contract" never mentions the stock price and is
   pure event reporting — the test only needs to fire on headlines that DO
   describe a move, to check whether they also explain it. */
const RX_MOVE_LANGUAGE = /\b(?:shares?|stock|sinks?|soars?|surges?|jumps?|plunges?|tumbles?|rallies|rally|climbs?|slides?|drops?|falls?|rises?|gains?|spikes?|craters?|pops?|slips?|is (?:up|down)|are (?:up|down)|trading (?:higher|lower)|moving)\b/i;

const RX_CAUSAL_JOIN = /\b(?:on|after|as|following|amid|because|due to|thanks to|over|behind|driven by|spurred by|sparked by|boosted by|hit by|weighed (?:down )?by)\b/i;

const isCausal = (title: string): boolean => {
  if (!RX_MOVE_LANGUAGE.test(title)) return true;   // pure event reporting
  if (RX_CAUSAL_JOIN.test(title)) return true;
  const m = title.match(RX_MOVE_LANGUAGE);
  if (m && m.index! > 20) {
    const before = title.slice(0, m.index!);
    if (/[,;]\s*$/.test(before) && !RX_MOVE_LANGUAGE.test(before)) return true;
  }
  return false;
};

/* ---- Classification -----------------------------------------------------
   Same category vocabulary the components already render, so the tag chips
   on every table keep working unchanged.

   ORDER MATTERS: an offering announced alongside earnings is an Offering,
   because dilution is what the stock will trade on. The dilutive and legal
   categories are tested first for that reason. */
export function classifyNews(title: string, description?: string | null): string {
  const s = `${title} ${description || ''}`.toLowerCase();

  if (/\b(?:offering|dilut|priced? (?:public|underwritten)|secondary offering|registered direct|at-the-market|atm program|capital raise|warrant (?:exercise|inducement)|shelf registration|reverse (?:stock )?split)\b/.test(s)) return 'Offering';
  if (/\b(?:lawsuit|sued|litigation|sec (?:probe|investigation|charges)|doj|subpoena|fraud|settle(?:s|d|ment)|recall|halt(?:ed)?|delist|going concern|bankrupt|chapter 11)\b/.test(s)) return 'Legal / Risk';
  if (/\b(?:earnings|eps|revenue|beats?|missed?|quarterly results|q[1-4] (?:results|report)|after (?:\w+ )?q[1-4]|top(?:s|ped) estimates|reports? (?:first|second|third|fourth) quarter)\b/.test(s)) return 'Earnings';
  if (/\b(?:fda|approval|approved|phase\s*[123]|clinical|trial results|topline|nda|bla|510\(k\)|breakthrough therapy|orphan drug|ind clearance)\b/.test(s)) return 'FDA / Data';
  if (/\b(?:merger|acquir|acquisition|buyout|takeover|to be acquired|definitive agreement|stake in|going private|tender offer|spin[- ]?off)\b/.test(s)) return 'M&A';
  if (/\b(?:upgrade[sd]?|downgrade[sd]?|price target|initiat(?:es|ed) coverage|reiterat|overweight|underweight|outperform|analyst)\b/.test(s)) return 'Analyst';
  if (/\b(?:guidance|raises? (?:its )?(?:outlook|forecast|guidance)|lowers? (?:its )?(?:outlook|forecast|guidance)|reaffirm|updates? outlook|preliminary results)\b/.test(s)) return 'Guidance';
  if (/\b(?:contract|awarded|partnership|collaborat|agreement|order(?:s|ed)? (?:worth|valued)|selected by|wins?|deal with|loi|letter of intent|purchase order)\b/.test(s)) return 'Contract';
  if (/\b(?:launch|unveil|introduc|debut|releases? (?:its )?new|announces? (?:the )?availability|now available|ships?)\b/.test(s)) return 'Product';
  if (/\b(?:ceo|cfo|resign|appoint|steps down|names? (?:new )?(?:chief|president)|board of directors|executive)\b/.test(s)) return 'Management';
  if (/\b(?:short (?:report|seller)|squeeze|halted for volatility)\b/.test(s)) return 'Volatility';

  return 'News';
}

/* Which categories justify a score bump, and which should cost the row.

   NEGATIVE IS NOT "BAD NEWS" — it is news that structurally works against a
   long. An offering dilutes; a going-concern warning or fraud probe changes
   what the equity is. A disappointing earnings print is not in here: that is
   already in the price the scan measured, and penalising it twice would
   double-count the same fact. */
const STRONG_TAGS = new Set(['Earnings', 'FDA / Data', 'M&A', 'Guidance', 'Contract', 'Product']);
const NEGATIVE_TAGS = new Set(['Offering', 'Legal / Risk']);

/* ---- Age ----------------------------------------------------------------
   A catalyst decays. Something from four hours ago is why the stock is
   moving now; something from four days ago is why it moved on Monday, and
   the scan is looking at Thursday.

   The window is generous (5 days) because a delayed reaction is a real
   pattern — a small cap can take days to work through a contract award. But
   age is scored steeply, so a fresh headline outranks an older one from a
   better publisher. */
const MAX_AGE_HOURS = 120;

const ageLabelOf = (h: number): string => {
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
};

/* ---- Breadth ------------------------------------------------------------
   An article tagged with twenty tickers is about a sector, an index, or a
   listicle that slipped the shape filter. It is not about this company.

   8 is looser than the WIIM filter's 12 because Polygon tags more
   aggressively — it will attach every ticker mentioned in passing, where
   Benzinga tagged the subjects. */
const MAX_TICKERS = 8;

/* ---- Quality score ------------------------------------------------------
   Ranks the surviving articles so the best one is chosen. Not exposed on the
   UI — its only job is picking a winner from a handful of candidates. */
function qualityOf(
  item: PolygonNewsRaw,
  tag: string,
  pubTier: PublisherTier,
  ageHours: number,
  causal: boolean,
  tickerCount: number
): number {
  let q = 50;

  /* An 8-K with no exhibit headline is titled with its item label ("CELESTICA 8-K: reports
     quarterly results") — it says what was filed, not why the stock moved. It keeps its row
     only until a real headline turns up: no publisher or causal bonus, so a same-day press
     headline or any causal one outranks it, and on a tie the filing (listed first) stays. */
  if (item.keywords?.includes(SEC_LABEL_ONLY)) {
    pubTier = 'unknown';
    causal = false;
    tag = 'Filing';   // the topic is inferred from the item code, not a headline: no topic bonus
  }

  if (pubTier === 'primary') q += 22;
  else if (pubTier === 'press') q += 14;
  else if (pubTier === 'aggregator') q -= 25;

  // Freshness dominates. A three-hour-old wire beats a two-day-old one from
  // the same source, because the scan is trying to explain today.
  if (ageHours < 6) q += 24;
  else if (ageHours < 24) q += 16;
  else if (ageHours < 48) q += 6;
  else if (ageHours < 72) q -= 4;
  else q -= 14;

  if (causal) q += 12;

  if (STRONG_TAGS.has(tag)) q += 10;
  else if (NEGATIVE_TAGS.has(tag)) q += 8;  // still highly relevant, just bearish
  else if (tag === 'News') q -= 8;          // classified into nothing specific

  // Focus: an article about this name alone beats one mentioning six.
  if (tickerCount <= 2) q += 8;
  else if (tickerCount <= 4) q += 2;
  else q -= 6;

  // A description means a real article rather than a headline stub.
  if (item.description && item.description.length > 80) q += 4;

  return q;
}

/* Polygon attaches per-ticker sentiment on some articles. Read only the
   entry for THIS symbol — an article covering a merger is positive for the
   target and often negative for the acquirer, and taking the first entry
   would report the wrong one. */
const sentimentFor = (item: PolygonNewsRaw, symbol: string): { s: NewsSentiment; why: string | null } => {
  const ins = Array.isArray(item.insights) ? item.insights : [];
  const mine = ins.find(i => (i?.ticker || '').toUpperCase() === symbol.toUpperCase());
  if (!mine || !mine.sentiment) return { s: null, why: null };
  const v = String(mine.sentiment).toLowerCase();
  if (v === 'positive' || v === 'negative' || v === 'neutral') {
    return { s: v, why: mine.sentiment_reasoning || null };
  }
  return { s: null, why: null };
};

const tierOf = (tag: string, causal: boolean, pubTier: PublisherTier): CatalystTier => {
  if (NEGATIVE_TAGS.has(tag)) return 'negative';
  if (STRONG_TAGS.has(tag) && causal) return 'strong';
  if (STRONG_TAGS.has(tag)) return 'neutral';
  if (pubTier === 'aggregator') return 'headline';
  return causal ? 'neutral' : 'headline';
};

/* ---- The entry point ----------------------------------------------------
   Pick the single best article for a symbol, or null.

   RETURNING NULL IS A GOOD OUTCOME and the module is built to reach it
   often. Most stocks on most days have no catalyst, and saying so is more
   useful than surfacing the least-bad Zacks headline. The row then reads
   "no news catalyst — technical setup only", which is true and actionable;
   a filler headline in the same slot is neither. */
export function pickBestNews(
  results: PolygonNewsRaw[] | null | undefined,
  symbol: string,
  /* The clock article age is measured against. Live callers leave it at
     Date.now(); the backtest passes the historical scan time so a headline is
     judged by how old it was THEN, not how old it is today. */
  now: number = Date.now()
): NewsItem | null {
  if (!Array.isArray(results) || results.length === 0) return null;

  const candidates: NewsItem[] = [];

  for (const item of results) {
    // Zero-width characters ("\u200b\u200bWhich AI bubble…") hide a title's first word from the filters.
    const title = (item?.title || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (!title) continue;

    // --- shape rejection ---
    if (RX_LAW_FIRM.test(title) || RX_LEGAL_BOILERPLATE.test(title)) continue;
    if (RX_LISTICLE.test(title)) continue;
    if (RX_ALGO_CONTENT.test(title)) continue;
    if (RX_OPINION.test(title)) continue;
    if (RX_FUND_LETTER.test(title)) continue;
    if (isQuestionFluff(title)) continue;
    if (RX_STOCK_PITCH.test(title)) continue;
    if (isNewsNoise(title, item.article_url)) continue;

    // --- breadth ---
    const tickers = Array.isArray(item.tickers) ? item.tickers : [];
    if (tickers.length > MAX_TICKERS) continue;

    // --- relevance: is this article actually ABOUT this symbol? ---
    // Polygon tags every ticker mentioned anywhere in the article body.
    // An article about Nxera Pharma that namedrops "Eli Lilly" gets tagged
    // LLY — but it's not about LLY and should not appear on that row.
    // If the article covers multiple tickers and this symbol isn't in the
    // title or the first-listed ticker, it's background noise.
    const symUpper = symbol.toUpperCase();
    const titleUpper = title.toUpperCase();
    const isFirstTicker = tickers.length > 0 && String(tickers[0]).toUpperCase().includes(symUpper);
    const inTitle = titleUpper.includes(symUpper);
    if (tickers.length > 1 && !inTitle && !isFirstTicker) continue;

    // --- age ---
    const pub = item.published_utc ? new Date(item.published_utc).getTime() : 0;
    if (!pub) continue;
    const ageHours = (now - pub) / 3_600_000;
    if (ageHours > MAX_AGE_HOURS || ageHours < -2) continue;

    const publisher = (item.publisher?.name || '').trim();
    const pubTier = publisherTier(publisher);

    if (pubTier === 'blocked') continue;

    const causal = isCausal(title);
    if (pubTier === 'aggregator' && !causal) continue;

    const tag = classifyNews(title, item.description);
    const { s: sentiment, why } = sentimentFor(item, symbol);

    candidates.push({
      title,
      url: item.article_url || null,
      publisher: publisher || 'Unknown',
      publishedUtc: item.published_utc || '',
      ageHours: Math.round(ageHours * 10) / 10,
      ageLabel: ageLabelOf(ageHours),
      tickerCount: tickers.length,
      tag,
      tier: tierOf(tag, causal, pubTier),
      sentiment,
      sentimentReason: why,
      quality: qualityOf(item, tag, pubTier, ageHours, causal, tickers.length),
      causal,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.quality - a.quality);
  return candidates[0];
}

/* Everything that survived, best first. For a future drill-down: the
   asterisk on a summary card points at "there is news", and opening the
   scanner row should be able to show more than one item. */
export function pickNewsList(
  results: PolygonNewsRaw[] | null | undefined,
  symbol: string,
  limit = 4
): NewsItem[] {
  if (!Array.isArray(results) || results.length === 0) return [];

  const seen = new Set<string>();
  const out: NewsItem[] = [];

  // Reuses the single-pick path per slice so the filters cannot diverge —
  // two copies of this logic would drift and the list would eventually
  // contain items the headline slot rejects.
  const all = results.slice();
  while (out.length < limit && all.length > 0) {
    const best = pickBestNews(all, symbol);
    if (!best) break;

    const key = best.url || best.title;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(best);
    }

    const idx = all.findIndex(r => (r.article_url || r.title) === key);
    if (idx === -1) break;
    all.splice(idx, 1);
  }

  return out;
}

/* Convenience for routes that need the old two-field shape: a tag for the
   chip and a headline for the sub-row. */
export const newsTagOf = (n: NewsItem | null): string | null => n?.tag ?? null;
export const newsTitleOf = (n: NewsItem | null): string | null => n?.title ?? null;
export const newsUrlOf = (n: NewsItem | null): string | null => n?.url ?? null;

/* Polygon news URL for one ticker. Routes that do not already fetch news
   (ep9m, vcp) need this; the scanner already has the call. */
export const polygonNewsPath = (symbol: string, limit = 20): string =>
  `/v2/reference/news?ticker=${encodeURIComponent(symbol)}&limit=${limit}&order=desc&sort=published_utc`;

/* The Massive/Benzinga per-ticker index (fetchBenzingaNewsIndex / enrichBenzingaIndex) was
   removed on 26 Oct 2026 when the add-on ended; the scans use lib/indicators/newsAlt
   fetchFreeNewsIndex (SEC 8-Ks + FMP stock news) instead. */
