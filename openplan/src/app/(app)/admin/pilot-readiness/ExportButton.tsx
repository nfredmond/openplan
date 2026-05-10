'use client'

import { Button } from '@/components/ui/button'
import { releaseProofPosture } from '@/lib/operations/release-proof-packet'

interface ExportButtonProps {
  statusList: {
    lane: string
    status: string
    lastRun: string
    details: string
  }[]
}

export function buildPilotReadinessPacket(statusList: ExportButtonProps['statusList'], generatedAt = new Date().toISOString()) {
  const lines = [
    '# Pilot Readiness Evidence Packet',
    `Generated: ${generatedAt}`,
    '',
    '## Current Smoke Status',
    ...statusList.map(s => `- **${s.lane}**: ${s.status} (Last Run: ${s.lastRun}; Source: ${s.details})`),
    '',
    '## Operator follow-up',
    '- Treat PASS lanes as citeable only when the named source document is available in `docs/ops`.',
    '- Re-run or refresh any FAIL, PENDING, or UNKNOWN lane before using this packet for pilot diligence.',
    '',
    '## Release Proof Packet Alignment',
    releaseProofPosture.summary,
    releaseProofPosture.wedge,
    '',
    '### Required caveats',
    ...releaseProofPosture.caveats.map((caveat) => `- ${caveat}`),
    '',
    '### Proof artifacts synchronized with Command Center',
    ...releaseProofPosture.proofItems.map((item) => `- **${item.label}**: ${item.headline} Source: ${item.artifact}`),
    '',
    '## About OpenPlan Readiness',
    'OpenPlan is actively tested against production infrastructure. These smoke tests reflect the latest validation runs.',
  ]

  return lines.join('\n')
}

export function ExportButton({ statusList }: ExportButtonProps) {
  const handleExport = () => {
    const blob = new Blob([buildPilotReadinessPacket(statusList)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pilot-readiness-packet-${new Date().toISOString().slice(0,10)}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return <Button onClick={handleExport}>Export Readiness Packet</Button>
}
