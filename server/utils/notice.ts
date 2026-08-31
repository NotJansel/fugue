import type { H3Event } from 'h3'
import { setResponseHeader, setResponseStatus } from 'h3'
import type { Lang } from './lang'

const escapeHtml = (input: string): string => input
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

interface NoticeLink {
  href: string
  label: string
  primary?: boolean
}

/**
 * A tiny self-contained page for the moments before the dashboard is reachable - a refused login, a
 * failed osu! link.
 *
 * It carries its own styling on purpose: the dashboard's assets sit behind the very check that sent
 * the user here, so this cannot link to them. The palette is the dashboard's, hand-written.
 */
export function renderNotice(
  event: H3Event,
  options: { status: number, lang: Lang, title: string, message: string, links: NoticeLink[] }
): string {
  setResponseStatus(event, options.status)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')

  const links = options.links.map(link => `
        <a class="${link.primary ? 'primary' : ''}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="${options.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;
      background: radial-gradient(120% 120% at 50% 0%, #2a1512 0%, #150c0b 55%, #0d0807 100%);
      color: #f4e7de;
      font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .box {
      max-width: 32rem; padding: 2rem; border: 1px solid #4a2b21; border-radius: 14px;
      background: rgba(31, 18, 15, 0.9); box-shadow: 0 24px 60px -30px rgba(0, 0, 0, 0.9);
    }
    .mark {
      display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 10px;
      background: linear-gradient(140deg, #c9a227, #a3241f); color: #1a0f0c; font-weight: 700;
      margin-bottom: 1rem;
    }
    h1 { margin: 0 0 0.5rem; font-size: 1.15rem; letter-spacing: -0.01em; }
    p { margin: 0 0 1.5rem; color: #c2a496; }
    a {
      display: inline-block; margin-right: 0.75rem; padding: 0.45rem 0.9rem; border-radius: 8px;
      border: 1px solid #4a2b21; color: #e9d3a3; text-decoration: none; font-size: 0.9rem;
    }
    a:hover { border-color: #c9a227; }
    a.primary { background: #a3241f; border-color: #a3241f; color: #fff3e8; }
    a.primary:hover { background: #b52c25; }
  </style>
</head>
<body>
  <div class="box">
    <div class="mark">&euro;</div>
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.message)}</p>${links}
  </div>
</body>
</html>`
}
