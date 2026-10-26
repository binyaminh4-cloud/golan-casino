"""Golan Fortune slots: 3 reels x 3 rows, 5 lines. 32 physical stops per reel; each stop has a weight (virtual reel),
so the ZEUS stop lands less often. 3 ZEUS on the MIDDLE line = grand progressive jackpot. Exact enumeration."""
from itertools import product
COUNTS = {"CH": 8, "COIN": 7, "BAR": 5, "SEV": 4, "DIA": 3, "FISHER": 2, "BIN": 2, "ZEUS": 1}
W = {"ZEUS": 3}
DEF = 4
PAY3 = {"BIN": 400, "FISHER": 200, "DIA": 100, "SEV": 50, "BAR": 25, "COIN": 10, "CH": 5, "ZEUS": 0}
CHERRY = {1: 1, 2: 3}
LINES = [(1, 1, 1), (0, 0, 0), (2, 2, 2), (0, 1, 2), (2, 1, 0)]
def strip():
    out = []; pool = dict(COUNTS)
    while any(pool.values()):
        for k in list(pool):
            if pool[k]: out.append(k); pool[k] -= 1
    return out
S = strip(); N = len(S)
WT = [W.get(s, DEF) for s in S]; TW = sum(WT)
def line_pay(a, b, c):
    if a == b == c: return PAY3[a]
    n = 0
    for s in (a, b, c):
        if s == "CH": n += 1
        else: break
    return CHERRY.get(n, 0)
def run():
    ev = 0.0; hit = 0.0; grand = 0.0
    for st in product(range(N), repeat=3):
        p = WT[st[0]] * WT[st[1]] * WT[st[2]] / TW ** 3
        cols = [[S[(s - 1) % N], S[s], S[(s + 1) % N]] for s in st]
        win = sum(line_pay(cols[0][r[0]], cols[1][r[1]], cols[2][r[2]]) for r in LINES)
        ev += p * win; hit += p * (win > 0)
        if cols[0][1] == cols[1][1] == cols[2][1] == "ZEUS": grand += p
    return ev / 5, hit, grand
if __name__ == "__main__":
    r, h, g = run()
    print("strip", N, S); print("weights", WT, "total", TW)
    print(f"base RTP {r*100:.2f}%  hit {h*100:.1f}%  grand 1 in {1/g:,.0f} spins")
