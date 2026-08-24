import { ImageResponse } from 'next/og';
import {
  marketTone, toneCellTone,
  t2108ZoneLabel, t2108CellTone,
  advPct, advCellTone,
  highsPct, highsCellTone,
  marketMonitorOf, mmTodayTone, mmCellTone, mmRatioLabel,
  mkmCellTone, vixPctTone, breadthSignalTone,
} from '@/lib/indicators/marketScorecard';
import {
  chopComposite, rawChopOf, chopZoneLabel, chopCellTone, bandsFor,
} from '@/lib/indicators/chopMarket';

export const runtime = 'edge';

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

const bg = '#0f172a';
const green = '#34d399';
const red = '#fb7185';
const muted = '#64748b';
const subtle = '#94a3b8';
const card = '#1e293b';
const border = '#334155';
const light = '#cbd5e1';
const white = '#f1f5f9';

const base = {
  display: 'flex' as const,
  flexDirection: 'column' as const,
  width: '100%',
  height: '100%',
  backgroundColor: bg,
  color: '#e2e8f0',
  fontFamily: 'sans-serif',
  padding: '28px 32px',
};

function renderScorecard(indices: { ticker: string; chg: number }[], dateStr: string) {
  return (
    <div style={base}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: white }}>CTT Market Brief</div>
          <div style={{ fontSize: 13, color: muted, marginTop: 2 }}>{dateStr}</div>
        </div>
        <div style={{ display: 'flex' }}>
          {indices.map(idx => (
            <div key={idx.ticker} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: 20 }}>
              <div style={{ fontSize: 12, color: muted, fontWeight: 600 }}>{idx.ticker}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: idx.chg >= 0 ? green : red }}>{fmtPct(idx.chg)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderTrades(trades: any[]) {
  return (
    <div style={base}>
      <div style={{ fontSize: 11, fontWeight: 700, color: muted, marginBottom: 10 }}>VCP TRADE IDEAS</div>
      {trades.map((s: any, i: number) => (
        <div key={s.ticker || i} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '7px 0',
          borderBottom: `1px solid ${card}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              fontSize: 14,
              fontWeight: 700,
              color: i < 2 ? green : subtle,
              marginRight: 10,
            }}>{s.ticker}</div>
            <div style={{ fontSize: 11, color: subtle }}>
              {[s.stage ? `Stage ${s.stage}` : '', s.setup || ''].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: muted, marginRight: 14 }}>
              {s.trigger != null ? `${s.trigger} → ${s.target ?? ''}` : ''}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: (s.changePct ?? 0) >= 0 ? green : red }}>
              {fmtPct(s.changePct ?? 0)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderAvoids(avoids: any[]) {
  return (
    <div style={base}>
      <div style={{ fontSize: 11, fontWeight: 700, color: muted, marginBottom: 10 }}>STAY AWAY</div>
      {avoids.map((s: any) => (
        <div key={s.ticker} style={{
          display: 'flex',
          alignItems: 'center',
          padding: '7px 0',
          borderBottom: `1px solid ${card}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: red, marginRight: 10 }}>{s.ticker}</div>
          <div style={{ fontSize: 12, color: muted }}>
            {[fmtPct(s.changePct ?? 0), s.stage ? `Stage ${s.stage}` : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- Scorecard strip (matches email briefing) ---- */

interface StripCell { label: string; value: string; sub: string; color: string }

const cellTextHex: Record<string, string> = {
  green: '#4ade80', red: '#ff7a93', amber: '#fcd34d', slate: '#e2e8f0',
};

const cellBorderHex: Record<string, string> = {
  green: '#22664d', red: '#662a3a', amber: '#664d1a', slate: '#2a3a50',
};

const cellBgHex: Record<string, string> = {
  green: '#0f1f1a', red: '#1f1520', amber: '#1f1a0f', slate: '#151c28',
};

function renderScorecardStrip(cells: StripCell[]) {
  const pad = 20;
  const gapSize = 8;
  const totalW = 1200;
  const usable = totalW - pad * 2 - gapSize * (cells.length - 1);
  const cellW = Math.floor(usable / cells.length);
  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100%',
      backgroundColor: '#0a1120',
      padding: pad,
      fontFamily: 'sans-serif',
      color: '#e2e8f0',
    }}>
      {cells.map((c, i) => {
        const bg = cellBgHex[c.color] || cellBgHex.slate;
        const bdr = cellBorderHex[c.color] || cellBorderHex.slate;
        return (
          <div key={c.label} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: cellW,
            backgroundColor: bg,
            borderRadius: 10,
            borderTop: `2px solid ${bdr}`,
            borderLeft: `2px solid ${bdr}`,
            borderRight: `2px solid ${bdr}`,
            borderBottom: `2px solid ${bdr}`,
            padding: '14px 6px',
            marginLeft: i > 0 ? gapSize : 0,
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5 }}>{c.label}</div>
            <div style={{
              fontSize: 28,
              fontWeight: 700,
              color: cellTextHex[c.color] || cellTextHex.slate,
              marginTop: 3,
            }}>{c.value}</div>
            {c.sub ? (
              <div style={{ fontSize: 15, color: '#94a3b8', marginTop: 2 }}>{c.sub}</div>
            ) : (
              <div style={{ fontSize: 15, color: 'transparent', marginTop: 2 }}>.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderSectors(sectors: { sector: string; etf: string; changesPercentage: number }[]) {
  const max = Math.max(...sectors.map(s => Math.abs(s.changesPercentage)), 1);
  return (
    <div style={base}>
      <div style={{ fontSize: 11, fontWeight: 700, color: muted, marginBottom: 10 }}>SECTORS</div>
      {sectors.map(s => {
        const pct = s.changesPercentage;
        const barW = Math.round((Math.abs(pct) / max) * 200);
        return (
          <div key={s.etf} style={{
            display: 'flex',
            alignItems: 'center',
            padding: '5px 0',
          }}>
            <div style={{ fontSize: 11, color: subtle, width: 100 }}>{s.sector}</div>
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 8 }}>
              <div style={{
                width: barW,
                height: 10,
                backgroundColor: pct >= 0 ? green : red,
                borderRadius: 3,
              }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: pct >= 0 ? green : red, marginLeft: 10 }}>
              {fmtPct(pct)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderRegime(regime: string) {
  return (
    <div style={base}>
      <div style={{
        display: 'flex',
        backgroundColor: card,
        borderRadius: 8,
        border: `1px solid ${border}`,
        padding: '14px 18px',
      }}>
        <div style={{ fontSize: 13, color: light }}>{regime}</div>
      </div>
    </div>
  );
}

const COVER_PHASE_LABELS: Record<string, string> = {
  pre: 'Pre-Market',
  morning: 'Morning',
  midday: 'Midday',
  closing: 'Closing',
};

function renderCover(phaseLabel: string) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      backgroundColor: '#0a1120',
      fontFamily: 'sans-serif',
    }}>
      <svg viewBox="0 0 240 160" width="100" height="66" xmlns="http://www.w3.org/2000/svg">
        <polygon points="120,5 235,145 195,145 120,42 45,145 5,145" fill="white" />
        <polygon points="120,38 185,145 160,145 120,78 80,145 55,145" fill="#64748b" />
      </svg>
      <div style={{
        fontSize: 42,
        fontWeight: 700,
        color: '#f1f5f9',
        marginTop: 28,
        letterSpacing: 0.5,
      }}>CTT AI Analyst</div>
      <div style={{
        fontSize: 32,
        fontWeight: 600,
        color: '#f97316',
        marginTop: 8,
        letterSpacing: 1,
      }}>{phaseLabel} Briefing</div>
    </div>
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin || 'https://ctt-dashboard.vercel.app';
  const section = url.searchParams.get('section') || 'scorecard';

  const isStrip = section === 'scorecardstrip';
  const [brief, macro, sectorsData, t2108Raw, chopRaw, chopSettingsRaw] = await Promise.all([
    fetchJson(`${origin}/api/analyst/brief`),
    fetchJson(`${origin}/api/macro`),
    section === 'sectors' ? fetchJson(`${origin}/api/sectors`) : null,
    isStrip ? fetchJson(`${origin}/api/t2108/latest`) : null,
    isStrip ? fetchJson(`${origin}/api/chop`) : null,
    isStrip ? fetchJson(`${origin}/api/settings/chop`) : null,
  ]);

  const rd = brief?.regimeDetail || {};
  const briefSections: any[] = brief?.sections || [];
  const sectionByName = (rx: RegExp) => briefSections.find((s: any) => rx.test(s.section));

  const quotes = macro?.quotes || {};
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM'].map(t => ({
    ticker: t,
    // /api/macro returns `pct`; keep `changePct` as a fallback for other shapes.
    chg: quotes[t]?.pct ?? quotes[t]?.changePct ?? 0,
  }));

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const regime = rd.regime ? String(rd.regime).split(/[.!]\s/)[0] : 'Analysis unavailable';

  let jsx: any;
  let w = 600;
  let h = 120;

  switch (section) {
    case 'cover': {
      const phase = url.searchParams.get('phase') || 'morning';
      const label = COVER_PHASE_LABELS[phase] || phase;
      jsx = renderCover(label);
      w = 1200;
      h = 630;
      break;
    }
    case 'scorecard':
      jsx = renderScorecard(indices, dateStr);
      h = 90;
      break;
    case 'regime':
      jsx = renderRegime(regime);
      h = 100;
      break;
    case 'trades': {
      const trades = (sectionByName(/Top Trades/i)?.stocks || []).slice(0, 5);
      jsx = renderTrades(trades);
      h = 56 + trades.length * 34;
      break;
    }
    case 'avoids': {
      const avoids = (sectionByName(/Top Avoid/i)?.stocks || []).slice(0, 4);
      jsx = renderAvoids(avoids);
      h = 56 + avoids.length * 34;
      break;
    }
    case 'sectors': {
      const sectors = (sectorsData?.sectors || []).slice(0, 11);
      jsx = renderSectors(sectors);
      h = 56 + sectors.length * 26;
      break;
    }
    case 'scorecardstrip': {
      const quotes = macro?.quotes || {};
      const bData = macro?.breadth;
      const chopBands = bandsFor(chopSettingsRaw?.mode);
      const { tone } = marketTone(quotes, bData?.score);
      const chopVal = chopRaw?.success ? chopComposite(rawChopOf(chopRaw), bData ?? null) : null;
      const tVal = t2108Raw?.value ?? null;

      const cells: StripCell[] = [];
      cells.push({ label: 'TONE', value: tone, sub: '', color: toneCellTone(tone) });
      if (bData) {
        cells.push({ label: 'BREADTH', value: `${bData.score}/6`, sub: bData.signal || '', color: breadthSignalTone(bData.signal) });
      }
      const mm = marketMonitorOf(bData);
      if (mm) {
        const partial = mm.days > 0 && mm.days < 5;
        cells.push({
          label: 'MKT MON',
          value: `${mm.up4 ?? 0}/${mm.down4 ?? 0}`,
          sub: mm.ratio5 != null
            ? `${mmRatioLabel(mm)}x ${partial ? `${mm.days}/5d` : '5d'}`
            : partial ? `${mm.days}/5d` : '',
          color: mmTodayTone(mm.up4, mm.down4),
        });
      }
      if (bData) {
        const ad = advPct(bData.advancers, bData.decliners);
        cells.push({ label: 'ADV / DEC', value: `${ad.toFixed(1)}%`, sub: `${bData.advancers ?? 0} / ${bData.decliners ?? 0}`, color: advCellTone(ad) });
      }
      if (bData && (bData.newHighs != null || bData.newLows != null)) {
        const hp = highsPct(bData.newHighs, bData.newLows);
        cells.push({ label: 'HI / LO', value: `${hp.toFixed(1)}%`, sub: `${bData.newHighs ?? 0} / ${bData.newLows ?? 0}`, color: highsCellTone(hp) });
      }
      if (tVal != null) {
        cells.push({ label: 'T2108', value: `${tVal.toFixed(0)}%`, sub: t2108ZoneLabel(tVal), color: t2108CellTone(tVal) });
      }
      if (bData?.mkm != null) {
        const rising = !!bData.mkmRising;
        cells.push({
          label: 'McCLELLAN',
          value: `${Number(bData.mkm).toFixed(0)}%`,
          sub: `${rising ? '▲' : '▼'} vs ${Number(bData.mkmSignal ?? 0).toFixed(0)}`,
          color: mkmCellTone(Number(bData.mkm), Number(bData.mkmSignal ?? 0), rising),
        });
      }
      const vixQ = quotes['VIX'];
      if (vixQ?.price) {
        const sign = (vixQ.pct ?? 0) >= 0 ? '+' : '';
        cells.push({
          label: 'VIX',
          value: Number(vixQ.price).toFixed(2),
          sub: `${sign}${Number(vixQ.pct ?? 0).toFixed(2)}%`,
          color: vixPctTone(Number(vixQ.pct ?? 0)),
        });
      }
      if (chopVal != null) {
        cells.push({
          label: 'CHOP',
          value: chopVal.toFixed(0),
          sub: chopZoneLabel(chopVal, chopBands),
          color: chopCellTone(chopVal, chopBands),
        });
      }
      jsx = renderScorecardStrip(cells.length ? cells : [{ label: 'NO DATA', value: '—', sub: '', color: 'slate' }]);
      w = 1200;
      h = 190;
      break;
    }
    default:
      jsx = renderScorecard(indices, dateStr);
      h = 90;
  }

  return new ImageResponse(jsx, { width: w, height: h });
}
