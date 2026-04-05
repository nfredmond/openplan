'use client'

import { Button } from '@/components/ui/button'

interface ExportButtonProps {
  statusList: {
    lane: string
    status: string
    lastRun: string
    details: string
  }[]
}

export function ExportButton({ statusList }: ExportButtonProps) {
  const handleExport = () => {
    const lines = [
      '# Pilot Readiness Evidence Packet',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Current Smoke Status',
      ...statusList.map(s => `- **${s.lane}**: ${s.status} (Last Run: ${s.lastRun})`),
      '',
      '## About OpenPlan Readiness',
      'OpenPlan is actively tested against production infrastructure. These smoke tests reflect the latest validation runs.',
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
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
