/**
 * 统一模型测试脚本
 * 测试所有 Agent 的模型配置是否可用
 *
 * 用法:
 *   npx tsx scripts/test-all-agents-model.ts
 */

import { getTrendModelConfig } from '@/lib/trend-config'
import { getTopicModelConfig } from '@/lib/topic-config'
import { getResearchModelConfig } from '@/lib/research-config'
import { createAgentProvider } from '@/lib/providers/registry'

async function testProvider(name: string, modelConfig: Parameters<typeof createAgentProvider>[1]) {
  console.log(`\n${'='.repeat(50)}`)
  console.log(`测试 ${name}`)
  console.log('='.repeat(50))

  console.log('模型配置:')
  console.log(`  provider: ${modelConfig.provider}`)
  console.log(`  model: ${modelConfig.model}`)
  console.log(`  baseURL: ${modelConfig.baseURL}`)
  console.log(`  apiKey: ${modelConfig.apiKey.slice(0, 10)}...`)

  const provider = createAgentProvider(name, modelConfig)

  console.log('发送测试请求...')
  const startTime = Date.now()

  try {
    const response = await provider.chat(
      [{ role: 'user', content: '请回复"测试成功"' }],
      { maxTokens: 100, temperature: 0.3 }
    )

    const duration = Date.now() - startTime

    const textContent = response.content.find((b) => b.type === 'text')
    const text = textContent?.text ?? ''

    console.log(`响应时间: ${duration}ms`)
    console.log(`响应内容: ${text}`)
    console.log(`✅ ${name} 模型测试成功!`)

    return { success: true, name, duration, text }
  } catch (err) {
    const duration = Date.now() - startTime
    console.error(`❌ ${name} 模型测试失败 (${duration}ms)`)
    console.error(err instanceof Error ? err.message : String(err))
    return { success: false, name, duration, error: err }
  }
}

async function main() {
  console.log(`
${'='.repeat(60)}
  统一模型配置测试 - Content Center
${'='.repeat(60)}
`)

  const results = []

  // Test Trend Agent model
  results.push(await testProvider('trend', getTrendModelConfig()))

  // Test Topic Agent model
  results.push(await testProvider('topic', getTopicModelConfig()))

  // Test Research Agent model
  results.push(await testProvider('research', getResearchModelConfig()))

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('测试总结')
  console.log('='.repeat(60))

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  results.forEach(r => {
    const icon = r.success ? '✅' : '❌'
    const status = r.success ? `成功 (${r.duration}ms)` : '失败'
    console.log(`  ${icon} ${r.name}: ${status}`)
  })

  console.log(`\n总计: ${successCount} 成功, ${failCount} 失败`)

  process.exit(failCount > 0 ? 1 : 0)
}

main()
