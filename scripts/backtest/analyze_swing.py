"""scripts/backtest/analyze_swing.py — slice the Swing Candidates backtest.

Run from trade-dash after replay-vcp + score-vcp:  python3 scripts/backtest/analyze_vcp.py [--all-rows]
Reads  CTT/backtest-data/replay/vcp_{registry,outcomes}.jsonl
Writes CTT/backtest-data/replay/swing_summary.json  (and prints the headline tables)

POPULATION: first appearances only (isNewBase) by default. A base is flagged
every session it stays valid, so counting every row would weight a base that
lived six weeks thirty times over one that broke out the next day — and those
are not independent observations. --all-rows shows the unfiltered version.

Every slice is reported twice: IS = the earlier two-thirds of scan dates,
OOS = the last third. A pattern that only appears in one half is noise until
proven otherwise. Slices under MIN_N are marked thin and should not be read.
"""
import json, os, sys, statistics as st

HERE = os.getcwd()
REPLAY = os.path.abspath(os.path.join(HERE, '..', 'backtest-data', 'replay'))
MIN_N = 30
EXITS = ['fixedTarget', 'trail10', 'trail21', 'hold20']
ENTRIES = ['open1', 'highBreak']


def load():
    reg = {}
    with open(os.path.join(REPLAY, 'swing_registry.jsonl')) as f:
        for line in f:
            r = json.loads(line)
            reg[(r['date'], r['ticker'])] = r
    rows = []
    with open(os.path.join(REPLAY, 'swing_outcomes.jsonl')) as f:
        for line in f:
            o = json.loads(line)
            r = reg.get((o['date'], o['ticker']))
            if r:
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


def stats(group, method='open1'):
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
    'grade': lambda r: r.get('grade', 'n/a'),
    'score': lambda r: bucket(r['score'], [45, 60, 75], ['<45', '45-59', '60-74', '75+']),
    'rsRating': lambda r: bucket(r['rsRating'], [70, 85, 95], ['<70', '70-84', '85-94', '95+']),
    'atrPct': lambda r: bucket(r['atrPct'], [2, 3, 4.5], ['<2', '2-3', '3-4.5', '4.5+']),
    'adrPct': lambda r: bucket(r['adrPct'], [4, 5.5, 7], ['<4', '4-5.5', '5.5-7', '7+']),
    'pctOffHigh': lambda r: bucket(r['pctOffHigh'], [5, 10, 15], ['<5', '5-10', '10-15', '15-20']),
    'distToEma21': lambda r: bucket(abs(r['distToEma21']) if r.get('distToEma21') is not None else None, [1, 2, 3], ['<1', '1-2', '2-3', '3-4']),
    'stochK': lambda r: bucket(r['stochK'], [15, 25, 35], ['<15', '15-25', '25-35', '35+']),
    'mf': lambda r: bucket(r['mf'], [45, 55, 65], ['<45', '45-55', '55-65', '65+']),
    'stage': lambda r: (r.get('stage') or 'n/a')[:7],
    'closeStrength': lambda r: bucket(
        ((r['price'] - r['dayLow']) / (r['dayHigh'] - r['dayLow'])) if (r.get('dayHigh') and r.get('dayLow') and r['dayHigh'] > r['dayLow']) else None,
        [0.25, 0.5, 0.75, 0.9], ['<.25', '.25-.5', '.5-.75', '.75-.9', '.9+']),
    'price': lambda r: bucket(r['price'], [10, 25, 60], ['<10', '10-25', '25-60', '60+']),
    'spyAbove200': lambda r: r.get('spyAbove200'),
    'year': lambda r: r['date'][:4],
}


def main():
    rows = load()
    dates = sorted({r['date'] for r in rows})
    cut = dates[int(len(dates) * 2 / 3)]
    halves = {'IS': [r for r in rows if r['date'] < cut], 'OOS': [r for r in rows if r['date'] >= cut]}

    summary = {
        'population': 'all rows',
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

    with open(os.path.join(REPLAY, 'swing_summary.json'), 'w') as f:
        json.dump(summary, f, indent=1)

    a = summary['all']['ALL']
    print(f"SWING  {dates[0]} → {dates[-1]}  split {cut}")
    print(f"rows {a['n']}  matured {a['matured']}  filled {a['traded']}  fill rate {a['triggerRate']}%")
    print(f"HOME RUN held {a.get('hrHeld')}%  path {a.get('hrPath')}%  median peak {a.get('medPeakPct')}%  median risk {a.get('medRiskPct')}%")
    for m in ENTRIES:
        e = summary['entries'][m]
        cols = '  '.join(f"{ex} {e['ALL'].get(ex + '_avgR')}/{e['IS'].get(ex + '_avgR')}/{e['OOS'].get(ex + '_avgR')}" for ex in EXITS)
        print(f"  {m:6s} fill {e['ALL']['triggerRate']}%  HRheld {e['ALL'].get('hrHeld')}%  {cols}")


if __name__ == '__main__':
    main()
