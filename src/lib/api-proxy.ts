/**
 * 通用 API 转发工具
 * - 转发到 Python FastAPI（端口 8000，通过 XTransformPort）
 * - 失败时降级返回 mock 数据
 */

import { NextResponse } from 'next/server'

const FASTAPI_PORT = '8000'
const FASTAPI_TIMEOUT_MS = 3_000

/** 尝试转发到 FastAPI；超时/不可达返回 null（由调用方降级） */
export async function tryFastAPI(
  path: string,
  options: RequestInit = {}
): Promise<Response | null> {
  const url = `/${path.replace(/^\//, '')}?XTransformPort=${FASTAPI_PORT}`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      cache: 'no-store',
    })
    clearTimeout(t)
    if (!res.ok) return null
    return res
  } catch {
    return null
  }
}

/** JSON 成功响应 */
export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

/** JSON 错误响应 */
export function err(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}
