// Approved creative rules only. No production probability distribution.
export const RULES = Object.freeze({
  version: '1.0.0', virtualCurrencyOnly: true, productionMathApproved: false,
  baseMultipliers: Object.freeze([5, 100, 10, 20, 50, 15, 25]),
  friendIds: Object.freeze(['friend_01','friend_02','friend_03','fisher','friend_05','friend_06','yoav']),
  regularScatterCount: 3, superScatterMinimum: 4, superDrops: 20,
  regularDoubleSlot: 3, superHasDouble: false,
});
export function bonusKind(scatterCount) {
  if (!Number.isInteger(scatterCount) || scatterCount < 0) throw new RangeError('Invalid scatter count');
  return scatterCount >= 4 ? 'super' : scatterCount === 3 ? 'regular' : null;
}
// A scatter without a printed badge contributes nothing; no badges => ×1.
export function entryMultiplier(badges) {
  const valid = badges.filter(x => x != null);
  if (valid.some(x => !Number.isSafeInteger(x) || x < 2)) throw new RangeError('Bad multiplier badge');
  const result = valid.length ? valid.reduce((a,b) => a+b,0) : 1;
  if (!Number.isSafeInteger(result)) throw new RangeError('Multiplier overflow');
  return result;
}
export function slotsFor(kind) {
  if (!['regular','super'].includes(kind)) throw new TypeError('Unknown bonus');
  const slots = RULES.friendIds.map((id,i)=>({id, base:RULES.baseMultipliers[i], friend:i}));
  if (kind === 'regular') slots.splice(3,0,{id:'double',base:null,friend:null});
  return slots;
}
export function scoreDrops(kind, entry, targets) {
  if (!Number.isSafeInteger(entry) || entry<1) throw new RangeError('Invalid entry multiplier');
  const slots=slotsFor(kind); let scale=entry,total=0; const events=[];
  if (kind === 'super' && targets.length !== 20) throw new RangeError('Super requires exactly 20 drops');
  let numericCount=0;
  for(let i=0;i<targets.length;i++) {
    const slot=slots[targets[i]];
    if (!slot) throw new RangeError('Unknown landing slot');
    if (kind==='regular' && numericCount) throw new RangeError('Regular bonus already finished');
    if(slot.id==='double') scale*=2;
    else {total+=slot.base*scale;numericCount++;}
    if(!Number.isSafeInteger(total) || !Number.isSafeInteger(scale)) throw new RangeError('Outcome overflow');
    events.push({index:i,target:targets[i],slotId:slot.id,scale,win:slot.id==='double'?0:slot.base*scale,total,isDouble:slot.id==='double'});
  }
  if(kind==='regular' && numericCount!==1) throw new RangeError('Regular must end on one numeric slot');
  return {kind,entry,total,events};
}
// Reproducible animation examples, not samples from production odds.
export function demoOutcome(kind, entry=1, withDouble=false) {
  const targets=kind==='super' ? [0,2,3,5,6,0,4,2,1,3,0,5,2,6,3,4,0,2,5,3] : withDouble ? [3,7] : [4];
  return scoreDrops(kind,entry,targets);
}
export function payoutMinorUnits(stakeMinor,totalMultiplier) {
  if(!Number.isSafeInteger(stakeMinor)||stakeMinor<0||!Number.isSafeInteger(totalMultiplier)||totalMultiplier<0) throw new RangeError('Invalid payout input');
  const value=stakeMinor*totalMultiplier;
  if(!Number.isSafeInteger(value)) throw new RangeError('Payout overflow');
  return value;
}
