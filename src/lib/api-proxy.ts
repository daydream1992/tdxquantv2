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
  // 服务端直接用绝对地址访问 FastAPI；浏览器端用相对路径 + XTransformPort
  const isServer = typeof window === 'undefined'
  const url = isServer
    ? `http://127.0.0.1:${FASTAPI_PORT}${path.startsWith('/') ? path : '/' + path}`
    : `/${path.replace(/^\//, '')}?XTransformPort=${FASTAPI_PORT}`
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

/**
 * 直接转发到 FastAPI：不论 res.ok 与否，都把状态码与 body 原样回给调用方。
 * 用于 DELETE/PUT 等需要把后端的 4xx (如 403 _default 保护) 透传给前端的场景。
 *
 * 失败模式（网络异常 / 超时）返回 null，由调用方自行决定降级。
 */
export async function forwardFastAPI(
  path: string,
  options: RequestInit = {}
): Promise<Response | null> {
  const isServer = typeof window === 'undefined'
  const url = isServer
    ? `http://127.0.0.1:${FASTAPI_PORT}${path.startsWith('/') ? path : '/' + path}`
    : `/${path.replace(/^\//, '')}?XTransformPort=${FASTAPI_PORT}`
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
    return res
  } catch {
    return null
  }
}

/**
 * 把 forwardFastAPI 返回的 Response 透传为 NextResponse（保留原状态码与 JSON body）。
 * FastAPI HTTPException 返回 {"detail": "..."}，这里展开成 {"error": "..."} 以便前端 fetchAPI 解析。
 */
export async function relayJSON(res: Response): Promise<NextResponse> {
  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  // FastAPI HTTPException 返回 {"detail": "..."}，前端 fetchAPI 期望 error/message 字段
  if (body && typeof body === 'object' && 'detail' in body && !('error' in body)) {
    body = { ...(body as Record<string, unknown>), error: (body as { detail: unknown }).detail }
  }
  return NextResponse.json(body ?? {}, { status: res.status })
}
