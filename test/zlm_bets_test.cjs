const assert=require('node:assert/strict');require('../docs/zman-bets.js');const B=globalThis.ZLM_BETS;
assert.deepEqual(B.rack('0'),['5','25','100','500','1000','5000','25000']);
assert(!B.rack('1999999').includes('100000'));assert(B.rack('2000000').includes('100000'));
for(const n of ['10','1000000','3500000000000','9007199254740999']){const r=B.rack(n);assert.equal(r.length,7);for(const v of r)assert(B.values.indexOf(BigInt(v))<7||BigInt(v)*20n<=BigInt(n));}
assert.equal(B.sum({f1:'9007199254740993',i1:'7'}),9007199254741000n);
assert.deepEqual(B.layout({f1:'100',i1:'200',b1:'300',wrong:10,one:-1}),{f1:'100',i1:'200',b1:'300'});
const auto=new B.AutoPlan();assert.throws(()=>auto.arm(9,{one:'100'}));auto.arm(10,{one:'100',f1:'50'});
assert(auto.claim('round-1'));assert(!auto.claim('round-1'));auto.confirmed();assert.equal(auto.remaining,9);
auto.stop();assert(!auto.claim('round-2'));auto.arm(Infinity,{one:'1'});auto.claim('r');auto.confirmed();assert.equal(auto.remaining,Infinity);
console.log('PASS: roulette chip ladder and 20x thresholds; seven chips; exact bigint sums; colored layouts; one automatic repeat per round; stop and unlimited mode.');
