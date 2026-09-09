import {formatMoney,isSupportedCurrency} from "@/lib/money/format";
/** Invoice previews and retained documents use the stated currency; missing legacy currency stays unassessed. */
export function formatInvoiceMoney(amount:number,currencyCode:string|null|undefined):string {
 const code=currencyCode?.trim().toUpperCase();
 if(!code)return `${amount.toFixed(2)} (currency unassessed)`;
 if(!isSupportedCurrency(code))return `${amount.toFixed(2)} ${code}`;
 return formatMoney(amount,{precision:"cents",currency:code});
}
