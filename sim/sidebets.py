"""Monte Carlo house edge for Golan Casino blackjack rules and side bets.
Rules: 6 decks, dealer stands on soft 17, BJ 3:2, double any 2, DAS, late surrender,
split to 4 hands, split aces get one card. Reshuffle at 75% penetration.
"""
import random, sys
from collections import Counter

RANKS = "A23456789TJQK"; SUITS = "SHDC"
def val(r): return 11 if r == "A" else 10 if r in "TJQK" else int(r)
def total(cards):
    t = sum(val(c[0]) for c in cards); a = sum(c[0] == "A" for c in cards)
    while t > 21 and a: t -= 10; a -= 1
    return t, a > 0  # soft flag approx (an ace still counted 11)
def is_bj(cards): return len(cards) == 2 and total(cards)[0] == 21

PP = {"perfect": 25, "colored": 12, "mixed": 6}
T3 = {"suited_trips": 100, "straight_flush": 40, "trips": 30, "straight": 10, "flush": 5}
LL = {"qh_pair_dealer_bj": 1000, "qh_pair": 200, "matched_20": 25, "suited_20": 10, "any_20": 4}
BUSTER = {3: 1, 4: 2, 5: 9, 6: 50, 7: 100, 8: 250}  # pays by number of cards in dealer's bust hand

def red(s): return s in "HD"
def perfect_pairs(a, b):
    if a[0] != b[0]: return None
    if a[1] == b[1]: return "perfect"
    return "colored" if red(a[1]) == red(b[1]) else "mixed"
ORDER = {r: i for i, r in enumerate("A23456789TJQK", 1)}
def twentyone3(cards):
    ranks = [c[0] for c in cards]; suits = [c[1] for c in cards]
    flush = len(set(suits)) == 1; trips = len(set(ranks)) == 1
    v = sorted(ORDER[r] for r in ranks)
    straight = (len(set(v)) == 3 and v[2] - v[0] == 2) or v == [1, 12, 13]
    if trips and flush: return "suited_trips"
    if straight and flush: return "straight_flush"
    if trips: return "trips"
    if straight: return "straight"
    if flush: return "flush"
    return None
def lucky_ladies(a, b, dealer_bj):
    if total([a, b])[0] != 20: return None
    if a == b == "QH": return "qh_pair_dealer_bj" if dealer_bj else "qh_pair"
    if a == b: return "matched_20"
    if a[1] == b[1]: return "suited_20"
    return "any_20"

# Basic strategy (6 deck, S17, DAS, LS). Returns H,S,D,P,R
def strategy(hand, up, can_double, can_split, can_surr):
    u = val(up[0]); t, soft = total(hand)
    r = [c[0] for c in hand]
    if can_split and len(hand) == 2 and val(r[0]) == val(r[1]):
        p = val(r[0])
        if p == 11 or p == 8: return "P"
        if p in (2, 3) and u <= 7: return "P"
        if p == 4 and u in (5, 6): return "P"
        if p == 6 and u <= 6: return "P"
        if p == 7 and u <= 7: return "P"
        if p == 9 and u not in (7, 10, 11): return "P"
    if can_surr and not soft:
        if t == 16 and u in (9, 10, 11): return "R"
        if t == 15 and u == 10: return "R"
    if soft and len(hand) >= 2:
        if t >= 19: return "D" if (t == 19 and u == 6 and can_double) else "S"
        if t == 18:
            if u <= 6: return "D" if can_double and u >= 2 else "S"
            return "S" if u in (7, 8) else "H"
        dbl = {17: (3, 6), 16: (4, 6), 15: (4, 6), 14: (5, 6), 13: (5, 6)}.get(t)
        if dbl and can_double and dbl[0] <= u <= dbl[1]: return "D"
        return "H"
    if t >= 17: return "S"
    if t >= 13: return "S" if u <= 6 else "H"
    if t == 12: return "S" if 4 <= u <= 6 else "H"
    if t == 11: return "D" if can_double else "H"
    if t == 10: return "D" if can_double and u <= 9 else "H"
    if t == 9: return "D" if can_double and 3 <= u <= 6 else "H"
    return "H"

class Shoe:
    def __init__(s, decks=6): s.n = decks; s.shuffle()
    def shuffle(s):
        s.cards = [r + su for r in RANKS for su in SUITS] * s.n; random.shuffle(s.cards); s.cut = int(len(s.cards) * 0.25)
    def draw(s): return s.cards.pop()

def play_round(shoe, stats):
    if len(shoe.cards) < shoe.cut: shoe.shuffle()
    p = [shoe.draw(), shoe.draw()]; d = [shoe.draw(), shoe.draw()]
    dealer_bj = is_bj(d)
    # side bets, 1 unit each
    for name, table, outcome in (("perfect_pairs", PP, perfect_pairs(*p)),
                                 ("21+3", T3, twentyone3([p[0], p[1], d[0]])),
                                 ("lucky_ladies", LL, lucky_ladies(p[0], p[1], dealer_bj))):
        stats[name] += table[outcome] if outcome else -1
        if outcome: stats["hits:" + name + ":" + outcome] += 1
    if d[0][0] == "A": stats["insurance_n"] += 1; stats["insurance"] += 2 if dealer_bj else -1
    # main game
    hands = [[p, 1.0, False]]; net = 0.0; i = 0; splits = 0
    if dealer_bj or is_bj(p):
        net = 0 if (dealer_bj and is_bj(p)) else (1.5 if is_bj(p) else -1)
        stats["main"] += net; stats["buster"] += -1; return
    while i < len(hands):
        h, bet, done = hands[i]
        split_aces = h[0][0] == "A" and splits > 0 and len(h) == 1
        if len(h) == 1: h.append(shoe.draw())
        if split_aces: i += 1; continue
        while True:
            t = total(h)[0]
            if t >= 21: break
            a = strategy(h, d[0], len(h) == 2, len(h) == 2 and len(hands) < 4, len(h) == 2 and len(hands) == 1)
            if a == "P":
                hands.append([[h.pop()], bet, False]); splits += 1
                if h[0][0] == "A": h.append(shoe.draw()); break
                h.append(shoe.draw()); continue
            if a == "R": hands[i][1] = -0.5; hands[i][2] = True; break
            if a == "D": hands[i][1] = bet * 2; h.append(shoe.draw()); break
            if a == "S": break
            h.append(shoe.draw())
        i += 1
    # Dealer always completes the hand (needed for Buster Blackjack settlement).
    while total(d)[0] < 17: d.append(shoe.draw())
    dt = total(d)[0]
    if dt > 21:
        n = min(len(d), 8); stats["buster"] += BUSTER.get(n, 0) if n >= 3 else -1
        stats["hits:buster:" + str(n)] += 1
    else: stats["buster"] += -1
    for h, bet, surr in hands:
        if surr: net += -0.5; continue
        pt = total(h)[0]
        if pt > 21: net -= bet
        elif dt > 21 or pt > dt: net += bet
        elif pt < dt: net -= bet
    stats["main"] += net

if __name__ == "__main__":
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 2_000_000
    random.seed(1)
    st = Counter(); shoe = Shoe()
    for _ in range(N): play_round(shoe, st)
    print(f"rounds={N}")
    for k in ("main", "perfect_pairs", "21+3", "lucky_ladies", "buster"):
        print(f"{k:14s} house edge {-st[k] / N * 100:6.2f}%")
    print(f"{'insurance':14s} house edge {-st['insurance'] / st['insurance_n'] * 100:6.2f}%")
    for k, v in sorted(st.items()):
        if k.startswith("hits:"): print(f"  {k[5:]:40s} 1 in {N / v:,.0f}")
