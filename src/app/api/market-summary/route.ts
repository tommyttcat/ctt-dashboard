import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');

  let targetDate = dateParam;
  if (!targetDate) {
    const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    targetDate = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, '0')}-${String(est.getDate()).padStart(2, '0')}`;
  }

  try {
    // 1. Check if we already have an AI-generated narrative for today in the database
    const cachedSummary = await kv.get(`market_narrative_${targetDate}`);
    if (cachedSummary) {
      return NextResponse.json(cachedSummary);
    }

    // 2. Fetch raw news from Polygon to feed the AI
    const polygonKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY;
    if (!polygonKey) return NextResponse.json({ error: 'Missing Polygon Key' }, { status: 500 });

    const newsUrl = `https://api.polygon.io/v2/reference/news?published_utc.gte=${targetDate}T00:00:00Z&published_utc.lte=${targetDate}T23:59:59Z&limit=50&sort=published_utc&order=desc&apiKey=${polygonKey}`;
    const response = await fetch(newsUrl, { cache: 'no-store' });
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
       return NextResponse.json({ status: 404, message: "No market data recorded yet." }, { status: 404 });
    }

    // 3. STRICT FILTER: Strip out clickbait and automated PR wire trash
    const trashPublishers = ['the motley fool', 'zacks investment research', 'globe newswire', 'pr newswire', 'business wire'];
    const premiumNews = data.results.filter((a: any) => !trashPublishers.includes((a.publisher?.name || '').toLowerCase())).slice(0, 15);

    const newsContext = premiumNews.map((n: any) => `- ${n.title}: ${n.description}`).join('\n');

    // 4. Synthesize with Google Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiKey) {
      return NextResponse.json({
        morning: { phase: "SYSTEM ALERT", timestamp: "00:00 AM EST", paragraphs: ["GEMINI_API_KEY is missing from Vercel Environment Variables."], takeaway: "Add your Gemini API key to generate daily actionable market synthesis.", colorTheme: "rose" },
        midday: null, closing: null, actionableEvents: []
      });
    }

    const aiPrompt = `
      You are an elite, institutional swing trader. Review the following market news headlines from today:
      
      ${newsContext}
      
      Synthesize this into a highly actionable, institutional-grade market summary. 
      Filter out noise. Focus on breadth, key levels, mega-cap flow, and actionable setups. If there are no major binary events today (like FOMC or CPI), leave the actionableEvents array empty. Do not invent events.
      
      Return EXACTLY this JSON structure and nothing else:
      {
        "actionableEvents": [{"time": "e.g., 2:00 PM", "event": "FOMC", "impact": "High"}],
        "morning": {
          "phase": "PRE-MARKET & MORNING TAPE",
          "timestamp": "10:30 AM EST",
          "paragraphs": ["Institutional analysis of the morning action.", "Breadth and sector rotation notes."],
          "takeaway": "Actionable Morning Posture / Gameplan",
          "colorTheme": "cyan"
        },
        "midday": {
          "phase": "MID-DAY ROTATION",
          "timestamp": "01:00 PM EST",
          "paragraphs": ["Midday volume and trend analysis."],
          "takeaway": "Actionable Midday Adjustment",
          "colorTheme": "emerald"
        },
        "closing": {
          "phase": "CLOSING POSTURE",
          "timestamp": "04:00 PM EST",
          "paragraphs": ["Closing print analysis and sector leadership."],
          "takeaway": "Overnight hold posture and what to look for tomorrow.",
          "colorTheme": "indigo"
        }
      }
    `;

    // Direct REST call to Gemini 1.5 Flash
    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      })
    });

    if (!aiRes.ok) {
        throw new Error(`Gemini API Error: ${aiRes.statusText}`);
    }

    const aiData = await aiRes.json();
    const generatedText = aiData.candidates[0].content.parts[0].text;
    const generatedSummary = JSON.parse(generatedText);

    // 5. Save to Vercel KV
    // Expire the cache every 2 hours (7200 seconds) so the narrative naturally updates as the trading day evolves
    await kv.set(`market_narrative_${targetDate}`, generatedSummary, { ex: 7200 });

    return NextResponse.json(generatedSummary);

  } catch (error: any) {
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}