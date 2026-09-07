import type { PortalMessageKey } from "@/lib/engagement/portal-i18n/messages";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { portalMessageView } from "@/lib/engagement/portal-i18n/provenance";
export type RecoveryMessage = Extract<PortalMessageKey, `recovery.${string}`>;
/** Mark fallback recovery instructions in their actual language. */
export function PortalRecoveryCopy({ translator, message }: { translator: PortalTranslator; message: RecoveryMessage }) {
  const view = portalMessageView(translator, message);
  return <span lang={view.lang} dir={view.dir}>{view.sentence}</span>;
}

export type PriorReceipt = { submissionId: string; receivedAt: string | null };
/** A prior receipt never borrows text from the edited, unsent draft. */
export function PortalPriorReceipt({ translator, receipt, onContinue }: { translator: PortalTranslator; receipt: PriorReceipt; onContinue: () => void }) {
 return <div role="alert" className="space-y-3 p-4 break-words"><p><PortalRecoveryCopy translator={translator} message="recovery.conflict"/></p><p className="break-all">{receipt.submissionId}</p><a className="underline" download={`earlier-receipt-${receipt.submissionId}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(receipt,null,2))}`}><PortalRecoveryCopy translator={translator} message="recovery.saveReceipt"/></a><button type="button" className="block rounded border p-3 text-left" onClick={onContinue}><PortalRecoveryCopy translator={translator} message="recovery.continueEdited"/></button></div>;
}
