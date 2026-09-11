"""scripts/backtest/analyze_scanner.py — slice the Stocks in Play / Daily Setups backtest.

Run from trade-dash after replay-scanner + score-scanner:
  python3 scripts/backtest/analyze_scanner.py [--sip | --daily]
Reads  CTT/backtest-data/replay/vcp_{registry,outcomes}.jsonl
Writes CTT/backtest-data/replay/scanner_summary.json  (and prints the headline tables)

POPULATION: every row by default (one row = one name on one day, on either
table). --sip restricts to Stocks in Play, --daily to Daily Setups. The same
name can appear on both tables and on consecutive days; unlike VCP bases these
are separate day-trades rather than one setup counted repeatedly.

Every slice is reported twice: IS = the earlier two-thirds of scan dates,
OOS = the last third. A pattern that only appears in one half is noise until
proven otherwise. Slices under MIN_N are marked thin and should not be read.
"""
import json, os, sys, statistics as st

HERE = os.getcwd()
REPLAY = os.path.abspath(os.path.join(HERE, '..', 'backtest-data', 'replay'))
MIN_N = 30
EXITS = ['fixedTarget', 'trail10', 'trail21', 'hold20']
ENTRIES = ['plan', 'highBreak', 'open1']
ONLY_SIP = '--sip' in sys.argv
ONLY_DAILY = '--daily' in sys.argv


def load():
    reg = {}
    with open(os.path.join(REPLAY, 'scanner_registry.jsonl')) as f:
        for line in f:
            r = json.loads(line)
            reg[(r['date'], r['ticker'])] = r
    rows = []
    with open(os.path.join(REPLAY, 'scanner_outcomes.jsonl')) as f:
        for line in f:
            o = json.loads(line)
            r = reg.get((o['date'], o['ticker']))
            if not r:
                continue
            if ONLY_SIP and not r.get('inSip'):
                continue
            if ONLY_DAILY and not r.get('inDaily'):
                continue
            rows.append({**r, 'out': o})
    return rows


def bucket(v, edges, labels):
    if v is None:
        return 'n/a'
    for e, lab in zip(edges, labels):
        if v < e:
            return lab
    return labels[-1]


def entry(g, method):
    return (g['out'].get('entries') or {}).get(method) or {'status': g['out']['status']}


def stats(group, method='highBreak'):
    matured = [g for g in group if entry(g, method)['status'] in ('traded', 'no_trade')]
    traded = [entry(g, method) for g in group if entry(g, method)['status'] == 'traded']
    fwd = [g['out']['fwd'] for g in group if g['out'].get('fwd') and g['out']['fwd'].get('ret20') is not None]
    s = {'n': len(group), 'matured': len(matured), 'traded': len(traded)}
    s['triggerRate'] = round(len(traded) / len(matured) * 100, 1) if matured else None
    if traded:
        s['hrHeld'] = round(sum(t['homeRunHeld'] for t in traded) / len(traded) * 100, 2)
        s['hrPath'] = round(sum(t['homeRunPath'] for t in traded) / len(traded) * 100, 2)
        s['medPeakPct'] = round(st.median(t['peakPct'] for t in traded), 1)
        s['medRiskPct'] = round(st.median(t['riskPct'] for t in traded), 2)
        for ex in EXITS:
            rs = [t['exits'][ex]['r'] for t in traded]
            s[f'{ex}_avgR'] = round(sum(rs) / len(rs), 3)
            s[f'{ex}_win'] = round(sum(r > 0 for r in rs) / len(rs) * 100, 1)
    if fwd:
        s['ret20_med'] = round(st.median(f['ret20'] for f in fwd), 2)
        s['run60_50plus'] = round(sum(f['run60'] >= 50 for f in fwd) / len(fwd) * 100, 2)
    s['thin'] = len(traded) < MIN_N
    return s


SLICES = {
    'setupName': lambda r: r.get('setupName') or 'unnamed',
    'table': lambda r: ('SIP+Daily' if r.get('inSip') and r.get('inDaily') else 'SIP only' if r.get('inSip') else 'Daily only'),
    'rvol': lambda r: bucket(r['rvol'], [1.5, 2, 3, 5], ['<1.5', '1.5-2', '2-3', '3-5', '5+']),
    'changePct': lambda r: bucket(r['changePct'], [6, 10, 20, 40], ['4-6', '6-10', '10-20', '20-40', '40+']),
    'gapPct': lambda r: bucket(r['gapPct'], [0, 3, 8, 15], ['<0', '0-3', '3-8', '8-15', '15+']),
    'closeStrength': lambda r: bucket(r['closeStrength'], [0.25, 0.5, 0.75, 0.9], ['<.25', '.25-.5', '.5-.75', '.75-.9', '.9+']),
    'adrPct': lambda r: bucket(r['adrPct'], [4, 6, 9], ['3-4', '4-6', '6-9', '9+']),
    'atrPct': lambda r: bucket(r['atrPct'], [3, 5, 8], ['<3', '3-5', '5-8', '8+']),
    'stage': lambda r: (r['stage'] or 'n/a')[:7],
    'dotKind': lambda r: r.get('dotKind') or 'none',
    'rsRating': lambda r: bucket(r['rsRating'], [50, 70, 90], ['<50', '50-69', '70-89', '90+']),
    'mf': lambda r: bucket(r['mf'], [45, 55, 65], ['<45', '45-55', '55-65', '65+']),
    'chop14': lambda r: bucket(r['chop14'], [38.2, 61.8], ['trend<38', 'mid', 'chop>62']),
    'vwapStatus': lambda r: r.get('vwapStatus'),
    'priceAsTraded': lambda r: bucket(r['priceAsTraded'], [5, 10, 20, 50], ['2-5', '5-10', '10-20', '20-50', '50+']),
    'dVol': lambda r: bucket(r['dVol'], [2e7, 1e8, 5e8], ['<20M', '20-100M', '100-500M', '500M+']),
    'aboveSma200': lambda r: r.get('aboveSma200'),
    'planOverextended': lambda r: (r.get('plan') or {}).get('overextended'),
    'spyAbove200': lambda r: r.get('spyAbove200'),
    'spy50Rising': lambda r: r.get('spy50Rising'),
    'year': lambda r: r['date'][:4],
}


def main():
    rows = load()
    dates = sorted({r['date'] for r in rows})
    cut = dates[int(len(dates) * 2 / 3)]
    halves = {'IS': [r for r in rows if r['date'] < cut], 'OOS': [r for r in rows if r['date'] >= cut]}

    summary = {
        'population': 'SIP only' if ONLY_SIP else 'Daily only' if ONLY_DAILY else 'all rows',
        'window': [dates[0], dates[-1]], 'splitAt': cut,
        'all': {'ALL': stats(rows), 'IS': stats(halves['IS']), 'OOS': stats(halves['OOS'])},
        'entries': {m: {'ALL': stats(rows, m), 'IS': stats(halves['IS'], m), 'OOS': stats(halves['OOS'], m)} for m in ENTRIES},
        'slices': {},
    }
    for name, fn in SLICES.items():
        out = {}
        for k in sorted({str(fn(r)) for r in rows}):
            out[k] = {h: stats([r for r in halves[h] if str(fn(r)) == k]) for h in ('IS', 'OOS')}
            out[k]['ALL'] = stats([r for r in rows if str(fn(r)) == k])
        summary['slices'][name] = out

    with open(os.path.join(REPLAY, 'scanner_summary.json'), 'w') as f:
        json.dump(summary, f, indent=1)

    a = summary['all']['ALL']
    label = 'SIP only' if ONLY_SIP else 'Daily only' if ONLY_DAILY else 'SIP + Daily'
    print(f"SCANNER [{label}]  {dates[0]} → {dates[-1]}  split {cut}")
    print(f"rows {a['n']}  matured {a['matured']}  filled {a['traded']}  fill rate {a['triggerRate']}%")
    print(f"HOME RUN held {a.get('hrHeld')}%  path {a.get('hrPath')}%  median peak {a.get('medPeakPct')}%  median risk {a.get('medRiskPct')}%")
    for m in ENTRIES:
        e = summary['entries'][m]
        cols = '  '.join(f"{ex} {e['ALL'].get(ex + '_avgR')}/{e['IS'].get(ex + '_avgR')}/{e['OOS'].get(ex + '_avgR')}" for ex in EXITS)
        print(f"  {m:6s} fill {e['ALL']['triggerRate']}%  HRheld {e['ALL'].get('hrHeld')}%  {cols}")


if __name__ == '__main__':
    main()
