'use client'

import { Button } from '@/components/ui/button'
import { buildPilotReadinessPacket } from '@/lib/operations/pilot-readiness-packet'

interface ExportButtonProps {
  statusList: {
    lane: string
    status: string
    lastRun: string
    details: string
  }[]
}

export { buildPilotReadinessPacket }

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
