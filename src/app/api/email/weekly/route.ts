import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function resolveOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== 'null') return u.origin;
  } catch {}
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const chgClr = (v: number) => v >= 0 ? '#34d399' : '#fb7185';
const fmtPrice = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2);

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function mondayOf(d: Date): Date {
  const clone = new Date(d);
  const day = clone.getDay();
  clone.setDate(clone.getDate() - (day === 0 ? 6 : day - 1));
  return clone;
}

function fridayOf(d: Date): Date {
  const mon = mondayOf(d);
  mon.setDate(mon.getDate() + 4);
  return mon;
}

async function fetchWeeklyChanges(
  tickers: string[], mondayStr: string, fridayStr: string, apiKey: string,
): Promise<Record<string, { open: number; close: number; pct: number; vol: number }>> {
  const results: Record<string, { open: number; close: number; pct: number; vol: number }> = {};
  if (!apiKey) return results;
  await Promise.all(tickers.map(async (ticker) => {
    try {
      const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/week/${mondayStr}/${fridayStr}?adjusted=true&sort=asc&apiKey=${apiKey}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const bars = data.results || [];
      if (bars.length > 0) {
        const bar = bars[bars.length - 1];
        results[ticker] = { open: bar.o, close: bar.c, pct: ((bar.c - bar.o) / bar.o) * 100, vol: bar.v || 0 };
      }
    } catch {}
  }));
  return results;
}

interface DailyBar { date: string; o: number; h: number; l: number; c: number; v: number; }

async function fetchDailyBars(
  ticker: string, fromStr: string, toStr: string, apiKey: string,
): Promise<DailyBar[]> {
  if (!apiKey) return [];
  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&apiKey=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((b: any) => ({
      date: new Date(b.t).toISOString().slice(0, 10),
      o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0,
    }));
  } catch { return []; }
}

function analyzePriceAction(bars: DailyBar[], ticker: string): string {
  if (bars.length < 2) return '';
  const lines: string[] = [];
  const weekOpen = bars[0].o;
  const weekClose = bars[bars.length - 1].c;
  const weekHigh = Math.max(...bars.map(b => b.h));
  const weekLow = Math.min(...bars.map(b => b.l));
  const weekPct = ((weekClose - weekOpen) / weekOpen * 100);

  lines.push(`${ticker} DAILY BARS (Mon-Fri):`);
  for (const b of bars) {
    const dayPct = ((b.c - b.o) / b.o * 100);
    lines.push(`  ${b.date}: O ${b.o.toFixed(2)} H ${b.h.toFixed(2)} L ${b.l.toFixed(2)} C ${b.c.toFixed(2)} Vol ${(b.v / 1e6).toFixed(1)}M (${fmtPct(dayPct)})`);
  }

  // Distribution days: down >0.2% on higher volume than prior day
  let distDays = 0;
  for (let i = 1; i < bars.length; i++) {
    const dayPct = ((bars[i].c - bars[i].o) / bars[i].o * 100);
    if (dayPct < -0.2 && bars[i].v > bars[i - 1].v) distDays++;
  }
  lines.push(`  Week range: ${weekLow.toFixed(2)} – ${weekHigh.toFixed(2)}, net ${fmtPct(weekPct)}`);
  if (distDays > 0) lines.push(`  Distribution days this week: ${distDays}`);

  // Key levels: Friday's close relative to round numbers
  const fridayBar = bars[bars.length - 1];
  const roundLevels = [50, 100, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800];
  const nearestBelow = roundLevels.filter(l => l < fridayBar.c).pop();
  const nearestAbove = roundLevels.find(l => l > fridayBar.c);
  if (nearestBelow) lines.push(`  Key support: ${nearestBelow}`);
  if (nearestAbove) lines.push(`  Key resistance: ${nearestAbove}`);

  // Gap detection
  for (let i = 1; i < bars.length; i++) {
    const gapPct = ((bars[i].o - bars[i - 1].c) / bars[i - 1].c * 100);
    if (Math.abs(gapPct) >= 0.3) {
      lines.push(`  Gap ${gapPct > 0 ? 'up' : 'down'} ${Math.abs(gapPct).toFixed(2)}% on ${bars[i].date}`);
    }
  }

  return lines.join('\n');
}

async function fetchWeeklyNews(apiKey: string, fromStr: string, toStr: string): Promise<string> {
  if (!apiKey) return '';
  try {
    const url = `https://api.polygon.io/v2/reference/news?published_utc.gte=${fromStr}T00:00:00Z&published_utc.lte=${toStr}T23:59:59Z&limit=50&sort=published_utc&order=desc&apiKey=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    const articles = (data.results || [])
      .filter((a: any) => {
        const t = (a.title || '').toLowerCase();
        return !(/lawsuit|class action|pomerantz|rosen law|glancy|shareholder alert|stocks to buy|motley fool|why you should/i.test(t));
      })
      .slice(0, 25);
    return articles.map((a: any) => {
      const tickers = (a.tickers || []).slice(0, 3).join(', ');
      const date = new Date(a.published_utc).toLocaleDateString('en-US', { weekday: 'short' });
      return `[${date}] ${tickers ? `(${tickers}) ` : ''}${a.title}`;
    }).join('\n');
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Badge helpers (inline, email-safe)
// ---------------------------------------------------------------------------

function tk(ticker: string): string {
  return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.05em;padding:2px 8px;border-radius:4px;border:1px solid #ffffff15;background:#1e293b;color:#e2e8f0;">${ticker}</span>`;
}

function cnf(score: number | null): string {
  if (score == null) return '';
  const clr = score >= 70 ? '#34d399' : score >= 50 ? '#fbbf24' : '#94a3b8';
  return `<span style="font-size:10px;font-weight:700;color:${clr};">CNF ${score}</span>`;
}

function rvol(v: number | null): string {
  if (v == null || v < 1) return '';
  const clr = v >= 2 ? '#fbbf24' : '#34d399';
  return `<span style="font-size:10px;font-weight:700;color:${clr};">RVOL ${v.toFixed(1)}</span>`;
}

function stage(s: string | null): string {
  if (!s) return '';
  const clean = s.replace(/Stage\s*/i, '');
  const n = parseInt(clean);
  const clr = n === 2 ? '#34d399' : n === 3 ? '#fbbf24' : n === 4 ? '#fb7185' : '#94a3b8';
  return `<span style="font-size:10px;font-weight:600;color:${clr};">Stg ${clean}</span>`;
}

function dot(kind: string | null): string {
  if (!kind) return '';
  if (kind.includes('blue')) return `<span style="color:#79c0ff;font-weight:700;">● Blue Dot</span>`;
  if (kind.includes('red')) return `<span style="color:#fb7185;font-weight:700;">● Red Dot</span>`;
  return '';
}

function setup(name: string | null): string {
  if (!name) return '';
  const map: Record<string, [string, string]> = {
    'Gap & Go': ['GNG', '#fbbf24'], 'Blue Dot Rev': ['BD REV', '#79c0ff'],
    '20 EMA PB': ['PB', '#a78bfa'], 'Episodic Pivot': ['EP', '#fb7185'],
    'BB SQZ': ['SQZ', '#f472b6'], 'Trend Hold': ['TH', '#22d3ee'], Reversal: ['REV', '#79c0ff'],
  };
  const [abbr, clr] = map[name] || [name, '#94a3b8'];
  return `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${clr}18;color:${clr};border:1px solid ${clr}35;">${abbr}</span>`;
}

// ---------------------------------------------------------------------------
// Deterministic narrative fallback (when Gemini is unavailable)
// ---------------------------------------------------------------------------

function buildFallbackNarrative(data: any): any {
  const spyPct = data.indices?.match(/SPY ([+-][\d.]+%)/)?.[1] || '+0%';
  const qqqPct = data.indices?.match(/QQQ ([+-][\d.]+%)/)?.[1] || '+0%';
  const iwmPct = data.indices?.match(/IWM ([+-][\d.]+%)/)?.[1] || '+0%';
  const diaPct = data.indices?.match(/DIA ([+-][\d.]+%)/)?.[1] || '+0%';
  const benchStr = data.qqqBenchmark || '';

  const spyNum = parseFloat(spyPct);
  const breadthNote = data.breadth || '';
  const topSIPs = data.topSIPs || [];
  const topThree = topSIPs.slice(0, 3);

  // Build price action from daily bar data
  let priceAction = '';
  const qqqRange = data.qqqRangeLast30Sessions || '';
  const distDays = data.qqqDistributionDaysLast25Sessions || 0;
  const dailyBars = data.qqqDailyBars || '';

  if (dailyBars) {
    // Extract key numbers from the bars analysis string
    const rangeMatch = qqqRange.match(/High ([\d.]+), Low ([\d.]+), Friday close ([\d.]+)/);
    const high30 = rangeMatch ? rangeMatch[1] : '';
    const low30 = rangeMatch ? rangeMatch[2] : '';
    const friClose = rangeMatch ? rangeMatch[3] : '';

    const tone = spyNum >= 2 ? 'a strong rally' : spyNum >= 0.5 ? 'a solid green week' : spyNum >= 0 ? 'a mixed-to-flat week' : spyNum >= -0.5 ? 'a choppy, indecisive week' : 'a tough week';

    priceAction = `Markets posted ${tone}. The S&P finished ${spyPct}, Nasdaq ${qqqPct}, Dow ${diaPct}, and Russell ${iwmPct}. ${friClose ? `QQQ closed at ${friClose}` : ''}, within a 30-session range of ${low30} to ${high30}.`;
    priceAction += `\n\n${distDays > 3 ? `Distribution pressure is elevated with ${distDays} distribution days over the last 25 sessions — a sign of institutional selling under the surface.` : distDays > 0 ? `There were ${distDays} distribution days over the last 25 sessions — within a normal range for a trending market.` : 'No distribution days over the last 25 sessions — clean institutional accumulation.'}`;
    priceAction += `\n\nBreadth ${breadthNote ? `confirmed the move — ${breadthNote}.` : 'data was unavailable.'} ${benchStr ? `${benchStr}, which keeps the trend intact on the daily.` : ''}`;
  } else {
    const nasdaqLed = parseFloat(qqqPct) > parseFloat(spyPct);
    priceAction = `Markets posted the S&P ${spyPct}, Nasdaq ${qqqPct}, Dow ${diaPct}, and Russell ${iwmPct}. ${nasdaqLed ? 'Growth and tech led.' : 'The move was broad-based.'}`;
    priceAction += `\n\nBreadth ${breadthNote ? `confirmed the move — ${breadthNote}.` : 'data was unavailable.'} ${benchStr ? `${benchStr}.` : ''}`;
  }

  // Build macro section from this week's econ results
  let macro = '';
  const econResults = data.thisWeekEconResults || '';
  if (econResults) {
    macro = `Key economic releases this week:\n\n${econResults.split('\n').map((line: string) => {
      const parts = line.split(' | ');
      return parts[0] + (parts.length > 1 ? ': ' + parts.slice(1).join(', ') : '');
    }).join('. ')}.`;
  } else {
    macro = 'No major economic releases this week.';
  }

  // Build real catalyst stories
  const catalysts: any[] = [];
  for (const sip of topThree.slice(0, 2)) {
    const rv = sip.rvol ? Number(sip.rvol).toFixed(1) : null;
    const catLabel = sip.catalyst || sip.setup || 'Momentum';
    let body = `${sip.name || sip.ticker} moved ${sip.chg}`;
    if (rv) body += ` on ${rv}x relative volume`;
    body += '.';
    if (sip.setup) body += ` The scanner classified this as a ${sip.setup} setup.`;
    if (sip.cnf) body += ` Confluence score at ${sip.cnf}.`;
    if (sip.extended) body += ' Now overextended — day-trade classification only.';
    else if (sip.stage) body += ` Currently in ${sip.stage}.`;
    catalysts.push({ title: `${sip.ticker} ${sip.chg} — ${catLabel}`, body });
  }

  // Build watch stocks with real analysis
  const featured = data.featured || {};
  const stockAnalysis: Record<string, { title: string; body: string }> = {
    SPCX: {
      title: 'Aerospace leader — watching for continuation',
      body: 'SpaceX has been the strongest name on the tape.',
    },
    RKLB: {
      title: 'Rocket Lab riding the space trade',
      body: 'Rocket Lab has been running with the broader aerospace/launch sector.',
    },
    ASTS: {
      title: 'Satellite-to-cell thesis remains live',
      body: 'AST SpaceMobile continues to build higher lows.',
    },
  };

  const watchStocks = ['SPCX', 'RKLB', 'ASTS'].map(t => {
    const fd = featured[t];
    const sip = topSIPs.find((s: any) => s.ticker === t);
    const base = stockAnalysis[t] || { title: 'Active', body: '' };
    const price = fd?.close ? `$${fmtPrice(fd.close)}` : '?';
    const pct = fd?.pct || sip?.chg || '?';

    let body = `Closed at ${price}, ${pct} on the week. `;
    if (sip) {
      body += `${sip.setup ? sip.setup + ' setup, ' : ''}${sip.stage || ''}. `;
      if (sip.extended) {
        body += `Currently overextended (${sip.distToEma21 ? sip.distToEma21 + '% above 21 EMA' : 'extended'}) — wait for a pullback to act on this.`;
      } else {
        body += `Watch for continuation above ${price} or a pullback to the 10/21 EMA zone for a swing entry.`;
      }
    } else {
      body += `${base.body} Watch for follow-through above ${price} or a pullback to recent consolidation for entry.`;
    }
    return { ticker: t, title: sip?.setup ? `${sip.setup} — ${sip.stage || 'Active'}` : base.title, body };
  });

  // Build avoid section
  const traps = data.traps || [];
  const avoidStocks = traps.slice(0, 3).map((t: any) => ({
    ticker: t.ticker,
    reason: t.reason || `${t.chg} in ${t.stage || 'a downtrend'}. Don't chase relief rallies in broken charts.`,
  }));

  // Build week ahead
  const events = data.nextWeekEvents || '';
  const eventList = events.split(',').slice(0, 4).map((e: string) => e.replace(/\([\d-]+\)/g, '').trim()).filter(Boolean);
  const bigEvent = eventList.find((e: string) => /CPI|FOMC|NFP|Payroll/i.test(e)) || eventList[0] || 'economic data';

  const weekAhead = `The big event next week is ${bigEvent}. ${eventList.length > 1 ? `Also on the calendar: ${eventList.slice(1, 3).join(', ')}.` : ''} Position sizing should reflect event risk — go lighter heading into the number, then press winners once the data clears.`
    + `\n\nIf breadth holds and QQQ stays above its daily EMAs, the current rally has room to extend. A hot inflation print or a breadth divergence (indices up, advancers shrinking) would be the first signal to tighten stops and reduce exposure.`;

  return { priceAction, macro, weekRecap: priceAction, catalysts, watchStocks, avoidStocks, weekAhead };
}

// ---------------------------------------------------------------------------
// Gemini narrative generation
// ---------------------------------------------------------------------------

async function generateNarrative(data: any, anthropicKey: string, debug = false): Promise<any> {
  if (!anthropicKey) {
    const msg = '[weekly] No ANTHROPIC_API_KEY, using fallback';
    console.log(msg);
    if (debug) return { _debug: msg };
    return buildFallbackNarrative(data);
  }

  const systemPrompt = `You are the analyst behind a weekly trading briefing email. You write like a smart, opinionated trader talking to other smart traders. Your tone is direct, specific, and analytical — never vague, never generic, never a disclaimer. You reference specific price levels, specific days, specific catalysts. You sound like a hedge fund morning note, not a blog post. Respond with ONLY a JSON object, no markdown fences, no other text.`;

  const userPrompt = `Here is this week's market data. Use ALL of it to write a detailed weekly briefing.

DATA:
${JSON.stringify(data)}

Write a JSON object with these fields:

1. "priceAction" — 3-5 paragraphs of DETAILED QQQ/SPY price action analysis. This is the centerpiece. Reference specific price levels from the daily bars, not just percentages. Note distribution days (down >0.2% on higher volume). Mention the total distribution day count over the last 25 sessions. Describe the intraweek pattern. Reference the 30-session range context. End with where QQQ closed relative to its EMAs and what that means. Tell the STORY of the week — write like: "Having chopped around between 700-745 for 24 sessions, on Friday, QQQ broke below 700."

2. "macro" — 2-4 paragraphs covering the most important macro/Fed/economic story. Analyze results vs expectations using thisWeekEconResults data. Name specific Fed officials if news mentions them. Reference actual numbers.

3. "catalysts" — array of 2-3 objects with "title" and "body" (2-4 sentences each). Stories/themes that moved money — earnings, sector rotations, news events. Use thisWeekEarningsResults data to highlight the most important earnings with actual numbers vs estimates.

4. "watchStocks" — array of objects for SPCX, RKLB, ASTS with "ticker", "title" (one-line thesis), "body" (2-4 sentences with specific prices and levels to watch). ALWAYS include these three tickers. Use their scanner data (EMA levels, stage, setup, confluence) to give specific entry/exit levels. For example: "SPCX closed at $133.11, above its 10 EMA at $119.18. Blue Dot Rev setup with CNF 83 in Stage 2A. A pullback to the $119-121 EMA zone is the swing entry; above $133.48 (Friday's high) it runs."

5. "avoidStocks" — array of 2-3 objects with "ticker" and "reason" (2-3 sentences, blunt and specific — reference the stage, the broken structure, why relief rallies are traps)

6. "weekAhead" — 2-3 paragraphs. Name the biggest event and why it matters. Reference specific QQQ levels from the EMA data as support/resistance. Include key earnings next week. End with a clear opinionated take.

RULES:
- Reference SPECIFIC price levels, dates, and numbers throughout
- NEVER use asterisks, markdown, or bullet points
- Conversational but authoritative tone
- 800-1500 words total
- Respond with ONLY the JSON object, no code fences, no other text`;

  try {
    console.log('[weekly] Calling Claude API...');
    const reqBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.7,
    });
    console.log('[weekly] Request body size:', reqBody.length, 'bytes');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: reqBody,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[weekly] Claude API error:', res.status, errBody);
      if (debug) return { _debug: `API error ${res.status}: ${errBody.slice(0, 500)}` };
      return buildFallbackNarrative(data);
    }
    const json = await res.json();
    const text = json?.content?.[0]?.text || '';
    console.log('[weekly] Claude response length:', text.length, 'chars, stop_reason:', json?.stop_reason);
    if (!text) {
      console.error('[weekly] Empty response from Claude');
      if (debug) return { _debug: 'Empty response', raw: JSON.stringify(json).slice(0, 500) };
      return buildFallbackNarrative(data);
    }
    // Strip code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[weekly] Could not extract JSON from Claude response, first 200 chars:', text.slice(0, 200));
      if (debug) return { _debug: 'No JSON match', first500: text.slice(0, 500) };
      return buildFallbackNarrative(data);
    }
    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[weekly] Claude narrative parsed successfully, keys:', Object.keys(parsed).join(','));
    if (debug) return { _debug: 'success', keys: Object.keys(parsed) };
    return parsed;
  } catch (err: any) {
    console.error('[weekly] Claude narrative generation failed:', err);
    if (debug) return { _debug: `Exception: ${err?.message || err}` };
    return buildFallbackNarrative(data);
  }
}

// ---------------------------------------------------------------------------
// Build the email
// ---------------------------------------------------------------------------

function buildEmail(
  narrative: any,
  weeklyChanges: Record<string, any>,
  watchTickers: Record<string, any>,
  scanner: any,
  econ: any,
  earnings: any,
  sectors: any,
  thisMonday: string,
  thisFriday: string,
  nextMonday: string,
  nextFriday: string,
  thisWeekEarningsData?: any[],
): string {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  const monLabel = new Date(thisMonday + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const friLabel = new Date(thisFriday + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Index row
  const indices = [
    { label: 'S&P', ticker: 'SPY' }, { label: 'NDX', ticker: 'QQQ' },
    { label: 'DOW', ticker: 'DIA' }, { label: 'RUT', ticker: 'IWM' },
  ];
  const indexCells = indices.map(ix => {
    const d = weeklyChanges[ix.ticker];
    const pct = d?.pct ?? 0;
    return `<td style="padding:10px 8px;text-align:center;width:25%;">
      <div style="font-size:10px;font-weight:600;letter-spacing:0.08em;color:#64748b;">${ix.label}</div>
      <div style="font-size:16px;font-weight:700;color:${chgClr(pct)};">${fmtPct(pct)}</div>
    </td>`;
  }).join('');

  // Breadth
  const breadth = scanner?.breadth;
  const bench = scanner?.benchmark;
  let benchNote = '';
  if (bench?.day) {
    const allAbove = bench.day.every((e: any) => e.above);
    const aboveCount = bench.day.filter((e: any) => e.above).length;
    benchNote = allAbove ? 'above all daily EMAs' : `above ${aboveCount}/${bench.day.length} EMAs`;
  }

  // Catalysts
  const catalysts = (narrative?.catalysts || []).slice(0, 3);
  const catalystHtml = catalysts.map((c: any) =>
    `<div style="margin-bottom:16px;">
      <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:4px;">${c.title}</div>
      <div style="font-size:13px;color:#94a3b8;line-height:1.65;">${c.body}</div>
    </div>`
  ).join('');

  // Watch stocks
  const sips = scanner?.stocksInPlay || [];
  const watchHtml = (narrative?.watchStocks || []).map((ws: any) => {
    const match = sips.find((s: any) => s.ticker === ws.ticker);
    const wd = watchTickers[ws.ticker];
    const pct = wd?.pct ?? match?.changePct ?? 0;
    const price = wd?.close ?? match?.price ?? 0;
    const badges = [
      cnf(match?.cnfScore), rvol(match?.rvol ? Number(match.rvol) : null),
      stage(match?.stage), dot(match?.dotKind), setup(match?.setupName),
    ].filter(Boolean).join(' &nbsp; ');

    return `<div style="border-left:3px solid #22d3ee;padding:12px 16px;margin-bottom:12px;background:#0f172a;border-radius:0 6px 6px 0;">
      <div style="margin-bottom:6px;">
        ${tk(ws.ticker)} <span style="font-size:13px;font-weight:700;color:#e2e8f0;margin-left:6px;">$${fmtPrice(price)}</span>
        <span style="font-size:13px;font-weight:700;color:${chgClr(pct)};margin-left:4px;">${fmtPct(pct)} this week</span>
      </div>
      <div style="font-size:13px;font-weight:600;color:#cbd5e1;margin-bottom:4px;">${ws.title}</div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.6;margin-bottom:6px;">${ws.body}</div>
      ${badges ? `<div style="margin-top:4px;">${badges}</div>` : ''}
    </div>`;
  }).join('');

  // Avoid stocks
  const avoidHtml = (narrative?.avoidStocks || []).map((a: any) =>
    `<div style="padding:8px 14px;margin-bottom:6px;border-left:3px solid #fb7185;background:#1a0a0a;border-radius:0 4px 4px 0;">
      ${tk(a.ticker)} <span style="font-size:12px;color:#94a3b8;margin-left:8px;">${a.reason}</span>
    </div>`
  ).join('');

  // Events — curated headline events only (no duplicates, no obscure variants)
  const HEADLINE_EVENTS = [
    'CPI (YoY)', 'Core CPI (MoM)', 'PPI (MoM)', 'Initial Jobless Claims',
    'Retail Sales (MoM)', 'Michigan Consumer Sentiment', 'GDP', 'FOMC',
    'Nonfarm Payrolls', 'Fed Funds Rate', 'Existing Home Sales',
    'Housing Starts', 'Building Permits', 'Empire State Manufacturing', 'Philadelphia Fed Manufacturing',
  ];
  const fmtNum = (v: any): string => {
    if (v == null) return '';
    const n = Number(v);
    if (isNaN(n)) return String(v);
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
    if (Number.isInteger(n) && abs >= 100) return n.toLocaleString();
    return typeof v === 'number' ? (abs < 10 ? v.toFixed(2) : v.toFixed(1)) : String(v);
  };
  let eventsHtml = '';
  if (Array.isArray(econ) && econ.length > 0) {
    const high = econ.filter((e: any) => {
      const name = e.event || '';
      return HEADLINE_EVENTS.some(h => name === h) || e.impact === 'High';
    });
    // Deduplicate by keeping the shortest event name per base key
    const seen = new Set<string>();
    const deduped = high.filter((e: any) => {
      const base = (e.event || '').replace(/\s*\(MoM\)|\s*\(YoY\)|\s*\(QoQ\)/g, '').replace(/\s*(ex Food & Energy|4-week average)/g, '').trim();
      const key = `${(e.date || '').split(' ')[0]}_${base}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const byDay: Record<string, any[]> = {};
    for (const ev of deduped) {
      const d = (ev.date || '').split(' ')[0];
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(ev);
    }
    eventsHtml = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, events]) => {
      const [y, m, dd] = day.split('-').map(Number);
      const label = new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const items = events.map((e: any) => {
        const est = e.estimate != null ? `est ${fmtNum(e.estimate)}` : '';
        const prev = e.previous != null ? `prev ${fmtNum(e.previous)}` : '';
        const detail = [est, prev].filter(Boolean).join(' vs ');
        return `<span style="color:#e2e8f0;font-weight:600;">${e.event}</span>${detail ? ` <span style="color:#64748b;font-size:11px;">(${detail})</span>` : ''}`;
      }).join(' · ');
      return `<div style="margin-bottom:6px;font-size:12px;color:#94a3b8;">
        <span style="font-weight:700;color:#fb7185;margin-right:6px;">${label}</span> ${items}
      </div>`;
    }).join('');
  }

  // Earnings — top names only
  let earningsListHtml = '';
  if (Array.isArray(earnings) && earnings.length > 0) {
    const byDay: Record<string, any[]> = {};
    for (const er of earnings.slice(0, 20)) {
      const d = (er.date || '').split(' ')[0];
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(er);
    }
    earningsListHtml = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, ers]) => {
      const [y, m, dd] = day.split('-').map(Number);
      const label = new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const tickers = ers.slice(0, 5).map((e: any) => tk(e.symbol || e.ticker || '?')).join(' ');
      return `<div style="margin-bottom:6px;font-size:12px;color:#94a3b8;">
        <span style="font-weight:700;color:#fbbf24;margin-right:6px;">${label}</span> ${tickers}
      </div>`;
    }).join('');
  }

  // Sector top/bottom
  let sectorHtml = '';
  if (sectors?.sectors?.length) {
    const sorted = [...sectors.sectors].sort((a: any, b: any) => (b.changesPercentage || 0) - (a.changesPercentage || 0));
    const top3 = sorted.slice(0, 3);
    const bot2 = sorted.slice(-2).reverse();
    const row = (s: any) => {
      const pct = s.changesPercentage || 0;
      return `<span style="color:${chgClr(pct)};font-weight:600;">${s.sector || s.name} ${fmtPct(pct)}</span>`;
    };
    sectorHtml = `<div style="font-size:12px;color:#94a3b8;line-height:2;">
      <span style="font-weight:700;color:#64748b;">Money in:</span> ${top3.map(row).join(' · ')}<br>
      <span style="font-weight:700;color:#64748b;">Money out:</span> ${bot2.map(row).join(' · ')}
    </div>`;
  }

  // Section divider
  const section = (title: string, color: string) =>
    `<div style="margin-top:28px;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #ffffff10;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${color};">${title}</span>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#05080f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#cbd5e1;">
  <div style="max-width:620px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="border-top:3px solid;border-image:linear-gradient(90deg,#06b6d4,#34d399,#818cf8) 1;padding-top:20px;margin-bottom:28px;">
      <table style="width:100%;"><tr>
        <td><img src="https://ctt-dashboard.vercel.app/logo.svg" alt="CTT" style="height:24px;" /></td>
        <td style="text-align:right;font-size:11px;color:#475569;">${now} ET</td>
      </tr></table>
      <h1 style="font-size:22px;font-weight:800;color:#f1f5f9;margin:12px 0 4px;">Weekly Briefing</h1>
      <div style="font-size:12px;color:#64748b;">${monLabel} – ${friLabel}</div>
    </div>

    <!-- Index strip -->
    <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;margin-bottom:6px;">
      <tr>${indexCells}</tr>
    </table>
    ${breadth ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px;">Breadth: ${breadth.advancers?.toLocaleString() || '—'} adv / ${breadth.decliners?.toLocaleString() || '—'} dec · ${benchNote ? `QQQ ${benchNote}` : ''}</div>` : ''}

    <!-- Price Action -->
    ${section('Price Action', '#22d3ee')}
    <div style="font-size:13px;color:#cbd5e1;line-height:1.7;">
      ${(narrative?.priceAction || narrative?.weekRecap || 'No narrative available.').split('\n').filter(Boolean).map((p: string) => `<p style="margin:0 0 12px;">${p}</p>`).join('')}
    </div>

    <!-- Macro / Fed -->
    ${narrative?.macro ? section('The Fed & Macro', '#a78bfa') : ''}
    ${narrative?.macro ? `<div style="font-size:13px;color:#cbd5e1;line-height:1.7;">
      ${narrative.macro.split('\n').filter(Boolean).map((p: string) => `<p style="margin:0 0 12px;">${p}</p>`).join('')}
    </div>` : ''}

    <!-- Catalysts -->
    ${catalysts.length ? section('Markets & Narratives', '#fbbf24') : ''}
    ${catalystHtml}

    <!-- This Week's Earnings -->
    ${(() => {
      const earningsArr = thisWeekEarningsData || [];
      const big = earningsArr.filter((e: any) => e.mktCap > 20e9 && e.epsActual != null)
        .sort((a: any, b: any) => (b.mktCap || 0) - (a.mktCap || 0)).slice(0, 8);
      if (!big.length) return '';
      const rows = big.map((e: any) => {
        const beat = e.epsActual > (e.epsEstimated || 0);
        const surprise = e.epsSurprisePct ? `${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%` : '';
        const beatClr = beat ? '#34d399' : '#fb7185';
        return `<tr style="border-bottom:1px solid #ffffff05;">
          <td style="padding:5px 8px;font-weight:700;color:#e2e8f0;font-size:12px;">${tk(e.symbol)}</td>
          <td style="padding:5px 8px;text-align:right;font-size:12px;font-weight:700;color:${beatClr};">${beat ? 'BEAT' : 'MISS'}</td>
          <td style="padding:5px 8px;text-align:right;font-size:11px;color:#cbd5e1;">$${e.epsActual} vs $${(e.epsEstimated || 0).toFixed(2)}</td>
          <td style="padding:5px 8px;text-align:right;font-size:11px;color:${beatClr};">${surprise}</td>
        </tr>`;
      }).join('');
      return `${section("This Week's Earnings", '#a78bfa')}
        <table style="border-collapse:collapse;width:100%;margin-bottom:12px;">
          <tr>
            <th style="padding:4px 8px;font-size:9px;color:#475569;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:left;border-bottom:1px solid #ffffff10;">TICKER</th>
            <th style="padding:4px 8px;font-size:9px;color:#475569;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:right;border-bottom:1px solid #ffffff10;">RESULT</th>
            <th style="padding:4px 8px;font-size:9px;color:#475569;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:right;border-bottom:1px solid #ffffff10;">EPS vs EST</th>
            <th style="padding:4px 8px;font-size:9px;color:#475569;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:right;border-bottom:1px solid #ffffff10;">SURPRISE</th>
          </tr>
          ${rows}
        </table>`;
    })()}

    <!-- Sectors -->
    ${sectorHtml ? section('Sector Flow', '#818cf8') : ''}
    ${sectorHtml}

    <!-- DIVIDER -->
    <div style="border-top:2px solid #ffffff08;margin:32px 0;"></div>
    <h2 style="font-size:18px;font-weight:800;color:#f1f5f9;margin:0 0 4px;">Coming Week</h2>
    <div style="font-size:12px;color:#64748b;margin-bottom:16px;">${new Date(nextMonday + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(nextFriday + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>

    <!-- Week Ahead narrative -->
    <div style="font-size:13px;color:#cbd5e1;line-height:1.7;margin-bottom:20px;">
      ${(narrative?.weekAhead || '').split('\n').filter(Boolean).map((p: string) => `<p style="margin:0 0 12px;">${p}</p>`).join('')}
    </div>

    <!-- Key Stocks -->
    ${watchHtml ? section('Key Stocks to Watch', '#22d3ee') : ''}
    ${watchHtml}

    <!-- Events -->
    ${eventsHtml ? section('Key Events', '#fb7185') : ''}
    ${eventsHtml}

    <!-- Earnings -->
    ${earningsListHtml ? section('Key Earnings', '#fbbf24') : ''}
    ${earningsListHtml}

    <!-- Avoid -->
    ${avoidHtml ? section('Stay Away', '#fb7185') : ''}
    ${avoidHtml}

    <!-- Footer -->
    <div style="border-top:1px solid #ffffff08;margin-top:32px;padding-top:16px;font-size:10px;color:#475569;text-align:center;">
      Confluence Trading Tools · Not investment advice · Scanner data via Polygon
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const url = new URL(req.url);
  const preview = url.searchParams.get('preview');
  const test = url.searchParams.get('test');
  const debug = url.searchParams.get('debug');

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && !preview && !test && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY || '';
  if (!resendKey && !preview) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  const polygonKey = (process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '').trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const origin = resolveOrigin(req);

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const thisMonday = mondayOf(nowET);
  const thisFriday = fridayOf(nowET);
  const nextMon = new Date(thisMonday); nextMon.setDate(nextMon.getDate() + 7);
  const nextFri = new Date(thisFriday); nextFri.setDate(nextFri.getDate() + 7);

  const [mStr, fStr, nmStr, nfStr] = [iso(thisMonday), iso(thisFriday), iso(nextMon), iso(nextFri)];

  // Fetch lookback bars starting 30 trading days before Monday for context
  const lookbackStart = new Date(thisMonday);
  lookbackStart.setDate(lookbackStart.getDate() - 45);
  const lbStr = iso(lookbackStart);

  // Primary data source: the Claude snapshot (same as daily briefing)
  const [
    snapshot,
    econNextWeek, econThisWeek,
    earningsNextWeek, earningsThisWeek,
    weeklyChanges, watchTickers,
    qqqDaily, spyDaily,
    weeklyNews,
  ] = await Promise.all([
    fetchJson(`${origin}/api/claude/snapshot/${Date.now()}`),
    fetchJson(`${origin}/api/econ?from=${nmStr}&to=${nfStr}`),
    fetchJson(`${origin}/api/econ?from=${mStr}&to=${fStr}`),
    fetchJson(`${origin}/api/earnings?from=${nmStr}&to=${nfStr}`),
    fetchJson(`${origin}/api/earnings?from=${mStr}&to=${fStr}`),
    fetchWeeklyChanges(['SPY', 'QQQ', 'DIA', 'IWM'], mStr, fStr, polygonKey),
    fetchWeeklyChanges(['RKLB', 'ASTS', 'SPCX'], mStr, fStr, polygonKey),
    fetchDailyBars('QQQ', lbStr, fStr, polygonKey),
    fetchDailyBars('SPY', lbStr, fStr, polygonKey),
    fetchWeeklyNews(polygonKey, mStr, fStr),
  ]);

  const econ = econNextWeek;
  const earnings = earningsNextWeek;

  // Extract from snapshot
  const snapData = snapshot?.data || {};
  const macro = snapData.macro || {};
  const marketSummary = snapData.marketSummary || {};
  const sectors = snapData.sectors || {};
  const scanner = snapData.stocksInPlay || {};
  const sips = scanner.sips || scanner.stocksInPlay || [];
  const movers = scanner.topMovers || {};
  const breadth = macro.breadth || marketSummary.breadth;
  const benchmark = scanner.benchmark;
  const closingBlock = marketSummary.closing;

  // Deep price action analysis from daily bars
  const qqqThisWeek = qqqDaily.filter((b: DailyBar) => b.date >= mStr && b.date <= fStr);
  const spyThisWeek = spyDaily.filter((b: DailyBar) => b.date >= mStr && b.date <= fStr);
  const qqqPriceAction = analyzePriceAction(qqqThisWeek, 'QQQ');
  const spyPriceAction = analyzePriceAction(spyThisWeek, 'SPY');

  // Distribution day count over last 25 sessions
  const last25 = qqqDaily.slice(-25);
  let distDayCount = 0;
  for (let i = 1; i < last25.length; i++) {
    const dayPct = ((last25[i].c - last25[i].o) / last25[i].o * 100);
    if (dayPct < -0.2 && last25[i].v > last25[i - 1].v) distDayCount++;
  }

  // QQQ range over last 30 bars
  const last30 = qqqDaily.slice(-30);
  const rangeHigh = last30.length ? Math.max(...last30.map((b: DailyBar) => b.h)) : 0;
  const rangeLow = last30.length ? Math.min(...last30.map((b: DailyBar) => b.l)) : 0;
  const fridayClose = qqqThisWeek.length ? qqqThisWeek[qqqThisWeek.length - 1].c : 0;

  // This week's econ results
  const thisWeekEconSummary = Array.isArray(econThisWeek)
    ? econThisWeek.filter((e: any) => e.impact === 'High' || e.actual != null)
      .slice(0, 8).map((e: any) => {
        const parts = [e.event];
        if (e.actual != null) parts.push(`actual: ${e.actual}`);
        if (e.estimate != null) parts.push(`est: ${e.estimate}`);
        if (e.previous != null) parts.push(`prev: ${e.previous}`);
        return parts.join(' | ');
      }).join('\n')
    : '';

  // This week's major earnings results (sorted by market cap, top names only)
  const earningsEvents = Array.isArray(earningsThisWeek)
    ? earningsThisWeek
    : (earningsThisWeek as any)?.events || [];
  const thisWeekEarnings = earningsEvents
    .filter((e: any) => e.mktCap > 10e9 && e.epsActual != null)
    .sort((a: any, b: any) => (b.mktCap || 0) - (a.mktCap || 0))
    .slice(0, 15)
    .map((e: any) => {
      const beat = e.epsActual > (e.epsEstimated || 0);
      const surprise = e.epsSurprisePct ? `${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%` : '';
      const rev = e.revenueEstimated ? `Rev est $${(e.revenueEstimated / 1e9).toFixed(2)}B` : '';
      return `${e.symbol}: EPS $${e.epsActual} vs $${(e.epsEstimated || 0).toFixed(2)} est (${beat ? 'BEAT' : 'MISS'} ${surprise}) | ${rev} | MCap $${(e.mktCap / 1e9).toFixed(0)}B`;
    }).join('\n');

  // Build the data payload for Claude analysis
  const analysisData = {
    week: `${mStr} to ${fStr}`,
    indices: Object.entries(weeklyChanges).map(([t, d]) => `${t} ${fmtPct(d.pct)} (close $${fmtPrice(d.close)})`).join(', '),
    breadth: breadth ? `${breadth.advancers} adv / ${breadth.decliners} dec, ${breadth.up4} up 4%+, A/D ${breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : '—'}` : null,
    qqqBenchmark: benchmark ? `QQQ $${fmtPrice(benchmark.price)} — ${benchmark.day ? (benchmark.day.every((e: any) => e.above) ? 'above all daily EMAs (10/21/30/50)' : `above ${benchmark.day.filter((e: any) => e.above).length}/${benchmark.day.length} EMAs: ${benchmark.day.map((e: any) => `${e.label} EMA ${e.value.toFixed(2)} ${e.above ? '✓' : '✗'}`).join(', ')}`) : ''}` : null,
    closingNarrative: closingBlock?.paragraphs?.join(' ') || null,
    qqqDailyBars: qqqPriceAction,
    spyDailyBars: spyPriceAction,
    qqqDistributionDaysLast25Sessions: distDayCount,
    qqqRangeLast30Sessions: `High ${rangeHigh.toFixed(2)}, Low ${rangeLow.toFixed(2)}, Friday close ${fridayClose.toFixed(2)}`,
    thisWeekEconResults: thisWeekEconSummary || null,
    thisWeekEarningsResults: thisWeekEarnings || null,
    weeklyNewsHeadlines: weeklyNews ? weeklyNews.split('\n').slice(0, 15).join('\n') : null,
    topSIPs: sips.slice(0, 8).map((s: any) => ({
      ticker: s.ticker, name: s.name, chg: fmtPct(s.changePct || 0),
      cnf: s.cnfScore, rvol: s.rvol, stage: s.stage, setup: s.setupName,
      dot: s.dotKind, catalyst: s.catalyst, thesis: s.thesis, tradeType: s.tradeType,
      extended: s.extended, distToEma21: s.distToEma21,
    })),
    featured: {
      SPCX: watchTickers['SPCX'] ? { close: watchTickers['SPCX'].close, pct: fmtPct(watchTickers['SPCX'].pct) } : null,
      RKLB: watchTickers['RKLB'] ? { close: watchTickers['RKLB'].close, pct: fmtPct(watchTickers['RKLB'].pct) } : null,
      ASTS: watchTickers['ASTS'] ? { close: watchTickers['ASTS'].close, pct: fmtPct(watchTickers['ASTS'].pct) } : null,
    },
    featuredScannerData: ['SPCX', 'RKLB', 'ASTS'].map(t => {
      const s = sips.find((x: any) => x.ticker === t);
      return s ? { ticker: t, price: s.price, ema10: s.ema10, ema21: s.ema21, stage: s.stage, setup: s.setupName, cnf: s.cnfScore, extended: s.extended, distToEma21: s.distToEma21 } : { ticker: t };
    }),
    topGainers: (movers.Gainers || movers.gainers || []).slice(0, 5).map((s: any) => `${s.ticker} ${fmtPct(s.changePct)}`).join(', '),
    topLosers: (movers.Losers || movers.losers || []).slice(0, 5).map((s: any) => `${s.ticker} ${fmtPct(s.changePct)}`).join(', '),
    sectors: sectors?.sectors?.slice(0, 8).map((s: any) => `${s.sector || s.name} ${fmtPct(s.changesPercentage || 0)}`).join(', ') || null,
    traps: (sips.filter((s: any) => s.stage && /4/.test(s.stage)).slice(0, 5) || []).map((s: any) => ({ ticker: s.ticker, chg: fmtPct(s.changePct || 0), stage: s.stage })),
    nextWeekEvents: Array.isArray(econ) ? econ.filter((e: any) => e.impact !== 'Low').slice(0, 10).map((e: any) => `${e.event} (${(e.date || '').split(' ')[0]})`).join(', ') : null,
    nextWeekEarnings: Array.isArray(earnings) ? earnings.slice(0, 10).map((e: any) => `${e.symbol || e.ticker} (${(e.date || '').split(' ')[0]})`).join(', ') : null,
    t2108: snapData.t2108 ? `${snapData.t2108.value?.toFixed(1)}% (${snapData.t2108.zone})` : null,
  };

  if (debug === '1') {
    const debugResult = await generateNarrative(analysisData, anthropicKey, true);
    return NextResponse.json({
      hasAnthropicKey: !!anthropicKey,
      keyPrefix: anthropicKey ? anthropicKey.slice(0, 8) + '...' : 'none',
      snapshotLoaded: !!snapshot,
      dataPayloadSize: JSON.stringify(analysisData).length,
      narrativeResult: debugResult,
    });
  }

  const narrative = await generateNarrative(analysisData, anthropicKey);

  // Build a scanner-compatible object for buildEmail
  const scannerForEmail = {
    stocksInPlay: sips,
    breadth,
    benchmark,
    topMovers: movers,
  };

  const html = buildEmail(
    narrative, weeklyChanges, watchTickers, scannerForEmail,
    econ, earnings, sectors, mStr, fStr, nmStr, nfStr,
    earningsEvents,
  );

  if (preview === '1') {
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  const recipientEmail = process.env.BRIEFING_EMAIL || process.env.Email || 'thomasbeach@gmail.com';
  const resend = new Resend(resendKey);

  try {
    const { data, error } = await resend.emails.send({
      from: 'CTT Briefing <onboarding@resend.dev>',
      to: recipientEmail,
      subject: `CTT Weekly — ${new Date(mStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${new Date(fStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      html,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, emailId: data?.id, to: recipientEmail });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Send failed' }, { status: 500 });
  }
}
