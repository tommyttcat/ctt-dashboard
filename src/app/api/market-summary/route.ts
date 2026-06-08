import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');

  // =======================================================================
  // 🚀 FUTURE BACKEND: Here is where you will query your database or LLM
  // Example: const payload = await db.collection('summaries').findOne({ date });
  // =======================================================================

  // For right now, return the mock payload to test the frontend pipeline
  const payload = {
    morning: {
      phase: 'PRE-MARKET & MORNING TAPE',
      timestamp: '08:45 AM EST',
      colorTheme: 'cyan',
      paragraphs: [
        `Gap down across the board following hotter-than-expected PPI data. Yields are spiking on the short end, putting immediate pressure on rate-sensitive sectors.`,
        `Semiconductors are showing relative strength in the pre-market, absorbing the macro shock better than software. Watch the QQQ 15-minute opening range to see if institutional dip buyers step in at the 20-day EMA.`
      ],
      takeawayLabel: 'Morning Gameplan',
      takeaway: `Do not chase the opening flush. Wait for the 10:00 AM EST macro reversal window to establish firm VWAP trends.`
    },
    midday: {
      phase: 'MID-DAY ROTATION',
      timestamp: '12:15 PM EST',
      colorTheme: 'emerald',
      paragraphs: [
        `The morning flush was completely bought. IWM is leading the charge as breadth expands significantly into small caps. Market internals are flashing a strong positive divergence.`,
        `Volume is drying up heading into the lunch hour, but key Mega Caps (AAPL, AMZN) are successfully holding above their intraday VWAP, pinning the index near highs.`
      ],
      takeawayLabel: 'Mid-Day Adjustment',
      takeaway: `Transition from defensive posturing to tactical long. Focus on VCP breakouts in the industrials and financials space.`
    },
    closing: {
      phase: 'CLOSING POSTURE',
      timestamp: '03:45 PM EST',
      colorTheme: 'indigo',
      paragraphs: [
        `Tech breadth carried the tape into the close as semiconductor capex-beneficiaries shifted into overdrive. SPX & NDX closing at fresh weekly highs, completely erasing the morning's macro-driven gap down.`,
        `VIX stubbornly hanging around 19 is the only red flag — it is not confirming the rip, indicating options markets are aggressively hedging for a binary event risk next week.`
      ],
      takeawayLabel: 'Overnight Posture',
      takeaway: `Hold core tactical longs in semis & AI-optics. Trim marginal exposure tomorrow morning ahead of heavy FOMC speaker flow.`
    }
  };

  return NextResponse.json(payload);
}