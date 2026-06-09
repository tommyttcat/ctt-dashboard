import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  // CACHE BUSTER: Passing ?refresh=true will bypass KV and overwrite with live data
  const forceRefresh = searchParams.get('refresh') === 'true';

  let targetDate = dateParam;
  if (!targetDate) {
    const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    targetDate = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, '0')}-${String(est.getDate()).padStart(2, '0')}`;
  }

  try {
    // 1. Check Cache (Skip if forceRefresh is true)
    if (!forceRefresh) {
      const cachedSummary = await kv.get(`market_narrative_${targetDate}`);
      if (cachedSummary) {
        return NextResponse.json(cachedSummary);
      }
    }

    const polygonKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY;
    if (!polygonKey) throw new Error('Missing Polygon API Key');

    // 2. FETCH THE REAL INTRADAY TAPE (SPY & Mega-Caps)
    let tapeContext = "No intraday price data available.";
    try {
      const snapshotUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=SPY,NVDA,AAPL,AMZN&apiKey=${polygonKey}`;
      const snapRes = await fetch(snapshotUrl, { cache: 'no-store' });
      const snapData = await snapRes.json();
      
      if (snapData.tickers && snapData.tickers.length > 0) {
        tapeContext = snapData.tickers.map((t: any) => {
          const today = t.day || {};
          const currentChange = t.todaysChangePerc !== undefined ? t.todaysChangePerc.toFixed(2) : '0.00';
          return `- ${t.ticker}: Open: ${today.o}, High: ${today.h}, Low: ${today.l}, Current Close/Last: ${today.c}, Daily Change: ${currentChange}%`;
        }).join('\n');
      }
    } catch (e) {
      console.error("Failed to fetch market tape snapshot:", e);
    }

    // 3. Fetch News
    const newsUrl = `https://api.polygon.io/v2/reference/news?published_utc.gte=${targetDate}T00:00:00Z&published_utc.lte=${targetDate}T23:59:59Z&limit=50&sort=published_utc&order=desc&apiKey=${polygonKey}`;
    const response = await fetch(newsUrl, { cache: 'no-store' });
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
       return NextResponse.json({ status: 404, message: "No market data recorded yet." }, { status: 404 });
    }

    // 4. Filter Trash Publishers
    const trashPublishers = ['the motley fool', 'zacks investment research', 'globe newswire', 'pr newswire', 'business wire'];
    const premiumNews = data.results.filter((a: any) => !trashPublishers.includes((a.publisher?.name || '').toLowerCase())).slice(0, 15);
    const newsContext = premiumNews.map((n: any) => `- ${n.title}: ${n.description}`).join('\n');

    // 5. Synthesize with Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('Missing Gemini API Key');

    const aiPrompt = `
      You are an elite, institutional day/swing trader analyzer. 
      You have access to two datasets for today (${targetDate}):
      
      INTRADAY PRICE TAPE (Compare the Open vs Low vs High vs Current Close to track the exact trend trajectory):
      ${tapeContext}
      
      MARKET NEWS HEADLINES:
      ${newsContext}
      
      Synthesize this into a highly actionable, institutional-grade market summary. 
      CRITICAL PRICE REALITY CHECK: 
      Look closely at the INTRADAY PRICE TAPE. Compare the Open to the Low, and then look at the Current Close. If the Current Close is significantly higher than the Low, and near or above the Open, there was an explicit morning selloff followed by a structural recovery. You MUST explicitly break down this price action pattern (e.g., morning liquidation, liquidity sweeps, afternoon v-bottom) across the morning, midday, and closing paragraphs. Do not ignore the numbers.
      
      Filter out noise. Focus on breadth, structural levels, mega-cap flow, and actionable setups. If there are no major binary events today (like FOMC or CPI), leave the actionableEvents array empty. Do not invent events.
      
      Return EXACTLY this JSON structure and nothing else. Do NOT include markdown formatting like \`\`\`json:
      {
        "actionableEvents": [{"time": "e.g., 2:00 PM", "event": "FOMC", "impact": "High"}],
        "morning": {
          "phase": "PRE-MARKET & MORNING TAPE",
          "timestamp": "10:30 AM EST",
          "paragraphs": ["Analyze the structural opening matrix. Explicitly note if the hard tape numbers show an immediate opening selloff/flush that trapped early longs or swept liquidity down to the session Lows.", "Note specific individual alpha drivers from the news headlines."],
          "takeaway": "Actionable Morning Posture / Gameplan",
          "colorTheme": "cyan"
        },
        "midday": {
          "phase": "MID-DAY ROTATION",
          "timestamp": "01:00 PM EST",
          "paragraphs": ["Analyze how the volume and price trends shifted at midday. Highlight if the initial morning selloff began to find dynamic structural support near the session Lows, leading to a stabilization or early rotation back into mega-caps."],
          "takeaway": "Actionable Midday Adjustment",
          "colorTheme": "emerald"
        },
        "closing": {
          "phase": "CLOSING POSTURE",
          "timestamp": "04:00 PM EST",
          "paragraphs": ["Analyze the final cash print. Highlight the afternoon recovery if the current prices successfully clawed all the way back from the deep morning lows toward the session Highs. Identify who led the charge and what the overnight risk posture is based on this strength."],
          "takeaway": "Overnight hold posture and what to look for tomorrow.",
          "colorTheme": "indigo"
        }
      }
    `;

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!aiRes.ok) throw new Error(`Gemini API Error: ${aiRes.statusText}`);
    
    const aiData = await aiRes.json();
    
    if (!aiData.candidates || !aiData.candidates[0].content) {
      console.error("Gemini Response Failed:", JSON.stringify(aiData));
      throw new Error("Gemini returned an empty response.");
    }

    let generatedText = aiData.candidates[0].content.parts[0].text;
    generatedText = generatedText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const generatedSummary = JSON.parse(generatedText);

    // 6. Cache and Return
    await kv.set(`market_narrative_${targetDate}`, generatedSummary, { ex: 7200 });

    return NextResponse.json(generatedSummary);

  } catch (error: any) {
     console.error("Market Summary API Error:", error);
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}