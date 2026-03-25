/**
 * 模型 API 测试脚本
 * 测试 ResearchAgent 配置的模型是否可用
 *
 * 用法:
 *   npx tsx scripts/test-model-api.ts
 */

import { getResearchModelConfig } from '@/lib/research-config'
import { createAgentProvider } from '@/lib/providers/registry'

async function testModel() {
  console.log('测试 ResearchAgent 模型配置...\n')

  const modelConfig = getResearchModelConfig()
  console.log('模型配置:')
  console.log(`  provider: ${modelConfig.provider}`)
  console.log(`  model: ${modelConfig.model}`)
  console.log(`  baseURL: ${modelConfig.baseURL}`)
  console.log(`  apiKey: ${modelConfig.apiKey.slice(0, 10)}...`)
  console.log()

  const provider = createAgentProvider('research', modelConfig)

  console.log('发送测试请求...')
  const startTime = Date.now()

  try {
    const response = await provider.chat(
      [{ role: 'user', content: '你好，请回复"测试成功"' }],
      { maxTokens: 100, temperature: 0.3 }
    )

    const duration = Date.now() - startTime

    const textContent = response.content.find((b) => b.type === 'text')
    const text = textContent?.text ?? ''

    console.log(`\n响应时间: ${duration}ms`)
    console.log(`响应内容: ${text}`)
    console.log(`\n✅ 模型测试成功!`)

    process.exit(0)
  } catch (err) {
    const duration = Date.now() - startTime
    console.error(`\n❌ 模型测试失败 (${duration}ms)`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

testModel()
