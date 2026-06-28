import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const ALLOWED = new Set([
  'MONITOR_ENGINE_PLAN.md',
  'MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md',
])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  if (!ALLOWED.has(filename)) {
    return NextResponse.json(
      { error: '不支持的文件，仅支持: ' + Array.from(ALLOWED).join(', ') },
      { status: 404 }
    )
  }

  const filePath = path.join(process.cwd(), 'docs', filename)
  try {
    const content = await readFile(filePath, 'utf-8')
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: `文件不存在: ${filename}` }, { status: 404 })
  }
}
