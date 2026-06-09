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
    // 1. Check Cache
    const cachedSummary = await kv.get(`market_narrative_${targetDate}`);
    if (cachedSummary) {
      return NextResponse.json(cachedSummary);
    }

    // 2. Fetch News
    const polygonKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY;
    if (!polygonKey) throw new Error('Missing Polygon API Key');

    const newsUrl = `https://api.polygon.io/v2/reference/news?published_utc.gte=${targetDate}T00:00:00Z&published_utc.lte=${targetDate}T23:59:59Z&limit=50&sort=published_utc&order=desc&apiKey=${polygonKey}`;
    const response = await fetch(newsUrl, { cache: 'no-store' });
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
       return NextResponse.json({ status: 404, message: "No market data recorded yet." }, { status: 404 });
    }

    // 3. Filter Trash
    const trashPublishers = ['the motley fool', 'zacks investment research', 'globe newswire', 'pr newswire', 'business wire'];
    const premiumNews = data.results.filter((a: any) => !trashPublishers.includes((a.publisher?.name || '').toLowerCase())).slice(0, 15);
    const newsContext = premiumNews.map((n: any) => `- ${n.title}: ${n.description}`).join('\n');

    // 4. Synthesize with Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('Missing Gemini API Key');

    const aiPrompt = `
      You are an elite, institutional swing trader. Review the following market news headlines from today:
      
      ${newsContext}
      
      Synthesize this into a highly actionable, institutional-grade market summary. 
      Filter out noise. Focus on breadth, key levels, mega-cap flow, and actionable setups. If there are no major binary events today (like FOMC or CPI), leave the actionableEvents array empty. Do not invent events.
      
      Return EXACTLY this JSON structure and nothing else. Do NOT include markdown formatting like \`\`\`json:
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

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        },
        // Force Gemini to ignore safety triggers so it doesn't block financial news
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
    
    // Safety check for empty or blocked responses
    if (!aiData.candidates || !aiData.candidates[0].content) {
      console.error("Gemini Response Failed:", JSON.stringify(aiData));
      throw new Error("Gemini returned an empty response. Check Vercel logs.");
    }

    let generatedText = aiData.candidates[0].content.parts[0].text;
    
    // STRIP THE MARKDOWN TRAP: Aggressively remove ```json and ``` before parsing
    generatedText = generatedText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const generatedSummary = JSON.parse(generatedText);

    // 5. Cache and Return
    await kv.set(`market_narrative_${targetDate}`, generatedSummary, { ex: 7200 });

    return NextResponse.json(generatedSummary);

  } catch (error: any) {
     console.error("Market Summary API Error:", error);
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}