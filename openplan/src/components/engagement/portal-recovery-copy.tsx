import type { PortalMessageKey } from "@/lib/engagement/portal-i18n/messages";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { portalMessageView } from "@/lib/engagement/portal-i18n/provenance";
export type RecoveryMessage = Extract<PortalMessageKey, `recovery.${string}`>;
/** Mark fallback recovery instructions in their actual language. */
export function PortalRecoveryCopy({ translator, message }: { translator: PortalTranslator; message: RecoveryMessage }) {
  const view = portalMessageView(translator, message);
  return <span lang={view.lang} dir={view.dir}>{view.sentence}</span>;
}
