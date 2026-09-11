"""scripts/backtest/validate_ep9m.py — does the replay reproduce the live scanner?

Run from trade-dash after replay:  python3 scripts/backtest/validate_ep9m.py [live-registry.json]
Compares, day by day, the names the LIVE EP9M scan put in its registry against
the replay's final list over the overlap window, and explains every miss from
the cached bars. The five-year result is only worth reading if this agrees.

Expected, structural differences (not bugs):
  - Live keeps the best INTRADAY score; a name that qualified at 11:00 and
    faded (volume fine, but closed red or below the RVOL line) is live-only.
  - Live scores include float, short interest and news; v1 does not — this
    only matters when more than 25 names qualify, which is rare.
"""
import gzip, json, os, sys
from collections import defaultdict

HERE = os.getcwd()
DATA = os.path.abspath(os.path.join(HERE, '..', 'backtest-data'))
live_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(DATA, 'live', 'ep9m_registry_20260911.json')


def day(kind, date):
    p = os.path.join(DATA, 'grouped', kind, date[:4], f'{date}.json.gz')
    if not os.path.exists(p):
        return None
    rows = json.loads(gzip.open(p).read())['rows']
    return {r[0]: r for r in rows} if rows else None


def main():
    live = json.load(open(live_path))
    bt = defaultdict(dict)
    with open(os.path.join(DATA, 'replay', 'ep9m_v1_registry.jsonl')) as f:
        for line in f:
            r = json.loads(line)
            bt[r['date']][r['ticker']] = r
    last_bt = max(bt)
    live_by = defaultdict(set)
    for e in live:
        live_by[e['date']].add(e['ticker'])

    sessions = sorted(d for d in os.listdir(os.path.join(DATA, 'grouped', 'adj', '2026')) if os.path.getsize(os.path.join(DATA, 'grouped', 'adj', '2026', d)) > 1000)
    sessions = [s[:10] for s in sessions]

    tot_live = tot_hit = tot_bt = tot_bt_hit = 0
    reasons = defaultdict(int)
    detail = []
    for date in sorted(live_by):
        if date > last_bt:
            print(f'{date}: after replay window (cache ends {last_bt}) — skipped')
            continue
        if date not in bt and date not in sessions:
            print(f'{date}: not a trading session ({len(live_by[date])} live entries) — skipped')
            continue
        L = live_by[date]
        F = {t for t, r in bt[date].items() if r['inFinal']}
        S = {t for t, r in bt[date].items() if not r['inFinal']}
        hit = L & F
        tot_live += len(L); tot_hit += len(hit); tot_bt += len(F); tot_bt_hit += len(hit)
        un = day('unadj', date)
        for t in sorted(L - F):
            if t in S:
                why = 'closed red (change gate) — live caught it while green intraday'
            elif un is None or t not in un:
                why = 'no bar in cache'
            else:
                c, v = un[t][4], un[t][5]
                if v < 9e6:
                    why = f'EOD volume {v/1e6:.1f}M < 9M'
                elif c < 2:
                    why = f'close ${c:.2f} < $2'
                else:
                    why = 'passed gates at close but not shortlisted (RVOL/$vol/top-40)'
            reasons[why.split(' —')[0].split(' (')[0] if 'volume' not in why else 'EOD volume < 9M'] += 1
            detail.append(f'  miss {date} {t:6s} {why}')
        for t in sorted(F - L):
            detail.append(f'  extra {date} {t:6s} replay-only (score {bt[date][t]["score"]}, chg {bt[date][t]["changePct"]}%)')

    print(f'\nlive entries compared: {tot_live}   reproduced: {tot_hit}  → recall {tot_hit / tot_live * 100:.1f}%')
    print(f'replay flags on those days: {tot_bt}   also live: {tot_bt_hit}  → precision {tot_bt_hit / tot_bt * 100:.1f}%')
    print('miss reasons:', dict(reasons))
    print('\n'.join(detail[:60]))


if __name__ == '__main__':
    main()
