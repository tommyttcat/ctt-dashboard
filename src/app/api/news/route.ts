import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; 

const JUNK_NEWS_KEYWORDS = [
  'lawsuit', 'class action', 'investigation', 'shareholder', 'investors alerted', 
  'pomerantz', 'rosen law', 'glancy', 'kaskela', 'bronstein', 'schall', 
  'johnson fistel', 'deadline', 'reminder', 'bragar', 'eagel', 'squire',
  'gross law', 'faruqi', 'portnoy', 'investors reminded', 'purchasers of',
  'securities litigation', 'equity alert'
];

const isSpamNews = (title: string) => {
  if (!title) return true;
  const lower = title.toLowerCase();
  return JUNK_NEWS_KEYWORDS.some(w => lower.includes(w));
};

export async function GET() {
  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';

  if (!polygonApiKey || !geminiKey) {
    return NextResponse.json({ error: 'Missing API Keys' }, { status: 500 });
  }

  try {
    const res = await fetch(`https://api.massive.com/v2/reference/news?limit=40&apiKey=${polygonApiKey}`);
    if (!res.ok) throw new Error('News API Failed');
    
    const data = await res.json();
    const results = data.results || [];

    const validNews = results
      .filter((item: any) => !isSpamNews(item.title) && item.tickers && item.tickers.length > 0)
      .slice(0, 15); 

    if (validNews.length === 0) return NextResponse.json({ results: [] });

    const newsMap = new Map();
    const payloadForAi = validNews.map((item: any) => {
        let ticker = item.tickers[0];
        if (typeof ticker === 'string' && ticker.includes(':')) ticker = ticker.split(':')[1].toUpperCase();
        else if (typeof ticker === 'string') ticker = ticker.toUpperCase();

        const safeId = item.id;
        newsMap.set(safeId, { ...item, parsedTicker: ticker });

        return { id: safeId, ticker: ticker, headline: item.title };
    });

    const aiPrompt = `
      You are a quantitative news desk editor. 
      Review this array of recent financial headlines. For EACH item, you must return:
      1. A strictly rewritten 'cleanHeadline' that removes fluff, marketing, and filler. Keep it under 12 words. Make it punchy and actionable.
      2. A 'tag' string selected ONLY from this list: [EARNINGS, M&A, FDA, UPGRADE, DOWNGRADE, INSIDER, GUIDANCE, OFFERING, MACRO, TECH MOMENTUM]. Choose the best fit.

      Payload: ${JSON.stringify(payloadForAi)}
    `;

    const responseSchema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          cleanHeadline: { type: "STRING" },
          tag: { type: "STRING" }
        },
        required: ["id", "cleanHeadline", "tag"]
      }
    };

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: { 
          responseMimeType: "application/json", 
          responseSchema: responseSchema,
          temperature: 0.1 
        }
      })
    });

    let aiEnrichedData: any[] = [];
    if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.candidates && aiData.candidates[0].content) {
            aiEnrichedData = JSON.parse(aiData.candidates[0].content.parts[0].text);
        }
    }

    const finalResults = validNews.map((item: any) => {
        const stored = newsMap.get(item.id);
        const aiMatch = aiEnrichedData.find(a => a.id === item.id);
        
        return {
            id: item.id,
            ticker: stored.parsedTicker,
            originalTitle: item.title,
            cleanHeadline: aiMatch?.cleanHeadline || item.title,
            aiTag: aiMatch?.tag || 'TECH MOMENTUM',
            url: item.article_url,
            publishedUtc: item.published_utc,
            publisher: item.publisher?.name || 'MASSIVE'
        };
    });

    return NextResponse.json({ results: finalResults });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}