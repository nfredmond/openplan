import fs from 'fs'
import path from 'path'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ExportButton } from './ExportButton'

export const metadata = {
  title: 'Pilot Readiness Evidence Center | OpenPlan Admin',
}

interface SmokeStatus {
  lane: string
  status: 'PASS' | 'FAIL' | 'PENDING' | 'UNKNOWN'
  lastRun: string
  details: string
}

function getSmokeStatus(): SmokeStatus[] {
  const rootDir = process.cwd()
  const opsDir = path.join(rootDir, '../docs/ops')
  
  if (!fs.existsSync(opsDir)) {
    return [
      { lane: 'System', status: 'UNKNOWN', lastRun: 'N/A', details: `Ops directory not found at ${opsDir}` }
    ]
  }

  const files = fs.readdirSync(opsDir)
  const lanes = [
    { lane: 'Authenticated Auth', regex: /openplan-production-authenticated-smoke\.md$/ },
    { lane: 'County Scaffold', regex: /openplan-production-county-scaffold-smoke\.md$/ },
    { lane: 'Layout Audit', regex: /openplan-production-layout-overlap-audit\.md$/ },
    { lane: 'Managed Run', regex: /openplan-production-managed-run-smoke\.md$/ },
    { lane: 'Scenario Comparison', regex: /openplan-production-scenario-comparison-smoke\.md$/ },
  ]

  const statusList: SmokeStatus[] = []

  for (const { lane, regex } of lanes) {
    const matchingFiles = files.filter(f => regex.test(f)).sort().reverse()
    if (matchingFiles.length > 0) {
      const latestFile = matchingFiles[0]
      const content = fs.readFileSync(path.join(opsDir, latestFile), 'utf8')
      const isPass = content.includes('Status: PASS') || content.includes('STATUS: PASS') || content.includes('**Status**: PASS') || content.includes('**STATUS**: PASS')
      const isFail = content.includes('Status: FAIL') || content.includes('STATUS: FAIL') || content.includes('**Status**: FAIL') || content.includes('**STATUS**: FAIL')
      
      const dateMatch = latestFile.match(/^(\d{4}-\d{2}-\d{2})/)
      const lastRun = dateMatch ? dateMatch[1] : 'Unknown'

      statusList.push({
        lane,
        status: isPass ? 'PASS' : isFail ? 'FAIL' : 'UNKNOWN',
        lastRun,
        details: latestFile
      })
    } else {
      statusList.push({
        lane,
        status: 'PENDING',
        lastRun: 'N/A',
        details: 'No test runs found'
      })
    }
  }

  return statusList
}

export default function PilotReadinessPage() {
  const statusList = getSmokeStatus()

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pilot Readiness Evidence Center</h1>
          <p className="text-muted-foreground mt-2">
            Internal dashboard for proof artifacts, smoke status, and pilot readiness packet generation.
          </p>
        </div>
        <ExportButton statusList={statusList} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {statusList.map((status, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <CardTitle className="text-lg">{status.lane}</CardTitle>
                <Badge variant={status.status === 'PASS' ? 'default' : status.status === 'FAIL' ? 'destructive' : 'secondary'}>
                  {status.status}
                </Badge>
              </div>
              <CardDescription>Last run: {status.lastRun}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground break-all">{status.details}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
