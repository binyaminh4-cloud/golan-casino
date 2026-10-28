/* Pure rules module. Browser + Node. All balance values are integer hundredths. */
(function(root){
'use strict';
const STEPS=[
 {title:'מרכז המגרש',actions:[{id:'pass',name:'מסירה',factor:[7,5],p:[180,259],kind:'pass'},{id:'dribble',name:'דריבל',factor:[2,1],p:[18,37],kind:'dribble'}]},
 {title:'מעבר ההגנה',actions:[{id:'wing',name:'מסירה לאגף',factor:[5,4],p:[4,5],kind:'pass'},{id:'through',name:'כדור עומק',factor:[2,1],p:[1,2],kind:'pass'}]},
 {title:'קצה הרחבה',actions:[{id:'longshot',name:'בעיטה מרחוק',factor:[2,1],p:[1,2],kind:'shot',terminal:true},{id:'enter',name:'כניסה לרחבה',factor:[5,4],p:[4,5],kind:'dribble'}]},
 {title:'הבלם האחרון',actions:[{id:'side',name:'מעבר מהצד',factor:[5,4],p:[4,5],kind:'dribble'},{id:'burst',name:'פריצה מול הבלם',factor:[2,1],p:[1,2],kind:'dribble'}]},
 {title:'מול השוער',actions:[{id:'normal',name:'בעיטה רגילה',factor:[3,2],p:[2,3],kind:'shot',terminal:true},{id:'corner',name:'לחיבורים',factor:[3,1],p:[1,3],kind:'shot',terminal:true}]}
];
function gcd(a,b){while(b){const t=b;b=a%b;a=t;}return a;}
function mul(r,f){const n=r[0]*f[0],d=r[1]*f[1],g=gcd(n,d);return [n/g,d/g];}
function amount(stake,r){return Math.floor((stake*r[0]*2+r[1])/(2*r[1]));}
function secureWin(p){
 if(!globalThis.crypto?.getRandomValues)throw Error('Secure randomness unavailable');
 const max=4294967296,limit=max-max%p[1],a=new Uint32Array(1);do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%p[1]<p[0];
}
class Game{
 constructor(balance=100000,win=secureWin){this.balance=balance;this.win=win;this.status='idle';this.stage=0;this.ratio=[1,1];this.stake=0;this.history=[];}
 start(stake){if(this.status==='active')throw Error('An attack is active');if(!Number.isSafeInteger(stake)||stake<100||stake>100000000||stake>this.balance)throw Error('Invalid stake');this.balance-=stake;this.stake=stake;this.stage=0;this.ratio=[1,1];this.status='active';this.history=[];this.paid=0;return this.snapshot();}
 get pot(){return amount(this.stake,this.ratio);}
 get canCash(){return this.status==='active'&&this.stage>0;}
 choices(){if(this.status!=='active')return [];return STEPS[this.stage].actions.map(a=>{const ratio=mul(this.ratio,a.factor),payout=amount(this.stake,ratio);return {...a,payout,profit:payout-this.stake,ratio};});}
 act(id){if(this.status!=='active')throw Error('No attack');const action=this.choices().find(a=>a.id===id);if(!action)throw Error('Invalid action');const from=this.stage,previous=this.pot,ok=!!this.win(action.p);this.history.push({stage:from,id,ok});if(!ok){this.status='lost';this.paid=0;}else{this.ratio=action.ratio;if(action.terminal){this.status='won';this.paid=this.pot;this.balance+=this.paid;}else this.stage++;}return {action,from,previous,ok,...this.snapshot()};}
 cashOut(){if(!this.canCash)throw Error('Cannot cash out');this.paid=this.pot;this.balance+=this.paid;this.status='cashed';return this.snapshot();}
 snapshot(){return {balance:this.balance,stake:this.stake,pot:this.status==='lost'?0:this.pot,stage:this.stage,status:this.status,paid:this.paid||0,canCash:this.canCash};}
}
const api={STEPS,Game,mul,amount,secureWin};if(typeof module!=='undefined')module.exports=api;else root.FisherRules=api;
})(globalThis);
