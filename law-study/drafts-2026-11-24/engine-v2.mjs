export const BANK_SIZE=20;
export function normalizeAnswer(value) {
 const a=Array.isArray(value)?value:(Number.isInteger(value)&&value>=0?[value]:[]);
 if(a.some(x=>!Number.isInteger(x)||x<0||x>3)||new Set(a).size!==a.length)throw new Error('Invalid option');
 return [...a].sort((a,b)=>a-b);
}
export function gradeQuestion(question,answer) {
 const expected=normalizeAnswer(question.answer),given=normalizeAnswer(answer);
 if(!expected.length||question.type==='single'&&expected.length!==1||question.type==='multiple'&&expected.length<2)throw new Error('Invalid answer key');
 return expected.length===given.length&&expected.every((x,i)=>x===given[i]);
}
export function gradePaper(paper,answers,lookup) {
 if(!paper||!Array.isArray(paper.questions)||paper.questions.length!==BANK_SIZE||new Set(paper.questions).size!==BANK_SIZE)throw new Error('Invalid paper');
 if(!Array.isArray(answers)||answers.length!==BANK_SIZE)throw new Error('Invalid answers');
 let correct=0;paper.questions.forEach((id,i)=>{const q=lookup.get(id);if(!q)throw new Error('Missing question '+id);if(gradeQuestion(q,answers[i]))correct++});
 return {correct,total:BANK_SIZE,score:Math.round(100*correct/BANK_SIZE)};
}
export function validateBank(bank) {
 const issues=[],lookup=new Map(),papers=new Set();
 for(const q of bank.questions||[]){
  if(lookup.has(q.id))issues.push('duplicate question '+q.id);
  lookup.set(q.id,q);
  if(!q.id||!q.prompt||!Array.isArray(q.options)||q.options.length!==4||new Set(q.options).size!==4)issues.push('invalid question '+q.id);
  if(!Array.isArray(q.optionAnalysis)||q.optionAnalysis.length!==4||q.optionAnalysis.some(a=>!a))issues.push('missing analysis '+q.id);
  if(!q.basis?.length||q.basis.some(b=>!b.url||!b.article))issues.push('missing legal basis '+q.id);
  try{gradeQuestion(q,[])}catch(e){issues.push('invalid key '+q.id)}
 }
 for(const p of bank.papers||[]){
  if(papers.has(p.id))issues.push('duplicate paper '+p.id);papers.add(p.id);
  try{gradePaper(p,Array.from({length:BANK_SIZE},()=>[]),lookup)}catch(e){issues.push('paper '+p.id+': '+e.message)}
 }
 return issues;
}