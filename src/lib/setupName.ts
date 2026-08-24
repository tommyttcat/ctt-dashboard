export function formatSetupName(name: string | null | undefined): string {
  if (!name || name === '-' || name === '—') return '—';
  const n = name.trim();
  if (n.includes('BB SQZ')) return 'BB SQZ';
  if (n === 'Blue Dot Rev' || n.toLowerCase().includes('blue dot')) return 'BD REV';
  if (n === 'Episodic Pivot') return 'EP';
  if (n === 'Gap & Go' || n === 'Gap and Go') return 'GNG';
  if (n === 'Trend Hold') return 'TH';
  if (n === '20 EMA PB' || n === 'EMA Pullback') return 'PB';
  if (n === 'Inside Day' || n.startsWith('Inside Day')) return 'ID BRK';
  if (n === 'Range Breakout') return 'RNG BRK';
  if (n === 'Power Earnings Gap') return 'PEG';
  if (n === 'Momentum Burst') return 'MOM';
  if (n === 'Technical Momentum') return '—';
  return n.length > 10 ? n.slice(0, 10).trim().toUpperCase() : n.toUpperCase();
}

export function isBlueDotSetup(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n === 'blue dot rev' || n.includes('blue dot') || n.includes('bd rev');
}
