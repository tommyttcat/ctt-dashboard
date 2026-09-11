"""scripts/backtest/analyze_multibagger.py — did the 100-Bagger screen beat its pond?

Run from trade-dash after replay-multibagger.py:
  python3 scripts/backtest/analyze_multibagger.py
Reads  CTT/backtest-data/replay/multibagger_{registry,sessions}.jsonl
Writes CTT/backtest-data/replay/multibagger_summary.json

THE MEASURE IS DIFFERENT HERE. Other scans are judged on R multiples over 60
sessions; this one is judged on forward returns at 3/6/12/24 months against
the MEDIAN of the same month's universe — the liquid $50M-$10B pond the screen
fished in. Beating the market average is not the bar: the screen only earns
its place if its picks beat the other names it could have picked that month.

Every slice is split IS (earlier two-thirds of month ends) / OOS (last third).
Horizons that have not fully matured are excluded automatically by the replay,
so 24-month numbers cover far fewer months than 3-month ones — the n column
says how many.
"""
import json, os, statistics as st

HERE = os.getcwd()
REPLAY = os.path.abspath(os.path.join(HERE, '..', 'backtest-data', 'replay'))
HORIZONS = [63, 126, 252, 504]
LABEL = {63: '3mo', 126: '6mo', 252: '12mo', 504: '24mo'}
MIN_N = 30


def load():
    rows = []
    with open(os.path.join(REPLAY, 'multibagger_registry.jsonl')) as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def bucket(v, edges, labels):
    if v is None:
        return 'n/a'
    for e, lab in zip(edges, labels):
        if v < e:
            return lab
    return labels[-1]


def stats(group):
    s = {'n': len(group)}
    for h in HORIZONS:
        picks = [g['fwd'][f'ret{h}'] for g in group if g.get('fwd') and g['fwd'].get(f'ret{h}') is not None]
        benches = [g['benchMed'][f'ret{h}'] for g in group if g.get('benchMed') and g['benchMed'].get(f'ret{h}') is not None
                   and g.get('fwd') and g['fwd'].get(f'ret{h}') is not None]
        if not picks:
            continue
        lab = LABEL[h]
        s[f'{lab}_n'] = len(picks)
        s[f'{lab}_med'] = round(st.median(picks), 2)
        s[f'{lab}_avg'] = round(sum(picks) / len(picks), 2)
        if benches:
            # Per-row excess: the pick minus its own month's universe median.
            ex = [p - b for p, b in zip(picks, benches)]
            s[f'{lab}_bench'] = round(st.median(benches), 2)
            s[f'{lab}_excess'] = round(st.median(ex), 2)
            s[f'{lab}_beat'] = round(sum(1 for e in ex if e > 0) / len(ex) * 100, 1)
        # the multi-bagger question itself
        runs = [g['fwd'][f'run{h}'] for g in group if g.get('fwd') and g['fwd'].get(f'run{h}') is not None]
        if runs:
            s[f'{lab}_pct100'] = round(sum(1 for r in runs if r >= 100) / len(runs) * 100, 2)
    return s


SLICES = {
    'grade': lambda r: r.get('grade', 'n/a'),
    'score': lambda r: bucket(r['score'], [40, 55, 70], ['20-39', '40-54', '55-69', '70+']),
    'mcapTier': lambda r: r.get('mcapTier') or 'n/a',
    'marketCap': lambda r: bucket(r['marketCap'], [3e8, 1e9, 3e9], ['<300M', '300M-1B', '1-3B', '3-10B']),
    'revGrowthPct': lambda r: bucket(r['revGrowthPct'], [15, 25, 50], ['10-15', '15-25', '25-50', '50+']),
    'roic': lambda r: bucket(r['roic'], [15, 25, 40], ['10-15', '15-25', '25-40', '40+']),
    'debtToEquity': lambda r: bucket(r['debtToEquity'], [0.25, 0.75, 1.5], ['<.25', '.25-.75', '.75-1.5', '1.5+']),
    'pe': lambda r: bucket(r['pe'], [0, 15, 30, 60], ['negative', '0-15', '15-30', '30-60', '60+']),
    'fcfYield': lambda r: bucket(r['fcfYield'], [0, 3, 6], ['negative', '0-3', '3-6', '6+']),
    'price': lambda r: bucket(r['price'], [10, 25, 60], ['<10', '10-25', '25-60', '60+']),
    'year': lambda r: r['date'][:4],
}


def main():
    rows = load()
    dates = sorted({r['date'] for r in rows})
    cut = dates[int(len(dates) * 2 / 3)]
    halves = {'IS': [r for r in rows if r['date'] < cut], 'OOS': [r for r in rows if r['date'] >= cut]}

    summary = {
        'window': [dates[0], dates[-1]], 'splitAt': cut, 'monthEnds': len(dates),
        'all': {'ALL': stats(rows), 'IS': stats(halves['IS']), 'OOS': stats(halves['OOS'])},
        'slices': {},
    }
    for name, fn in SLICES.items():
        out = {}
        for k in sorted({str(fn(r)) for r in rows}):
            out[k] = {h: stats([r for r in halves[h] if str(fn(r)) == k]) for h in ('IS', 'OOS')}
            out[k]['ALL'] = stats([r for r in rows if str(fn(r)) == k])
        summary['slices'][name] = out

    with open(os.path.join(REPLAY, 'multibagger_summary.json'), 'w') as f:
        json.dump(summary, f, indent=1)

    a = summary['all']['ALL']
    print(f"100-BAGGER  {dates[0]} → {dates[-1]}  {len(dates)} month ends  {a['n']} picks  split {cut}")
    print(f"{'horizon':8s} {'n':>5s} {'pick med':>9s} {'universe':>9s} {'excess':>8s} {'beat%':>7s} {'ran 100%+':>10s}")
    for h in HORIZONS:
        lab = LABEL[h]
        if f'{lab}_n' not in a:
            continue
        print(f"{lab:8s} {a[f'{lab}_n']:5d} {a.get(f'{lab}_med'):9} {a.get(f'{lab}_bench'):9} "
              f"{a.get(f'{lab}_excess'):8} {a.get(f'{lab}_beat'):7} {a.get(f'{lab}_pct100'):10}")
    for h in (252,):
        lab = LABEL[h]
        i, o = summary['all']['IS'], summary['all']['OOS']
        print(f"\n{lab} excess — IS {i.get(f'{lab}_excess')} (n={i.get(f'{lab}_n')})  OOS {o.get(f'{lab}_excess')} (n={o.get(f'{lab}_n')})")


if __name__ == '__main__':
    main()
