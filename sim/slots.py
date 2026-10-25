"""Golan Casino slots: 3 reels, 3 rows, 5 lines (top, middle, bottom, two diagonals). Exact RTP by enumerating every stop."""
from itertools import product
STRIP_COUNTS = {  # symbol: count per reel (same strip on all reels, 32 stops)
    "CH": 6, "LE": 6, "OR": 5, "GR": 5, "BE": 4, "BAR": 3, "SEV": 2, "DIA": 1,
}
PAY3 = {"DIA": 1000, "SEV": 300, "BAR": 100, "BE": 50, "GR": 30, "OR": 25, "LE": 20, "CH": 15}  # 3 in a line, x line bet
CHERRY = {1: 1, 2: 3}       # cherries counted from the left reel only (not 3)
LINES = [(1, 1, 1), (0, 0, 0), (2, 2, 2), (0, 1, 2), (2, 1, 0)]

def strip():
    # interleave symbols so equal symbols are spread out
    out = []; pool = {k: v for k, v in STRIP_COUNTS.items()}
    while any(pool.values()):
        for k in list(pool):
            if pool[k]: out.append(k); pool[k] -= 1
    return out
S = strip(); N = len(S)

def line_pay(a, b, c):
    if a == b == c: return PAY3[a]
    n = 0
    for s in (a, b, c):
        if s == "CH": n += 1
        else: break
    return CHERRY.get(n, 0)

def rtp():
    total = 0; hits = 0; big = {}
    for s0, s1, s2 in product(range(N), repeat=3):
        cols = [[S[(s - 1) % N], S[s], S[(s + 1) % N]] for s in (s0, s1, s2)]
        win = 0
        for r in LINES:
            p = line_pay(cols[0][r[0]], cols[1][r[1]], cols[2][r[2]]); win += p
            if p >= 100: big[p] = big.get(p, 0) + 1
        total += win; hits += win > 0
    spins = N ** 3
    return total / (spins * 5), hits / spins, {k: spins * 5 / v for k, v in big.items()}

if __name__ == "__main__":
    r, h, big = rtp()
    print("strip", N, S)
    print(f"RTP {r*100:.2f}%  hit rate {h*100:.1f}%  big wins (1 in N lines): " + ", ".join(f"{k}x:{v:,.0f}" for k, v in sorted(big.items())))
