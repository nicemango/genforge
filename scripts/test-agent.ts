import { runTrendAgent } from '@/agents/trend'

async function testTrendAgent() {
  console.log('🚀 测试 Trend Agent...')
  console.log('开始抓取 RSS 趋势...\n')

  const startTime = Date.now()

  try {
    const result = await runTrendAgent()

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log('\n✅ 测试完成!')
    console.log(`⏱️  耗时: ${duration}s`)
    console.log('\n📊 统计:')
    console.log(`   - 总源数: ${result.stats.total}`)
    console.log(`   - 成功: ${result.stats.success}`)
    console.log(`   - 失败: ${result.stats.failed}`)
    console.log(`   - 超时: ${result.stats.timedOut}`)
    console.log(`   - 获取文章数: ${result.items.length}`)

    console.log('\n📰 前 5 条趋势:')
    result.items.slice(0, 5).forEach((item, i) => {
      console.log(`\n${i + 1}. [${item.source}] ${item.title}`)
      console.log(`   链接: ${item.link}`)
      console.log(`   时间: ${item.pubDate}`)
      console.log(`   摘要: ${item.snippet.slice(0, 100)}...`)
    })

  } catch (error) {
    console.error('\n❌ 测试失败:', error)
    process.exit(1)
  }
}

testTrendAgent()
