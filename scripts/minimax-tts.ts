/**
 * MiniMax Text to Speech HD 语音合成脚本
 * 使用 MiniMax speech-01 模型将文本转换为语音
 *
 * 用法:
 *   npx tsx scripts/minimax-tts.ts --text "你好，这是测试语音"
 *   npx tsx scripts/minimax-tts.ts --file ./article.txt --output ./audio.mp3
 *   npx tsx scripts/minimax-tts.ts --model speech-01-hd --voice "male-qnq" --speed 1.0 --text "Hello"
 */

import { parseArgs } from 'util'

interface TTSRequest {
  model: string
  text: string
  voiceSetting?: {
    voiceId: string
    speed?: number
    volume?: number
    pitch?: number
  }
  audioSetting?: {
    sampleRate?: number
    bitrate?: number
    format?: string
  }
}

interface TTSResponse {
  audioFile?: string
  audioBase64?: string
  traceId?: string
}

const SUPPORTED_VOICES = [
  // 女声
  'female-shawn',
  'female-yichan',
  'female-qnq',
  'female-tianmei',
  'male-qnq',
  'male-qnq2',
  'male-boyang',
  'male-qingfeng',
  'male-yunyang',
  // 短视频
  'voiceover_p一杯',
  'voiceover_xiaoanna',
  'voiceover_daxiang',
  'voiceover_qinghua',
  'voiceover_zhiling',
  'voiceover_tingting',
  'voiceover_yaoyao',
  'voiceover_xiaowanzi',
  // 直播
  'live_xiaoanna',
  'live_qiaxia',
  'live_dashu',
]

const DEFAULT_VOICE = 'female-yichan'
const DEFAULT_MODEL = 'speech-01-hd'
const DEFAULT_SPEED = 1.0
const BASE_URL = 'https://api.minimaxi.com/v1/t2a_v2'

async function generateSpeech(
  apiKey: string,
  request: TTSRequest,
): Promise<TTSResponse> {
  const { model, text, voiceSetting, audioSetting } = request

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      text,
      voice_setting: voiceSetting ?? {
        voice_id: DEFAULT_VOICE,
        speed: String(DEFAULT_SPEED),
      },
      audio_setting: audioSetting ?? {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
      },
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`MiniMax TTS API error: HTTP ${response.status} — ${errorBody}`)
  }

  // TTS API 返回的是二进制音频数据或 JSON
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const data = await response.json() as { audio_file?: string; trace_id?: string }
    return { audioFile: data.audio_file, traceId: data.trace_id }
  }

  // 返回二进制音频数据
  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return { audioBase64: base64 }
}

function listVoices(): void {
  console.log('\n支持的音色列表:\n')
  console.log('【女声】')
  console.log('  female-shawn    - 沉稳女声')
  console.log('  female-yichan   - 知性女声')
  console.log('  female-qnq      - 温柔女声')
  console.log('  female-tianmei  - 甜美女声')
  console.log()
  console.log('【男声】')
  console.log('  male-qnq       - 温柔男声')
  console.log('  male-qnq2      - 活力男声')
  console.log('  male-boyang    - 阳光男声')
  console.log('  male-qingfeng  - 成熟男声')
  console.log('  male-yunyang   - 沉稳男声')
  console.log()
  console.log('【短视频】')
  console.log('  voiceover_xiaoanna  - 小anna')
  console.log('  voiceover_daxiang   - 大雄')
  console.log('  voiceover_qinghua   - 青华')
  console.log('  voiceover_zhiling  - 志玲')
  console.log('  voiceover_tingting  - 婷婷')
  console.log('  voiceover_yaoyao   - 瑶瑶')
  console.log('  voiceover_xiaowanzi - 小丸子')
  console.log()
  console.log('【直播】')
  console.log('  live_xiaoanna  - 小anna')
  console.log('  live_qiaxia    - 怯夏')
  console.log('  live_dashu     - 大叔')
  console.log()
}

async function main() {
  const args = parseArgs({
    options: {
      text: { type: 'string', short: 't' },
      file: { type: 'string', short: 'f' },
      output: { type: 'string', short: 'o', default: './output.mp3' },
      voice: { type: 'string', short: 'v', default: DEFAULT_VOICE },
      speed: { type: 'string', short: 's', default: String(DEFAULT_SPEED) },
      model: { type: 'string', short: 'm', default: DEFAULT_MODEL },
      'list-voices': { type: 'boolean', short: 'l' },
      'api-key': { type: 'string' },
    },
  })

  // 显示音色列表
  if (args.values['list-voices']) {
    listVoices()
    process.exit(0)
  }

  // 获取文本内容
  let text = args.values.text ?? ''

  if (args.values.file) {
    const fs = await import('fs/promises')
    text = await fs.readFile(args.values.file, 'utf-8')
    console.log(`📖 从文件读取文本: ${args.values.file}`)
    console.log(`   字符数: ${text.length}`)
  }

  if (!text.trim()) {
    console.error('❌ 请提供 --text 或 --file 参数')
    console.error('   npx tsx scripts/minimax-tts.ts --text "你好"')
    console.error('   npx tsx scripts/minimax-tts.ts --list-voices  # 查看所有音色')
    process.exit(1)
  }

  const apiKey = args.values['api-key'] as string | undefined ?? process.env.MINIMAX_API_KEY
  if (!apiKey) {
    console.error('❌ 未设置 MINIMAX_API_KEY')
    console.error('   请在 .env 文件中设置或使用 --api-key 参数')
    process.exit(1)
  }

  const voice = args.values.voice as string
  const speed = args.values.speed as string
  const speedNum = parseFloat(speed)
  const model = args.values.model as string
  const outputPath = args.values.output as string

  console.log(`\n🎙️  MiniMax TTS 生成中...`)
  console.log(`   模型: ${model}`)
  console.log(`   音色: ${voice}`)
  console.log(`   语速: ${speed}x`)
  console.log(`   文本长度: ${text.length} 字符`)
  console.log()

  const startTime = Date.now()

  try {
    const result = await generateSpeech(apiKey, {
      model,
      text,
      voiceSetting: {
        voiceId: voice,
        speed: speedNum,
      },
    })

    const duration = Date.now() - startTime

    if (result.audioBase64) {
      // 保存 base64 音频到文件
      const fs = await import('fs/promises')
      const buffer = Buffer.from(result.audioBase64, 'base64')
      await fs.writeFile(outputPath, buffer)
      console.log(`\n✅ 语音生成成功! (${duration}ms)`)
      console.log(`   输出文件: ${outputPath}`)
      console.log(`   文件大小: ${(buffer.length / 1024).toFixed(2)} KB`)
    } else if (result.audioFile) {
      console.log(`\n✅ 语音生成成功! (${duration}ms)`)
      console.log(`   音频文件: ${result.audioFile}`)
      console.log(`   traceId: ${result.traceId}`)
    }
  } catch (err) {
    console.error(`\n❌ 语音生成失败`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
