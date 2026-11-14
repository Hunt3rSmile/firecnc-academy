export function decimalAnswer(value:string):number|null {
  const normalized=value.trim().replace(',','.');
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized))return null;
  const result=Number(normalized);return Number.isFinite(result)?result:null;
}
