"""Lightning Blackjack calibration for Golan Casino.
Each round costs main bet + a Lightning fee equal to the main bet. At the end of the round the player
earns a multiplier from a table chosen by the final total of the first hand (bust/surrender, <=17, 18, 19, 20, 21).
The multiplier boosts the WINNINGS (profit) of every winning hand in the player's NEXT round.
Fee RTP = E[m - 1] * W, where W = expected total profit on winning hands per unit main bet."""
import random, sys
from collections import Counter
from sidebets import Shoe, total, is_bj, strategy

def play(shoe):
    if len(shoe.cards) < shoe.cut: shoe.shuffle()
    p = [shoe.draw(), shoe.draw()]; d = [shoe.draw(), shoe.draw()]
    if is_bj(d) or is_bj(p):
        if is_bj(p) and not is_bj(d): return 1.5, 1.5, "21"
        return (0.0 if is_bj(p) else -1.0), 0.0, ("21" if is_bj(p) else tier(total(p)[0]))
    hands = [[p, 1.0, False]]; i = 0; splits = 0
    while i < len(hands):
        h, bet, _ = hands[i]
        sa = h[0][0] == "A" and splits > 0 and len(h) == 1
        if len(h) == 1: h.append(shoe.draw())
        if sa: i += 1; continue
        while total(h)[0] < 21:
            a = strategy(h, d[0], len(h) == 2, len(h) == 2 and len(hands) < 4, len(h) == 2 and len(hands) == 1)
            if a == "P":
                hands.append([[h.pop()], bet, False]); splits += 1
                h.append(shoe.draw())
                if h[0][0] == "A": break
                continue
            if a == "R": hands[i][2] = True; break
            if a == "D": hands[i][1] = bet * 2; h.append(shoe.draw()); break
            if a == "S": break
            h.append(shoe.draw())
        i += 1
    while total(d)[0] < 17: d.append(shoe.draw())
    dt = total(d)[0]; net = 0.0; win = 0.0
    for h, bet, surr in hands:
        if surr: net -= 0.5; continue
        pt = total(h)[0]
        if pt > 21: net -= bet
        elif dt > 21 or pt > dt: net += bet; win += bet
        elif pt < dt: net -= bet
    first = hands[0]
    return net, win, ("bust" if first[2] or total(first[0])[0] > 21 else tier(total(first[0])[0]))

def tier(t): return "bust" if t > 21 else "17" if t <= 17 else str(t)

if __name__ == "__main__":
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 2_000_000
    random.seed(7); shoe = Shoe(); net = win = 0.0; tiers = Counter()
    for _ in range(N):
        a, b, t = play(shoe); net += a; win += b; tiers[t] += 1
    print(f"rounds={N} main edge {-net/N*100:.2f}%  W(profit on wins per unit)={win/N:.4f}")
    for k in ("bust", "17", "18", "19", "20", "21"): print(f"  tier {k:4s} {tiers[k]/N*100:6.2f}%")
