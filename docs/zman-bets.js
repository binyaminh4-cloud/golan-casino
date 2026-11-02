(function(root){
 'use strict';
 const values=[5n,25n,100n,500n,...[1000n,1000000n,1000000000n].flatMap(m=>[1n,5n,25n,100n,500n].map(v=>v*m)),1000000000000n,5000000000000n];
 const allowed=new Set(['one','yoav','range','vip','balls',...['f','i','b'].flatMap(p=>[0,1,2,3].map(i=>p+i))]);
 function layout(raw){const out={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;for(const [k,v]of Object.entries(raw))if(allowed.has(k)&&/^[1-9]\d*$/.test(String(v)))out[k]=BigInt(v).toString();return out;}
 function sum(raw){return Object.values(layout(raw)).reduce((n,v)=>n+BigInt(v),0n);}
 function rack(balance){balance=BigInt(balance||0);return values.filter((v,i)=>i<7||v*20n<=balance).slice(-7).map(String);}
 class AutoPlan{
  constructor(){this.stop();this.rounds=new Set();}
  arm(count,raw){if(![10,25,50,100,Infinity].includes(count)||sum(raw)<=0n)throw Error('invalid_auto_plan');this.remaining=count;this.template=layout(raw);this.rounds.clear();}
  get running(){return this.remaining>0;}
  claim(round){if(!this.running||this.rounds.has(round))return false;this.rounds.add(round);if(this.rounds.size>100)this.rounds.delete(this.rounds.values().next().value);return true;}
  confirmed(){if(this.remaining!==Infinity)this.remaining=Math.max(0,this.remaining-1);}
  stop(){this.remaining=0;this.template={};}
 }
 root.ZLM_BETS={values,rack,layout,sum,AutoPlan};
})(typeof window==='undefined'?globalThis:window);
