"""scripts/backtest/analyze_ep9m.py — slice the EP9M backtest outcomes.

Run from trade-dash after replay + score:  python3 scripts/backtest/analyze_ep9m.py
Reads  CTT/backtest-data/replay/ep9m_v1_{registry,outcomes}.jsonl
Writes CTT/backtest-data/replay/ep9m_v1_summary.json  (and prints the headline tables)

Every slice is reported twice: IS = the earlier two-thirds of scan dates,
OOS = the last third. A pattern that only shows up in one half is noise until
proven otherwise — that split is the guard against fitting the score to the
past. Slices under MIN_N are marked thin and should not be read.
"""
import json, os, statistics as st
from collections import defaultdict

HERE = os.getcwd()
REPLAY = os.path.abspath(os.path.join(HERE, '..', 'backtest-data', 'replay'))
MIN_N = 40
EXITS = ['fixedTarget', 'trail10', 'trail21', 'hold20']


def load():
    reg = {}
    with open(os.path.join(REPLAY, 'ep9m_v1_registry.jsonl')) as f:
        for line in f:
            r = json.loads(line)
            reg[(r['date'], r['ticker'], r['inFinal'])] = r
    rows = []
    with open(os.path.join(REPLAY, 'ep9m_v1_outcomes.jsonl')) as f:
        for line in f:
            o = json.loads(line)
            r = reg.get((o['date'], o['ticker'], o['inFinal']))
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


def stats(group):
    """Plan-based metrics over triggered trades + plan-free forward metrics over all flags."""
    matured = [g for g in group if g['out']['status'] in ('traded', 'no_trade')]
    traded = [g['out'] for g in group if g['out']['status'] == 'traded']
    fwd = [g['out']['fwd'] for g in group if g['out'].get('fwd') and g['out']['fwd'].get('ret20') is not None]
    s = {'n': len(group), 'matured': len(matured), 'traded': len(traded)}
    s['triggerRate'] = round(len(traded) / len(matured) * 100, 1) if matured else None
    if traded:
        s['hrHeld'] = round(sum(t['homeRunHeld'] for t in traded) / len(traded) * 100, 2)
        s['hrPath'] = round(sum(t['homeRunPath'] for t in traded) / len(traded) * 100, 2)
        s['medPeakPct'] = round(st.median(t['peakPct'] for t in traded), 1)
        for ex in EXITS:
            rs = [t['exits'][ex]['r'] for t in traded]
            s[f'{ex}_avgR'] = round(sum(rs) / len(rs), 3)
            s[f'{ex}_win'] = round(sum(r > 0 for r in rs) / len(rs) * 100, 1)
    if fwd:
        s['fwdN'] = len(fwd)
        s['ret20_avg'] = round(sum(f['ret20'] for f in fwd) / len(fwd), 2)
        s['ret20_med'] = round(st.median(f['ret20'] for f in fwd), 2)
        s['run60_med'] = round(st.median(f['run60'] for f in fwd), 1)
        s['run60_50plus'] = round(sum(f['run60'] >= 50 for f in fwd) / len(fwd) * 100, 2)
    s['thin'] = len(traded) < MIN_N
    return s


SLICES = {
    'grade': lambda r: r['grade'],
    'score': lambda r: bucket(r['score'], [20, 40, 60], ['<20', '20-39', '40-59', '60+']),
    'pts.rvol': lambda r: r['breakdown']['rvol'],
    'pts.unprecedented': lambda r: r['breakdown']['unprecedented'],
    'pts.closeStrength': lambda r: r['breakdown']['closeStrength'],
    'pts.moneyFlow': lambda r: r['breakdown']['moneyFlow'],
    'pts.repeatOffender': lambda r: r['breakdown']['repeatOffender'],
    'rvol': lambda r: bucket(r['rvol'], [4, 5, 7, 10], ['3-4', '4-5', '5-7', '7-10', '10+']),
    'volVs60dMax': lambda r: bucket(r['volVs60dMax'], [0.7, 1, 1.5, 2], ['<0.7', '0.7-1', '1-1.5', '1.5-2', '2+']),
    'closeStrength': lambda r: bucket(r['closeStrength'], [0.25, 0.5, 0.7, 0.85], ['<.25', '.25-.5', '.5-.7', '.7-.85', '.85+']),
    'mf': lambda r: bucket(r['mf'], [35, 45, 55, 65], ['<35', '35-45', '45-55', '55-65', '65+']),
    'rsRating': lambda r: bucket(r['rsRating'], [50, 70, 80, 90], ['<50', '50-69', '70-79', '80-89', '90+']),
    'stage': lambda r: (r['stage'] or 'n/a')[:7],
    'gapPct': lambda r: bucket(r['gapPct'], [0, 5, 10, 20], ['<0', '0-5', '5-10', '10-20', '20+']),
    'changePct': lambda r: bucket(r['changePct'], [5, 10, 20, 40], ['0-5', '5-10', '10-20', '20-40', '40+']),
    'epType': lambda r: r['epType'],
    'priorTriggers': lambda r: min(r['priorTriggers'], 2),
    'spyAbove200': lambda r: r.get('spyAbove200'),
    'spyAbove50': lambda r: r.get('spyAbove50'),
    'spy50Rising': lambda r: r.get('spy50Rising'),
    'chop14': lambda r: bucket(r['chop14'], [38.2, 61.8], ['trend<38', 'mid', 'chop>62']),
    'aboveSma200': lambda r: r['aboveSma200'],
    'ema21Rising': lambda r: r['ema21Rising'],
    'overextended': lambda r: r['plan'].get('overextended'),
    'planClear': lambda r: r['plan'].get('clear'),
    'priceAsTraded': lambda r: bucket(r['priceAsTraded'], [5, 10, 20, 50, 100], ['2-5', '5-10', '10-20', '20-50', '50-100', '100+']),
    'dVol': lambda r: bucket(r['dVol'], [5e7, 1e8, 3e8, 1e9], ['<50M', '50-100M', '100-300M', '300M-1B', '1B+']),
    'stopPct': lambda r: bucket(r['plan'].get('stopPct'), [3, 5, 8, 12], ['<3', '3-5', '5-8', '8-12', '12+']),
    'year': lambda r: r['date'][:4],
}


def main():
    rows = load()
    final = [r for r in rows if r['inFinal']]
    shadow = [r for r in rows if not r['inFinal']]
    dates = sorted({r['date'] for r in final})
    cut = dates[int(len(dates) * 2 / 3)]
    halves = {'IS': [r for r in final if r['date'] < cut], 'OOS': [r for r in final if r['date'] >= cut]}

    summary = {
        'window': [dates[0], dates[-1]], 'splitAt': cut,
        'all': {'ALL': stats(final), 'IS': stats(halves['IS']), 'OOS': stats(halves['OOS'])},
        'changeGate': {'passed (final list)': stats(final), 'dropped (red day)': stats(shadow)},
        'slices': {},
    }
    for name, fn in SLICES.items():
        out = {}
        keys = sorted({str(fn(r)) for r in final})
        for k in keys:
            out[k] = {h: stats([r for r in halves[h] if str(fn(r)) == k]) for h in ('IS', 'OOS')}
            out[k]['ALL'] = stats([r for r in final if str(fn(r)) == k])
        summary['slices'][name] = out

    with open(os.path.join(REPLAY, 'ep9m_v1_summary.json'), 'w') as f:
        json.dump(summary, f, indent=1)

    a = summary['all']['ALL']
    print(f"window {dates[0]} → {dates[-1]}  split {cut}")
    print(f"flags {a['n']}  matured {a['matured']}  traded {a['traded']}  trigger {a['triggerRate']}%")
    print(f"HOME RUN held {a.get('hrHeld')}%  path {a.get('hrPath')}%  median peak {a.get('medPeakPct')}%")
    for ex in EXITS:
        print(f"  {ex:12s} avgR {a.get(ex + '_avgR')}  win {a.get(ex + '_win')}%   IS {summary['all']['IS'].get(ex + '_avgR')}  OOS {summary['all']['OOS'].get(ex + '_avgR')}")
    cg = summary['changeGate']
    for k, v in cg.items():
        print(f"change gate — {k:20s} n={v['n']} ret20 avg {v.get('ret20_avg')} med {v.get('ret20_med')}  run60≥50% {v.get('run60_50plus')}%")


if __name__ == '__main__':
    main()
