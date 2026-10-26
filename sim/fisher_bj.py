"""Fisher's Lightning Blackjack v2: before the deal Fisher strikes 2-3 card ranks with multipliers.
A winning hand that holds a struck rank has its profit multiplied by the highest struck multiplier in it.
Fee RTP = E[extra profit] / fee."""
import random, sys
from sidebets import Shoe, total, is_bj, strategy
RANKS = "A23456789TJQK"
COUNT = [(2, 60), (3, 40)]
MULT = [(2, 55), (3, 20), (4, 10), (5, 6), (6, 4), (8, 2.5), (10, 1.5), (15, 0.6), (25, 0.4)]
def pick(t):
    r = random.random() * sum(w for _, w in t); a = 0
    for v, w in t:
        a += w
        if r < a: return v
    return t[-1][0]
def strikes():
    k = pick(COUNT); rs = random.sample(RANKS, k); return {r: pick(MULT) for r in rs}
def play(shoe, st):
    if len(shoe.cards) < shoe.cut: shoe.shuffle()
    p = [shoe.draw(), shoe.draw()]; d = [shoe.draw(), shoe.draw()]
    m = lambda h: max([st.get(c[0], 1) for c in h])
    if is_bj(d) or is_bj(p):
        if is_bj(p) and not is_bj(d): return 1.5, 1.5 * (m(p) - 1)
        return (0.0 if is_bj(p) else -1.0), 0.0
    hands = [[p, 1.0, False]]; i = 0; splits = 0
    while i < len(hands):
        h, bet, _ = hands[i]
        sa = h[0][0] == "A" and splits > 0 and len(h) == 1
        if len(h) == 1: h.append(shoe.draw())
        if sa: i += 1; continue
        while total(h)[0] < 21:
            a = strategy(h, d[0], len(h) == 2, len(h) == 2 and len(hands) < 4, len(h) == 2 and len(hands) == 1)
            if a == "P":
                hands.append([[h.pop()], bet, False]); splits += 1; h.append(shoe.draw())
                if h[0][0] == "A": break
                continue
            if a == "R": hands[i][2] = True; break
            if a == "D": hands[i][1] = bet * 2; h.append(shoe.draw()); break
            if a == "S": break
            h.append(shoe.draw())
        i += 1
    while total(d)[0] < 17: d.append(shoe.draw())
    dt = total(d)[0]; net = 0.0; extra = 0.0
    for h, bet, surr in hands:
        if surr: net -= 0.5; continue
        pt = total(h)[0]
        if pt > 21: net -= bet
        elif dt > 21 or pt > dt: net += bet; extra += bet * (m(h) - 1)
        elif pt < dt: net -= bet
    return net, extra
if __name__ == "__main__":
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000
    random.seed(11); shoe = Shoe(); net = ex = 0.0
    for _ in range(N):
        a, b = play(shoe, strikes()); net += a; ex += b
    print(f"rounds={N} base edge {-net/N*100:.2f}%  E[extra]={ex/N:.4f} per unit bet")
    for fee in (0.3, 0.4, 0.5): print(f"  fee {fee:.0%}: total RTP {(1 + net/N + ex/N)/(1+fee)*100:.2f}%   fee-part RTP {ex/N/fee*100:.1f}%")
