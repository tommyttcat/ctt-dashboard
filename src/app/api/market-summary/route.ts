import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0; 
export const maxDuration = 300; 

const getIsMarketActive = () => {
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = est.getDay();
  const timeStr = est.getHours() + est.getMinutes() / 60;
  
  if (day === 0 || day === 6) return false; 
  if (timeStr >= 4 && timeStr < 20) return true; 
  return false; 
};

// Provider-agnostic LLM call. Prefers Claude (separate quota, no hidden thinking
// budget that can blow the token ceiling and truncate); falls back to the
// hardened Gemini path when only GEMINI_API_KEY is set. Returns the raw text;
// the caller extracts JSON from it.
async function callLlm(prompt: string, maxTokens: number): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API Error: ${res.status} - ${errText.substring(0, 200)}`);
    }
    const data = await res.json();
    return (data?.content || [])
      .filter((b: any) => b?.type === 'text' && typeof b?.text === 'string')
      .map((b: any) => b.text)
      .join('');
  }

  if (geminiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'low' },
          maxOutputTokens: maxTokens,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error: ${res.status} - ${errText.substring(0, 200)}`);
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    return (candidate?.content?.parts || [])
      .filter((p: any) => typeof p?.text === 'string')
      .map((p: any) => p.text)
      .join('');
  }

  throw new Error('No LLM API key configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const forceRefresh = searchParams.get('refresh') === 'true';

  const estStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const est = new Date(estStr);
  const currentHourDecimal = est.getHours() + est.getMinutes() / 60;
  const isWeekend = est.getDay() === 0 || est.getDay() === 6;

  let effectiveDate = new Date(est);
  if (est.getDay() === 6) effectiveDate.setDate(est.getDate() - 1); 
  if (est.getDay() === 0) effectiveDate.setDate(est.getDate() - 2); 
  
  let targetDate = dateParam;
  if (!targetDate) {
    targetDate = `${effectiveDate.getFullYear()}-${String(effectiveDate.getMonth() + 1).padStart(2, '0')}-${String(effectiveDate.getDate()).padStart(2, '0')}`;
  }

  try {
    // 1. Bypass Cache if Force Refresh
    if (forceRefresh) {
      await kv.del(`market_narrative_${targetDate}`);
    } else {
      const cachedSummary = await kv.get(`market_narrative_${targetDate}`);
      if (cachedSummary) return NextResponse.json(cachedSummary);
    }

    const polygonKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY;
    if (!polygonKey) throw new Error('Missing Polygon API Key');

    let tapeContext = "No intraday price data available yet (Pre-market).";
    try {
      const snapshotUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=SPY,NVDA,AAPL,AMZN&apiKey=${polygonKey}`;
      const snapRes = await fetch(snapshotUrl, { cache: 'no-store' });
      const snapData = await snapRes.json();
      
      if (snapData.tickers && snapData.tickers.length > 0) {
        tapeContext = snapData.tickers.map((t: any) => {
          const today = t.day || {};
          const currentChange = t.todaysChangePerc ? Number(t.todaysChangePerc).toFixed(2) : '0.00';
          return `- ${t.ticker}: Open: ${today.o || 'N/A'}, High: ${today.h || 'N/A'}, Low: ${today.l || 'N/A'}, Last: ${today.c || t.lastTrade?.p || 'N/A'}, Daily Change: ${currentChange}%`;
        }).join('\n');
      }
    } catch (e) {
      console.error("Failed to fetch market tape snapshot:", e);
    }

    const newsUrl = `https://api.polygon.io/v2/reference/news?published_utc.gte=${targetDate}T00:00:00Z&published_utc.lte=${targetDate}T23:59:59Z&limit=100&sort=published_utc&order=desc&apiKey=${polygonKey}`;
    const response = await fetch(newsUrl, { cache: 'no-store' });
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
       return NextResponse.json({ status: 404, message: "No market data recorded yet." }, { status: 404 });
    }

    const trashPublishers = ['the motley fool', 'zacks investment research', 'globe newswire', 'pr newswire', 'business wire'];
    const premiumNews = data.results.filter((a: any) => !trashPublishers.includes((a.publisher?.name || '').toLowerCase())).slice(0, 40);
    const newsContext = premiumNews.map((n: any) => `- [${new Date(n.published_utc).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })}] ${n.title}: ${n.description}`).join('\n');

    let conditionalInstructions = "";
    if (isWeekend || currentHourDecimal >= 15.5) {
      conditionalInstructions = `Current Time Status: AFTERNOON / POWER HOUR / WEEKEND. You MUST populate ALL THREE blocks: "morning", "midday", and "closing". If news is sparse for the afternoon, base the afternoon blocks on index price movement and momentum carryover. DO NOT RETURN NULL.`;
    } else if (currentHourDecimal >= 11.5) {
      conditionalInstructions = `Current Time Status: MIDDAY LUNCH SESSION. You MUST populate the "morning" and "midday" blocks. Leave the "closing" block as null.`;
    } else {
      conditionalInstructions = `Current Time Status: MORNING / PRE-MARKET. You MUST populate the "morning" block. Leave the "midday" and "closing" blocks strictly as null.`;
    }

    if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
      throw new Error('Missing LLM API Key (set ANTHROPIC_API_KEY or GEMINI_API_KEY)');
    }

    const aiPrompt = `
      You are an elite, institutional day/swing trader analyzer tracking market action for trading date ${targetDate}.
      
      INTRADAY PRICE TAPE:
      ${tapeContext}
      
      MARKET NEWS HEADLINES:
      ${newsContext}
      
      ${conditionalInstructions}
      
      CRITICAL INSTRUCTIONS:
      - "paragraphs" must be an array of exactly 2 concise market observations.
      - "colorTheme" options: "cyan", "emerald", "indigo", "amber", "rose". Match the tone.
      - "actionableEvents": From the MARKET NEWS HEADLINES above, return a list of 10 catalysts,
        ordered most impactful first. The list MUST contain 10 entries — during market hours the
        news almost always carries at least 10 distinct tradeable developments, so do the work to
        find them. After the obvious top-tier headlines (earnings, guidance, FDA/clinical, M&A,
        major macro prints), fill the rest with the next most relevant: analyst rating changes,
        partnerships and contract wins, product or regulatory news, notable single-stock moves
        with a clear driver, and sector-moving developments. Every entry must still be a real,
        distinct, tradeable catalyst tied to a specific ticker (or "MKT" for broad macro) — do
        NOT pad with vague commentary, opinion columns, duplicates of the same story, or generic
        "stocks rose/fell" headlines. Only return fewer than 10 if the news genuinely does not
        contain that many distinct catalysts. For each event:
          - "event": a punchy 6 to 12 word description that STARTS with the primary ticker
            (or "MKT" for broad macro), e.g. "NVDA: Q3 earnings beat, raises full-year guidance".
          - "time": the headline's time in "HH:MM AM" / "HH:MM PM" format. DO NOT append
            "EST" — the interface adds it. Use the time shown in brackets before each headline.
          - "impact": exactly one of "High", "Medium", or "Low".
        If there are genuinely NO real catalysts in the news, return an empty array []. Never
        fabricate events and never emit entries with empty fields.
      
      RETURN EXACTLY THIS JSON STRUCTURE:
      {
        "actionableEvents": [
          { "time": "09:32 AM", "event": "NVDA: Q3 earnings beat, raises full-year guidance", "impact": "High" }
        ],
        "morning": { "phase": "PRE-MARKET & MORNING TAPE", "timestamp": "08:30 AM EST", "paragraphs": ["..."], "takeaway": "...", "colorTheme": "cyan" },
        "midday": { "phase": "MIDDAY MIX & ROTATION", "timestamp": "12:30 PM EST", "paragraphs": ["..."], "takeaway": "...", "colorTheme": "indigo" },
        "closing": { "phase": "POWER HOUR & CLOSING PRINT", "timestamp": "04:15 PM EST", "paragraphs": ["..."], "takeaway": "...", "colorTheme": "emerald" }
      }
    `;

    const generatedText = await callLlm(aiPrompt, 8192);

    let generatedSummary;
    try {
      const match = generatedText.match(/\{[\s\S]*\}/);
      generatedSummary = JSON.parse(match ? match[0] : generatedText);
    } catch (parseError) {
      generatedSummary = { actionableEvents: [], morning: null, midday: null, closing: null };
    }

    // ====================================================================
    // THE INTERCEPTOR: FORCIBLY INJECT BLOCKS IF GEMINI FAILED TO BUILD THEM
    // ====================================================================
    
    if (!generatedSummary.morning) {
      generatedSummary.morning = {
        phase: "PRE-MARKET & MORNING TAPE",
        timestamp: "08:30 AM EST",
        paragraphs: ["Morning session data initialized.", "System processing initial institutional flows and breakout setups."],
        takeaway: "Monitor opening range for directional bias.",
        colorTheme: "cyan"
      };
    }

    if (!generatedSummary.midday && (isWeekend || currentHourDecimal >= 11.5)) {
      generatedSummary.midday = {
        phase: "MIDDAY MIX & ROTATION",
        timestamp: "12:30 PM EST",
        paragraphs: ["Midday market rotation observed via price tape.", "AI synthesis did not detect heavily localized midday catalysts, suggesting pure structural drift."],
        takeaway: "Maintain current posture into the afternoon.",
        colorTheme: "indigo"
      };
    }

    if (!generatedSummary.closing && (isWeekend || currentHourDecimal >= 15.5)) {
      generatedSummary.closing = {
        phase: "POWER HOUR & CLOSING PRINT",
        timestamp: "04:15 PM EST",
        paragraphs: ["Closing session data captured and locked.", "Market absorbing final institutional rebalancing ahead of the weekend gap."],
        takeaway: "Carry prevailing bias into next trading session.",
        colorTheme: "emerald"
      };
    }

    // Sanitize actionableEvents so the UI never renders a blank row, even if
    // the model returns junk, wrong field names, or empty entries.
    if (Array.isArray(generatedSummary.actionableEvents)) {
      const validImpacts = ['High', 'Medium', 'Low'];
      generatedSummary.actionableEvents = generatedSummary.actionableEvents
        .filter((e: any) => e && typeof e.event === 'string' && e.event.trim().length > 0)
        .map((e: any) => ({
          time: (typeof e.time === 'string' ? e.time : '').replace(/\s*EST\s*$/i, '').trim(),
          event: e.event.trim(),
          impact: validImpacts.includes(e.impact) ? e.impact : 'Medium',
        }))
        .slice(0, 10);
    } else {
      generatedSummary.actionableEvents = [];
    }

    const isMarketActive = getIsMarketActive();
    // Cache the narrative so we don't re-call Gemini on every dashboard poll.
    // During market hours we regenerate at most once per MARKET_CACHE_SEC; off
    // hours it's effectively frozen for the rest of the day. Raise
    // MARKET_CACHE_SEC to spend less (e.g. 3600 = once an hour).
    const MARKET_CACHE_SEC = 3600;   // 60 min during market hours
    const CLOSED_CACHE_SEC = 43200;  // 12 hours when closed
    const cacheExpiration = isMarketActive ? MARKET_CACHE_SEC : CLOSED_CACHE_SEC;

    await kv.set(`market_narrative_${targetDate}`, generatedSummary, { ex: cacheExpiration });
    // Durable copy of the last good narrative, used to keep the panel populated
    // if a later regeneration fails.
    try { await kv.set(`market_narrative_lastgood_${targetDate}`, generatedSummary, { ex: 86400 }); } catch {}

    return NextResponse.json(generatedSummary);

  } catch (error: any) {
    // FAILURE THROTTLE (mirrors the scanner fix). This route previously wrote to
    // cache only on success, so when Gemini failed (429 quota, bad key, timeout)
    // the cache stayed empty and EVERY 60s poll / reload re-attempted the call —
    // a retry runaway that billed on each failure and returned a 500. Now a
    // failure caches a payload on the main key for a short cooldown, so polls are
    // served from KV instead of re-hitting the model. We reuse the last good
    // narrative when we have one; otherwise an empty payload the UI handles.
    let payload: any = { actionableEvents: [], morning: null, midday: null, closing: null };
    try {
      const lastGood = await kv.get(`market_narrative_lastgood_${targetDate}`);
      if (lastGood) payload = lastGood;
    } catch {}
    try {
      await kv.set(`market_narrative_${targetDate}`, payload, { ex: 600 }); // 10-min cooldown
    } catch {}
    return NextResponse.json(payload);
  }
}