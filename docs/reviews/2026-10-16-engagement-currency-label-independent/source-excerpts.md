# Exact source excerpts

Subject: `2b39558916f9748b5bfcfb65eab4cacd4518aaa8`. Lines refer to its blobs.

## openplan/src/lib/invoicing/invoice-currency.ts

```text
1: import { formatMoney, isSupportedCurrency } from "@/lib/money/format";
2: import { moneyCents } from "@/lib/money/optional-amount";
3:
4: export const ENGAGEMENT_CURRENCY_DISCLOSURE = "Aggregate currency, legacy ceiling currency and currency agreement across invoices are unassessed. This is a numerical comparison only; agreement terms are unassessed.";
5:
6: /** Legacy engagement context has no assessed currency, regardless of the current invoice. */
7: export function formatEngagementMoney(amount: number | string | null | undefined): string {
8:   return formatInvoiceMoney(amount, null);
9: }
10:
11: /** Invoice previews and retained documents keep the stated currency and exact cents. */
12: export function formatInvoiceMoney(amount: number | string | null | undefined, currencyCode: string | null | undefined): string {
13:   if (amount == null) return "Not recorded";
14:   let cents: bigint;
15:   try {
16:     cents = moneyCents(amount);
17:   } catch {
18:     return "Amount unavailable";
19:   }
20:   const code = currencyCode?.trim();
21:   if (code && isSupportedCurrency(code)) {
22:     return formatMoney(amount, { precision: "cents", currency: code });
23:   }
24:   // Unassessed currency keeps its literal label. No number conversion may
25:   // discard aggregate cents on this fallback path.
26:   const magnitude = cents < BigInt(0) ? -cents : cents;
27:   const text = `${cents < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`;
28:   return `${text} ${code || "(currency unassessed)"}`;
29: }
```

## openplan/src/lib/invoicing/receivables.ts

```text
103:   outstandingAmount: number;
104:   paidAmount: number;
105:   draftAmount: number;
106: };
107:
108: export type EngagementBilledSummary = {
109:   /** Gross sent/paid subtotals before retention; null means unavailable. */
110:   billedToDate: ExactMoneyAmount | null;
111:   /** Gross draft subtotals before retention; null means unavailable. */
112:   draftedUnbilled: ExactMoneyAmount | null;
113:   notToExceed: ExactMoneyAmount | null;
114:   /** A negative result preserves an overrun. Null means absent or unavailable. */
115:   remaining: ExactMoneyAmount | null;
116:   isOverNte: boolean | null;
117:   /** Missing ceilings remain unrecorded; invalid ceilings and unreadable buckets are explicit. */
118:   unavailable?: Partial<Record<"billedToDate" | "draftedUnbilled" | "notToExceed", "missing" | "invalid">>;
119: };
120:
121: export type EngagementNteWarning = {
122:   basis: "legacy_terms_unassessed";
123:   billedToDate: ExactMoneyAmount;
124:   projectedBilledToDate: ExactMoneyAmount;
125:   notToExceed: ExactMoneyAmount;
126:   overBy: ExactMoneyAmount;
127: };
371: export function buildEngagementBilledSummary(
372:   engagement: InvoicingEngagementLike,
373:   invoices: ClientInvoiceRecordLike[] | null | undefined
374: ): EngagementBilledSummary {
375:   const engagementId =
376:     typeof engagement.id === "string" && engagement.id.length > 0 ? engagement.id : null;
377:   const scoped = (invoices ?? []).filter(
378:     (invoice) => engagementId !== null && invoice.engagement_id === engagementId
379:   );
380:
381:   const billedAmounts: Array<number | string | null | undefined> = [];
382:   const draftAmounts: Array<number | string | null | undefined> = [];
383:   for (const invoice of scoped) {
384:     const status = typeof invoice.status === "string" ? invoice.status : "draft";
385:     if (status === "sent" || status === "paid") {
386:       billedAmounts.push(invoice.subtotal_amount);
387:     } else if (status === "draft") {
388:       draftAmounts.push(invoice.subtotal_amount);
389:     }
390:   }
391:
392:   const unavailable: NonNullable<EngagementBilledSummary["unavailable"]> = {};
393:   // Each bucket stands on its own. An unreadable row cannot become zero or
394:   // erase another bucket that can still be calculated from its supplied rows.
395:   function bucketAmount(values: typeof billedAmounts, bucket: "billedToDate" | "draftedUnbilled"): ExactMoneyAmount | null {
396:     if (values.some((value) => value == null)) {
397:       unavailable[bucket] = "missing";
398:       return null;
399:     }
400:     try {
401:       return sumMoney(values);
402:     } catch {
403:       unavailable[bucket] = "invalid";
404:       return null;
405:     }
406:   }
407:   const billedToDate = bucketAmount(billedAmounts, "billedToDate");
408:   const draftedUnbilled = bucketAmount(draftAmounts, "draftedUnbilled");
409:   let notToExceed: ExactMoneyAmount | null = null;
410:   try {
411:     notToExceed = parseOptionalMoney(engagement.not_to_exceed_amount);
412:   } catch {
413:     unavailable.notToExceed = "invalid";
414:   }
415:   return {
416:     billedToDate,
417:     draftedUnbilled,
418:     notToExceed,
419:     remaining: notToExceed !== null && billedToDate !== null ? subtractMoney(notToExceed, billedToDate) : null,
420:     isOverNte: billedToDate === null || unavailable.notToExceed ? null : notToExceed !== null && compareMoney(billedToDate, notToExceed) > 0,
421:     ...(Object.keys(unavailable).length ? { unavailable } : {}),
422:   };
423: }
```

## openplan/src/app/api/invoicing/client-invoices/route.ts

```text
205:
206:     if (parsed.data.engagementId) {
207:       const { data: engagementRow, error: engagementError } = await supabase
208:         .from("invoicing_engagements")
209:         .select("id, workspace_id, client_id, project_id, not_to_exceed_amount")
210:         .eq("id", parsed.data.engagementId)
211:         .single();
212:
213:       if (engagementError || !engagementRow || engagementRow.workspace_id !== parsed.data.workspaceId) {
388:
389:     // Billed position BEFORE this invoice, for the not-to-exceed warning. Read
390:     // ahead of the insert so the new invoice cannot count against itself.
391:     let priorBilledToDate: ExactMoneyAmount | null = null;
392:     let notToExceed: ExactMoneyAmount | null = null;
393:
394:     if (engagement) {
395:       const { data: engagementInvoices, error: engagementInvoicesError } = await supabase
396:         .from("client_invoices")
397:         .select("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount")
398:         .eq("engagement_id", engagement.id);
399:
400:       if (!engagementInvoicesError) {
401:         const summary = buildEngagementBilledSummary(
402:           engagement,
403:           (engagementInvoices ?? []) as Parameters<typeof buildEngagementBilledSummary>[1]
404:         );
405:         priorBilledToDate = summary.billedToDate;
406:         notToExceed = summary.notToExceed;
407:         if (summary.unavailable) {
408:           audit.warn("nte_position_unavailable", {
409:             workspaceId: parsed.data.workspaceId,
410:             engagementId: engagement.id,
411:             unavailable: summary.unavailable,
412:           });
413:         }
414:       } else {
415:         // The warning is best-effort; a failed read must not block the create,
416:         // but it is audited so a silent NTE blind spot cannot form.
417:         audit.warn("nte_position_read_failed", {
418:           workspaceId: parsed.data.workspaceId,
419:           engagementId: engagement.id,
420:           message: engagementInvoicesError.message,
421:         });
435:       .from("client_invoices")
436:       .insert({
437:         workspace_id: parsed.data.workspaceId,
438:         client_id: parsed.data.clientId,
439:         engagement_id: engagement?.id ?? null,
440:         project_id: effectiveProjectId,
441:         invoice_number: parsed.data.invoiceNumber,
442:         currency_code: parsed.data.currencyCode ?? null,
443:         status: "draft",
444:         invoice_date: parsed.data.invoiceDate?.trim() || null,
445:         period_start: parsed.data.periodStart?.trim() || null,
573:     // engagement's business context, and the planner composing the invoice is
574:     // the one who has to negotiate it — hiding the invoice would not.
575:     let nteWarning: EngagementNteWarning | undefined;
576:     if (notToExceed !== null && priorBilledToDate !== null) {
577:       try {
578:         const projected = sumMoney([priorBilledToDate, totals.subtotalAmount]);
579:         if (compareMoney(projected, notToExceed) > 0) {
580:           nteWarning = {
581:             basis: "legacy_terms_unassessed",
582:             billedToDate: priorBilledToDate,
583:             projectedBilledToDate: projected,
584:             notToExceed,
585:             overBy: subtractMoney(projected, notToExceed),
586:           };
587:         }
588:       } catch {
589:         audit.warn("nte_projection_unavailable", {
590:           workspaceId: parsed.data.workspaceId,
591:           engagementId: engagement?.id ?? null,
592:           reason: "Invalid money amount in projected gross billing",
593:         });
594:       }
595:     }
596:
597:     audit.info("client_invoice_created", {
598:       workspaceId: parsed.data.workspaceId,
599:       invoiceId: invoiceRow.id,
600:       clientId: parsed.data.clientId,
601:       engagementId: engagement?.id ?? null,
602:       lineItemCount: insertedLines.length,
603:       nteOverBy: nteWarning?.overBy ?? null,
604:       userId: user.id,
605:       durationMs: Date.now() - startedAt,
606:     });
607:
608:     return NextResponse.json(
609:       { invoice, lineItems: lineRows, ...(nteWarning ? { nteWarning } : {}) },
610:       { status: 201 }
611:     );
```

## openplan/src/components/invoicing/client-invoice-composer.tsx

```text
369:         error?: string;
370:         details?: string;
371:         nteWarning?: EngagementNteWarning;
372:       };
373:       if (!response.ok) {
374:         throw new Error(payload.details || payload.error || "Failed to save client invoice");
375:       }
376:
377:       if (payload.nteWarning) {
378:         setNteNotice(
379:           `This invoice takes the engagement to ${formatEngagementMoney(payload.nteWarning.projectedBilledToDate)} projected gross billing against its ${formatEngagementMoney(payload.nteWarning.notToExceed)} legacy not-to-exceed, ${formatEngagementMoney(payload.nteWarning.overBy)} over. ${ENGAGEMENT_CURRENCY_DISCLOSURE} Recorded as a warning; nothing was blocked.`
380:         );
381:       }
382:
383:       setInvoiceNumber("");
384:       setInvoiceDate("");
754:             Live from the line items and retention — the server recomputes the same math on save.
755:           </p>
756:           <dl className="mt-4 space-y-3 text-sm text-muted-foreground">
757:             <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
758:               <dt>Subtotal</dt>
759:               <dd className="font-semibold text-foreground">{formatInvoiceMoney(totals.subtotalAmount, currencyCode)}</dd>
760:             </div>
761:             <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
762:               <dt>Retention ({totals.retentionPercent.toFixed(2)}%)</dt>
763:               <dd className="font-semibold text-foreground">{formatInvoiceMoney(totals.retentionAmount, currencyCode)}</dd>
764:             </div>
765:             <div className="space-y-1 pt-1">
766:               <dt className="text-label font-semibold text-muted-foreground">Invoice total</dt>
767:               <dd className="text-2xl font-semibold tracking-tight text-foreground">{formatInvoiceMoney(totals.totalAmount, currencyCode)}</dd>
768:             </div>
769:           </dl>
770:           {selectedEngagement?.notToExceedAmount != null ? (
771:             <p className="mt-5 border-l-2 border-[color:var(--pine)] bg-[color:var(--pine)]/6 px-3 py-3 text-sm text-foreground">
772:               {selectedEngagement.title} carries a {formatInvoiceMoney(selectedEngagement.notToExceedAmount, null)} not-to-exceed.
773:               Billing past it records a warning on save — it never blocks.
774:             </p>
775:           ) : null}
776:         </aside>
```

## openplan/src/lib/invoicing/invoice-pdf.ts

```text
139:   const retentionPercent = parseCurrencyAmount(data.invoice.retention_percent);
140:
141:   const periodLine =
142:     data.invoice.period_start || data.invoice.period_end
143:       ? `${data.invoice.period_start ?? "…"} – ${data.invoice.period_end ?? "…"}`
144:       : null;
145:
146:   const lineRowsMarkup = data.lineItems
147:     .map((line) => {
148:       const quantity = formatQuantity(line.quantity);
149:       const unitAmount =
150:         line.unit_amount === null || line.unit_amount === undefined || line.unit_amount === ""
151:           ? ""
152:           : formatAmount(line.unit_amount, currency);
153:       const unitLabel = line.unit_label?.trim() ? ` / ${esc(line.unit_label.trim())}` : "";
154:       return `<tr>
155:         <td>${esc(line.description ?? "")}</td>
156:         <td class="num">${quantity}</td>
157:         <td class="num">${unitAmount}${unitAmount ? unitLabel : ""}</td>
170:
171:   let engagementContext = "";
172:   if (data.engagement) {
173:     const title = data.engagement.title?.trim() || "Engagement";
174:     const reference = data.engagement.reference_code?.trim();
175:     const referencePart = reference ? ` (Ref ${esc(reference)})` : "";
176:
177:     const nte = data.engagement.not_to_exceed_amount;
178:     const billed = data.engagementBilled;
179:     let ntePart = "";
180:     if (billed?.unavailable?.notToExceed) {
181:       ntePart = "<p>Legacy ceiling calculation unavailable (invalid amount); agreement terms unassessed.</p>";
182:     } else if (nte !== null && nte !== undefined) {
183:       ntePart = `<p>Not-to-exceed ${esc(formatEngagementMoney(billed?.notToExceed ?? nte))}; agreement terms unassessed.</p>`;
184:     }
185:     if (billed) {
186:       const billedPart = billed.billedToDate === null
187:         ? `Gross billed calculation unavailable (${esc(billed.unavailable?.billedToDate ?? "unavailable")} amount)`
188:         : `billed to date ${esc(formatEngagementMoney(billed.billedToDate))} gross before retention`;
189:       const remainingPart = billed.remaining === null
190:         ? ", remaining unavailable"
191:         : `, remaining ${esc(formatEngagementMoney(billed.remaining))}`;
192:       const draftPart = billed.draftedUnbilled === null
193:         ? `; draft calculation unavailable (${esc(billed.unavailable?.draftedUnbilled ?? "unavailable")} amount)`
194:         : `; gross draft ${esc(formatEngagementMoney(billed.draftedUnbilled))}`;
195:       ntePart += `<p>${billedPart}${remainingPart}${draftPart}.</p>`;
196:     }
197:
198:     engagementContext = `<div class="engagement-context">
199:       <p>Engagement: ${esc(title)}${referencePart}</p>
200:       ${ntePart}
201:       <p>${esc(ENGAGEMENT_CURRENCY_DISCLOSURE)}</p>
202:     </div>`;
203:   }
```

## openplan/src/lib/project-evidence-bundles/bytes.ts

```text
239:   if (invoice.engagement_id) {
240:     const engagementRead = await caller
241:       .from("invoicing_engagements")
242:       .select("id, title, reference_code, not_to_exceed_amount")
243:       .eq("id", invoice.engagement_id)
244:       .single();
245:     if (engagementRead.error || !engagementRead.data) {
246:       throw new ProjectEvidenceBundleError("missing_evidence", "The invoice engagement could not be read.");
247:     }
248:     engagement = engagementRead.data as ClientInvoicePdfEngagement;
249:     const nte = (engagementRead.data as { not_to_exceed_amount?: unknown }).not_to_exceed_amount;
250:     if (nte !== null && nte !== undefined) {
251:       const invoicesRead = await caller
252:         .from("client_invoices")
253:         .select("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount")
254:         .eq("engagement_id", invoice.engagement_id);
255:       if (!invoicesRead.error) {
256:         engagementBilled = buildEngagementBilledSummary(
257:           engagementRead.data as Parameters<typeof buildEngagementBilledSummary>[0],
258:           (invoicesRead.data ?? []) as Parameters<typeof buildEngagementBilledSummary>[1]
259:         );
260:       }
261:     }
262:   }
263:
264:   const html = buildClientInvoiceHtml({
265:     workspace: workspaceResult.data as { name: string | null },
```
