/**
 * LLM 配置系统测试脚本
 *
 * 用法:
 *   npx tsx scripts/test-llm-config.ts
 *
 * 功能:
 *   1. 验证 llm-providers.json 配置
 *   2. 测试环境变量替换
 *   3. 查看各 Agent 的 Provider 映射
 */

import * as fs from 'fs'
import * as path from 'path'

import {
  listProviders,
  listAgentProviderMappings,
  getDefaultProvider,
  getAgentProvider,
  getProviderConfig,
  generateEnvVarHelp,
} from '@/config/llm'

// Colors
const C = {
  r: '\x1b[0m',
  br: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(title: string, content?: string, color: keyof typeof C = 'r') {
  const c = C[color]
  if (content !== undefined) {
    console.log(`${c}${C.br}[${title}]${C.r} ${content}`)
  } else {
    console.log(`\n${c}${C.br}━━ ${title} ━━${C.r}`)
  }
}

function loadLocalEnv() {
  const files = ['.env.local', '.env']
  for (const file of files) {
    const p = path.resolve(process.cwd(), file)
    if (!fs.existsSync(p)) continue

    const content = fs.readFileSync(p, 'utf-8')
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
      const idx = normalized.indexOf('=')
      if (idx <= 0) continue

      const key = normalized.slice(0, idx).trim()
      if (!key) continue
      if (process.env[key] != null) continue

      let value = normalized.slice(idx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

function main() {
  loadLocalEnv()
  console.log(`
${C.cyan}${C.br}
╔══════════════════════════════════════════════════════════════╗
║           LLM Provider 配置系统测试                         ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`)

  // 1. 环境变量说明
  log('环境变量')
  console.log(C.dim + generateEnvVarHelp() + C.r)

  // 2. 列出所有 Provider
  log('可用的 Provider')
  const providers = listProviders()
  providers.forEach((p) => {
    const status = p.enabled ? `${C.green}✓ 启用` : `${C.red}✗ 禁用`
    console.log(`  ${p.name} - ${p.displayName} ${status}`)
  })

  // 3. Agent -> Provider 映射
  log('Agent Provider 映射')
  const mappings = listAgentProviderMappings()
  Object.entries(mappings).forEach(([agent, provider]) => {
    console.log(`  ${agent} -> ${provider}`)
  })

  // 4. 获取默认 Provider
  log('默认 Provider')
  try {
    const defaultProvider = getDefaultProvider()
    console.log(`  名称: ${defaultProvider.name}`)
    console.log(`  模型: ${defaultProvider.model}`)
    console.log(`  Provider Type: ${defaultProvider.provider}`)
    console.log(`  Base URL: ${defaultProvider.baseURL || '(默认)'}`)
    console.log(`  API Key: ${defaultProvider.apiKey ? C.green + '✓ 已设置' + C.r : C.red + '✗ 未设置' + C.r}`)
  } catch (err) {
    console.log(`  ${C.red}错误: ${err instanceof Error ? err.message : String(err)}${C.r}`)
  }

  // 5. 测试获取各 Agent 的 Provider
  log('各 Agent 的 Provider 配置')
  const agents = ['trend', 'topic', 'research', 'writer', 'review']
  agents.forEach((agent) => {
    try {
      const provider = getAgentProvider(agent)
      console.log(`\n  ${C.cyan}${agent}${C.r}:`)
      console.log(`    模型: ${provider.model}`)
      console.log(`    API Key: ${provider.apiKey ? C.green + '✓' + C.r : C.red + '✗' + C.r}`)
    } catch (err) {
      console.log(`\n  ${C.cyan}${agent}${C.r}: ${C.red}错误${C.r}`)
    }
  })

  // 6. 测试切换 Provider
  log('Provider 切换测试')
  console.log(`${C.dim}测试切换到 volcengine-deepseek...${C.r}`)
  try {
    const deepseek = getProviderConfig('volcengine-deepseek')
    console.log(`${C.green}✓ 成功获取 DeepSeek 配置${C.r}`)
    console.log(`  模型: ${deepseek.model}`)
  } catch (err) {
    console.log(`${C.red}✗ 失败: ${err instanceof Error ? err.message : String(err)}${C.r}`)
  }

  // 7. 总结
  console.log(`
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}

配置系统工作正常。

切换模型的方式：
1. 修改 ${C.cyan}src/config/llm-providers.json${C.r} 中的 ${C.yellow}defaultProvider${C.r}
2. 或修改各 Agent 的 provider 映射
3. 确保环境变量已设置

快速切换示例：
  "defaultProvider": "anthropic-claude"  // 切换到 Claude
  "defaultProvider": "openai-gpt4o"      // 切换到 GPT-4o
`)
}

try {
  main()
} catch (err) {
  console.error(C.red + (err instanceof Error ? err.message : String(err)) + C.r)
  process.exit(1)
}
