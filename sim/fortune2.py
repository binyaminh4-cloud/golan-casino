"""Golan Fortune v2: adds a FREE scatter. A FREE showing anywhere on each of the 3 reels (3 rows visible) = 10 free spins
at the same bet (free spins can retrigger). Total RTP = base * (1 + 10*q + (10*q)^2 + ...) = base / (1 - 10 q)."""
from itertools import product
import sys
COUNTS = {"CH": 7, "COIN": 6, "BAR": 5, "SEV": 4, "DIA": 3, "FISHER": 2, "BIN": 2, "ZEUS": 1, "FREE": 2}
W = {"ZEUS": 3, "FREE": 7}; DEF = 4
PAY3 = {"BIN": 400, "FISHER": 200, "DIA": 100, "SEV": 50, "BAR": 30, "COIN": 12, "CH": 6, "ZEUS": 0, "FREE": 0}
CHERRY = {1: 1, 2: 3}
LINES = [(1, 1, 1), (0, 0, 0), (2, 2, 2), (0, 1, 2), (2, 1, 0)]
def strip(c):
    out = []; pool = dict(c)
    while any(pool.values()):
        for k in list(pool):
            if pool[k]: out.append(k); pool[k] -= 1
    return out
def line_pay(a, b, c, P):
    if a == b == c: return P[a]
    n = 0
    for s in (a, b, c):
        if s == "CH": n += 1
        else: break
    return CHERRY.get(n, 0)
def run(C=COUNTS, P=PAY3):
    S = strip(C); N = len(S); WT = [W.get(s, DEF) for s in S]; TW = sum(WT)
    ev = 0.0; q = 0.0
    for st in product(range(N), repeat=3):
        p = WT[st[0]] * WT[st[1]] * WT[st[2]] / TW ** 3
        cols = [[S[(s - 1) % N], S[s], S[(s + 1) % N]] for s in st]
        ev += p * sum(line_pay(cols[0][r[0]], cols[1][r[1]], cols[2][r[2]], P) for r in LINES)
        if all("FREE" in col for col in cols): q += p
    base = ev / 5
    return S, base, q, base / (1 - 10 * q)
if __name__ == "__main__":
    S, b, q, t = run()
    print(len(S), S); print(f"base {b*100:.2f}%  free spins 1 in {1/q:.0f}  total {t*100:.2f}%")
