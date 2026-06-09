import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');

  // 1. Establish Target Date
  let targetDate = dateParam;
  if (!targetDate) {
    const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    targetDate = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, '0')}-${String(est.getDate()).padStart(2, '0')}`;
  }

  // 2. Authenticate
  const polygonKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY;
  if (!polygonKey) {
    return NextResponse.json({ error: 'Missing Polygon Key' }, { status: 500 });
  }

  try {
    // 3. Fetch ACTUAL LIVE NEWS from Polygon for the target date
    const newsUrl = `https://api.polygon.io/v2/reference/news?published_utc.gte=${targetDate}T00:00:00Z&published_utc.lte=${targetDate}T23:59:59Z&limit=100&sort=published_utc&order=asc&apiKey=${polygonKey}`;
    
    const response = await fetch(newsUrl, { cache: 'no-store' });
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
       return NextResponse.json({ status: 404, message: "No market data recorded yet for this date." }, { status: 404 });
    }

    const articles = data.results;

    // Helper: Get EST Hour from UTC timestamp
    const getEstHour = (utcString: string) => {
      const d = new Date(utcString);
      return parseInt(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }));
    };

    // 4. Route live articles into Time Buckets
    // Pre-Market/Morning: Before 11:00 AM EST
    const morningArticles = articles.filter((a: any) => getEstHour(a.published_utc) < 11);
    
    // Midday Rotation: 11:00 AM to 3:00 PM EST
    const middayArticles = articles.filter((a: any) => {
       const h = getEstHour(a.published_utc);
       return h >= 11 && h < 15;
    });
    
    // Closing Posture: After 3:00 PM EST
    const closingArticles = articles.filter((a: any) => getEstHour(a.published_utc) >= 15);

    // 5. Engine to compile live articles into the UI Blocks
    const buildBlock = (phase: string, articleList: any[], defaultTheme: string) => {
      if (articleList.length === 0) return null;
      
      // Grab the two most relevant/latest articles from this time block to build the narrative
      const primary = articleList[articleList.length - 1];
      const secondary = articleList.length > 1 ? articleList[articleList.length - 2] : null;

      const d = new Date(primary.published_utc);
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' EST';

      const paragraphs = [primary.title];
      if (primary.description) paragraphs.push(primary.description);
      if (secondary) paragraphs.push(`Secondary Flow: ${secondary.title}`);

      return {
        phase: phase,
        timestamp: timeStr,
        paragraphs: paragraphs,
        takeaway: `Primary Source: ${primary.publisher?.name || 'Live Market Feed'}`,
        colorTheme: defaultTheme
      };
    };

    // 6. Construct Final Payload
    const summaryData = {
      // Intentionally left blank. Actionable events require an Economic Calendar API integration.
      // If we hardcode them, they will hallucinate. Keep empty to hide the red radar safely.
      actionableEvents: [], 
      morning: buildBlock('PRE-MARKET & MORNING TAPE', morningArticles, 'cyan'),
      midday: buildBlock('MID-DAY ROTATION', middayArticles, 'emerald'),
      closing: buildBlock('CLOSING POSTURE', closingArticles, 'indigo')
    };

    return NextResponse.json(summaryData);

  } catch (error: any) {
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}