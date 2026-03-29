import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ImagePlanItem } from '@/lib/image-plan'
import type { WechatThemeId } from '@/lib/wechat-layout'

const execFileAsync = promisify(execFile)

interface TemplateImageResult {
  mimeType: 'image/png'
  imageBase64: string
  width: number
  height: number
}

export async function renderTemplateImage(
  item: ImagePlanItem,
  themeId: WechatThemeId = 'wechat-pro',
): Promise<TemplateImageResult> {
  const width = item.imageType === 'cover-hero' ? 1440 : 1200
  const height = item.imageType === 'cover-hero' ? 810 : 900
  const svg = buildTemplateSvg(item, themeId, width, height)

  const dir = await mkdtemp(join(tmpdir(), 'wechat-template-card-'))
  const svgPath = join(dir, `${item.slotId}.svg`)
  const pngPath = `${svgPath}.png`

  try {
    await writeFile(svgPath, svg, 'utf8')
    await execFileAsync('/usr/bin/qlmanage', ['-t', '-s', String(width), '-o', dir, svgPath])
    const png = await readFile(pngPath)
    return {
      mimeType: 'image/png',
      imageBase64: png.toString('base64'),
      width,
      height,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function buildTemplateSvg(
  item: ImagePlanItem,
  themeId: WechatThemeId,
  width: number,
  height: number,
): string {
  const palette = getPalette(themeId)
  const title = escapeXml(item.sectionTitle || item.alt || '章节')
  const caption = escapeXml(item.caption || '自动生成')
  const quoteText = clampText(item.prompt.split('｜').pop() || item.caption, 72)
  const quoteLines = wrapText(quoteText, 11).slice(0, 4)
  const quoteTspans = quoteLines
    .map((line, index) => `<tspan x="180" dy="${index === 0 ? 0 : 64}">${escapeXml(line)}</tspan>`)
    .join('')

  if (item.imageType === 'cover-hero' && item.renderMode === 'template') {
    const [, , subject = '平台规则与权限结构', action = '默认开关、授权面板、代码仓库与产品权限关系', risk = '默认设置会慢慢变成行业标准'] =
      item.prompt.split('｜')
    const chips = [subject, action, risk].map((line) => clampText(cleanBulletText(line), 14))
    const chipSvg = chips
      .map((line, index) => {
        const x = 120 + index * 212
        return `<rect x="${x}" y="118" width="184" height="42" rx="21" fill="${palette.primary}" fill-opacity="${0.08 + index * 0.04}"/><text x="${x + 24}" y="146" fill="${palette.primary}" font-size="20" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="600">${escapeXml(line)}</text>`
      })
      .join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="coverBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.background}"/>
      <stop offset="100%" stop-color="${palette.backgroundAccent}"/>
    </linearGradient>
    <linearGradient id="heroPanel" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${palette.primary}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${palette.primary}" stop-opacity="0.04"/>
    </linearGradient>
    <linearGradient id="screenGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.96"/>
      <stop offset="100%" stop-color="${palette.backgroundAccent}" stop-opacity="0.84"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#coverBg)" rx="42"/>
  <rect x="78" y="70" width="${width - 156}" height="${height - 140}" fill="#ffffff" rx="34"/>
  <circle cx="${width - 184}" cy="158" r="120" fill="${palette.primary}" opacity="0.08"/>
  <circle cx="160" cy="${height - 124}" r="86" fill="${palette.primary}" opacity="0.06"/>
  ${chipSvg}
  <rect x="120" y="210" width="${width - 240}" height="430" rx="30" fill="url(#screenGlow)" stroke="${palette.border}" stroke-width="2"/>
  <rect x="162" y="252" width="${width - 324}" height="32" rx="16" fill="${palette.primary}" fill-opacity="0.12"/>
  <rect x="162" y="306" width="220" height="18" rx="9" fill="${palette.primary}" fill-opacity="0.18"/>
  <rect x="398" y="306" width="160" height="18" rx="9" fill="${palette.primary}" fill-opacity="0.10"/>
  <rect x="162" y="356" width="404" height="204" rx="24" fill="url(#heroPanel)"/>
  <rect x="194" y="390" width="208" height="22" rx="11" fill="${palette.primary}" fill-opacity="0.18"/>
  <rect x="194" y="434" width="154" height="18" rx="9" fill="${palette.primary}" fill-opacity="0.12"/>
  <rect x="194" y="468" width="186" height="18" rx="9" fill="${palette.primary}" fill-opacity="0.10"/>
  <rect x="484" y="392" width="202" height="130" rx="18" fill="#ffffff" fill-opacity="0.82" stroke="${palette.border}" stroke-width="2"/>
  <rect x="514" y="420" width="96" height="14" rx="7" fill="${palette.primary}" fill-opacity="0.22"/>
  <rect x="514" y="450" width="138" height="14" rx="7" fill="${palette.primary}" fill-opacity="0.14"/>
  <rect x="514" y="480" width="76" height="28" rx="14" fill="${palette.primary}" fill-opacity="0.78"/>
  <rect x="744" y="250" width="418" height="368" rx="28" fill="#ffffff" fill-opacity="0.88" stroke="${palette.border}" stroke-width="2"/>
  <rect x="782" y="292" width="140" height="18" rx="9" fill="${palette.primary}" fill-opacity="0.24"/>
  <rect x="782" y="332" width="232" height="18" rx="9" fill="${palette.primary}" fill-opacity="0.12"/>
  <rect x="782" y="374" width="308" height="20" rx="10" fill="${palette.primary}" fill-opacity="0.10"/>
  <rect x="782" y="426" width="330" height="118" rx="20" fill="${palette.background}" stroke="${palette.border}" stroke-width="2"/>
  <rect x="816" y="462" width="92" height="42" rx="14" fill="${palette.primary}" fill-opacity="0.82"/>
  <rect x="934" y="468" width="138" height="14" rx="7" fill="${palette.primary}" fill-opacity="0.16"/>
  <rect x="934" y="494" width="112" height="14" rx="7" fill="${palette.primary}" fill-opacity="0.12"/>
  <rect x="120" y="${height - 102}" width="${width - 240}" height="2" fill="${palette.border}"/>
</svg>`
  }

  if (item.imageType === 'quote-card') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="quoteBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.background}"/>
      <stop offset="100%" stop-color="${palette.backgroundAccent}"/>
    </linearGradient>
    <linearGradient id="quoteGlow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${palette.primary}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="${palette.primary}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#quoteBg)" rx="40"/>
  <circle cx="${width - 140}" cy="138" r="118" fill="${palette.primary}" opacity="0.06"/>
  <circle cx="152" cy="${height - 128}" r="84" fill="${palette.primary}" opacity="0.05"/>
  <rect x="86" y="74" width="${width - 172}" height="${height - 148}" fill="#ffffff" rx="34"/>
  <rect x="104" y="92" width="${width - 208}" height="${height - 184}" fill="none" stroke="${palette.border}" stroke-width="2" rx="28"/>
  <rect x="134" y="128" width="172" height="52" fill="${palette.tagBackground}" rx="26"/>
  <text x="168" y="162" fill="${palette.primary}" font-size="24" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="700" letter-spacing="3">VIEWPOINT</text>
  <rect x="138" y="210" width="10" height="${height - 380}" fill="${palette.primary}" rx="5"/>
  <rect x="156" y="210" width="240" height="10" fill="url(#quoteGlow)" rx="5"/>
  <text x="172" y="300" fill="${palette.quoteMark}" font-size="136" font-family="Georgia, serif" font-weight="700">“</text>
  <text x="180" y="332" fill="${palette.text}" font-size="52" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="700">${quoteTspans}</text>
  <line x1="180" y1="${height - 204}" x2="${width - 180}" y2="${height - 204}" stroke="${palette.border}" stroke-width="2"/>
  <text x="180" y="${height - 148}" fill="${palette.primary}" font-size="24" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="700" letter-spacing="2">观点摘录</text>
  <text x="180" y="${height - 108}" fill="${palette.muted}" font-size="28" font-family="PingFang SC, Microsoft YaHei, sans-serif">${caption}</text>
</svg>`
  }

  if (item.imageType === 'data-card') {
    const rawData = item.prompt.split('｜').slice(3).join('｜').trim()
    const titleLines = wrapText(title, 14).slice(0, 2)
    const titleTspans = titleLines
      .map((line, index) => `<tspan x="96" dy="${index === 0 ? 0 : 68}">${escapeXml(line)}</tspan>`)
      .join('')
    const bulletSource = rawData
      ? rawData
          .split('||')
          .map((part) => part.trim())
          .filter(Boolean)
      : [title]
    const bullets = bulletSource.slice(0, 3).map((bullet) => clampText(cleanBulletText(bullet), 24))
    const titleBlockHeight = Math.max(1, titleLines.length) * 68
    const bulletStartY = 220 + titleBlockHeight + 42
    const bulletSvg = bullets
      .map((bullet, index) => {
        const bulletLines = wrapText(bullet, 13).slice(0, 2)
        const lineHeight = 48
        const y = bulletStartY + index * 126
        const textY = y + 12
        const textSvg = bulletLines
          .map(
            (line, lineIndex) =>
              `<tspan x="158" dy="${lineIndex === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
          )
          .join('')
        return `<circle cx="126" cy="${y}" r="10" fill="${palette.primary}"/><text x="158" y="${textY}" fill="${palette.text}" font-size="36" font-family="PingFang SC, Microsoft YaHei, sans-serif">${textSvg}</text>`
      })
      .join('')
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff" rx="36"/>
  <rect x="0" y="0" width="${width}" height="180" fill="${palette.background}"/>
  <text x="96" y="248" fill="${palette.text}" font-size="52" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="700">${titleTspans}</text>
  ${bulletSvg}
</svg>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${palette.background}" rx="36"/>
  <rect x="88" y="88" width="${width - 176}" height="${height - 176}" fill="#ffffff" rx="28"/>
  <rect x="88" y="88" width="${width - 176}" height="18" fill="${palette.primary}" rx="9"/>
  <text x="120" y="218" fill="${palette.primary}" font-size="32" font-family="PingFang SC, Microsoft YaHei, sans-serif" letter-spacing="3">SECTION CARD</text>
  <text x="120" y="346" fill="${palette.text}" font-size="62" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="700">${title}</text>
  <text x="120" y="456" fill="${palette.muted}" font-size="34" font-family="PingFang SC, Microsoft YaHei, sans-serif">${caption}</text>
  <line x1="120" y1="${height - 132}" x2="${width - 120}" y2="${height - 132}" stroke="${palette.primary}" stroke-opacity="0.22" stroke-width="4"/>
</svg>`
}

function wrapText(value: string, size: number): string[] {
  const text = value.trim()
  if (!text) return ['内容卡片']
  const lines: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    lines.push(text.slice(cursor, cursor + size).trim())
    cursor += size
  }
  return lines.filter(Boolean)
}

function clampText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function cleanBulletText(value: string): string {
  return value
    .replace(/^[:：,，.。;；、]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPalette(themeId: WechatThemeId): {
  background: string
  backgroundAccent: string
  primary: string
  text: string
  muted: string
  border: string
  tagBackground: string
  quoteMark: string
} {
  if (themeId === 'brand-magazine') {
    return {
      background: '#f7f3ff',
      backgroundAccent: '#efe8ff',
      primary: '#8f86d8',
      text: '#4b4f5c',
      muted: '#8e93a3',
      border: '#e6ddff',
      tagBackground: '#f1ecff',
      quoteMark: '#d8d1ff',
    }
  }
  if (themeId === 'brand-warm') {
    return {
      background: '#eef7f0',
      backgroundAccent: '#e3f0e7',
      primary: '#2f7a4e',
      text: '#264132',
      muted: '#6f7f74',
      border: '#d7eadc',
      tagBackground: '#e6f3e9',
      quoteMark: '#d8eadf',
    }
  }
  return {
    background: '#eef8f2',
    backgroundAccent: '#e5f3ea',
    primary: '#177e50',
    text: '#1c252d',
    muted: '#7d8792',
    border: '#d8e9de',
    tagBackground: '#e8f5ed',
    quoteMark: '#d6ebe0',
  }
}
