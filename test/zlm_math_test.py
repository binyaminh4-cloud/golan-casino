"""Independent exact expectation audit of approved play-money rules, not Monte Carlo."""
from fractions import Fraction as F
from math import comb
import itertools, json

tables=[[(2,45),(3,25),(4,15),(5,8),(6,5),(8,2)],[(4,35),(5,25),(6,15),(7,10),(8,8),(9,4),(10,3)],[(10,100),(12,40),(15,24),(20,16),(25,10),(30,6),(40,3),(50,1)]]
yoav=F(0);mass=F(0)
for a,wa in tables[0]:
 for b,wb in tables[1]:
  if a==b:continue
  for c,wc in tables[2]:
   if c in (a,b):continue
   p=F(wa,100)*F(wb,sum(w for v,w in tables[1] if v!=a))*F(wc,sum(w for v,w in tables[2] if v not in (a,b)))
   mass+=p;yoav+=p*F(a+b+c,3)
assert mass==1
normal=F(10+25+50+100,5)+F(30+F(10+25+50+100,4),5)
vip=sum(sum(v) for v in itertools.combinations([10,20,25,50,100],3))/10
assert normal==F(209,4) and vip==123
ladder=[5,10,15,20,30,50,75,100,150,250,500,1000]
ball=cap=draws=mass=0.
for n in range(28):
 for s in range(4):
  for o in range(61):
   k=n+s+o+3
   p=comb(27,n)*comb(3,s)*comb(60,o)*comb(20,3)/comb(110,k)*17/(110-k)
   level=min(11,n+2*s);mass+=p;ball+=p*ladder[level];cap+=p*(level==11);draws+=p*(k+1)
assert abs(mass-1)<1e-12 and abs(draws-4*111/21)<1e-10
boost=1+F(13,2)/54*(F(645,100)-1)
ev={ 'one':(24,1),'fisher_or_ido_letter':(2,25),'biniyo_letter':(1,42),'yoav':(6,yoav),'range':(2,normal),'vip':(1,vip),'balls':(1,ball)}
returns={key:round(float(F(count,54)*(1+profit*boost))*100,5) for key,(count,profit) in ev.items()}
print(json.dumps({'conditional_profit':{'yoav':float(yoav),'range':float(normal),'vip':vip,'balls':ball},'balls_mean_draws':draws,'balls_cap_probability':cap,'expected_wheel_profit_boost':float(boost),'return_percent_for_each_spot_including_winning_stake':returns},indent=2))
