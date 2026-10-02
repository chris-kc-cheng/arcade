const RANKS='3456789TJQKA2', SUITS='DCHS';
const cardValue=c=>RANKS.indexOf(c[0])*4+SUITS.indexOf(c[1]);
function classify(cards){
 if(![1,2,3,5].includes(cards.length))return null; const sorted=[...cards].sort((a,b)=>cardValue(a)-cardValue(b)); const groups=new Map();
 for(const c of sorted)groups.set(c[0],(groups.get(c[0])||0)+1); const counts=[...groups.values()].sort((a,b)=>b-a), high=Math.max(...sorted.map(cardValue));
 if(cards.length<5)return groups.size===1?{size:cards.length,kind:['single','pair','triple'][cards.length-1],strength:high}:null;
 const ranks=[...groups.keys()].map(r=>RANKS.indexOf(r)).sort((a,b)=>a-b), straight=ranks.length===5&&ranks.every((r,i)=>!i||r===ranks[i-1]+1), flush=new Set(cards.map(c=>c[1])).size===1;
 let cat=straight&&flush?4:counts[0]===4?3:counts[0]===3&&counts[1]===2?2:flush?1:straight?0:-1;if(cat<0)return null;
 let tie=high;if(cat===2)tie=RANKS.indexOf([...groups].find(([,n])=>n===3)[0]);if(cat===3)tie=RANKS.indexOf([...groups].find(([,n])=>n===4)[0]);
 return{size:5,kind:['straight','flush','full house','four of a kind','straight flush'][cat],strength:cat*100+tie};
}
function beats(cards,previous){const a=classify(cards),b=previous?.cards&&classify(previous.cards);return !!a&&(!b||(a.size===b.size&&(a.size===5?a.strength>b.strength:a.kind===b.kind&&a.strength>b.strength)));}
const deck=()=>[...RANKS].flatMap(r=>[...SUITS].map(s=>r+s));
module.exports={RANKS,SUITS,cardValue,classify,beats,deck};
