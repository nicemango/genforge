import { prisma } from '../src/lib/prisma';
import { runFullPipeline } from '../src/pipeline';
import { getUsageStats, resetUsageStats } from '../src/lib/llm-usage';

async function main() {
  const account = await prisma.account.findFirst();
  if (!account) {
    console.error('No account found');
    process.exit(1);
  }

  console.log(`Running pipeline for account: ${account.id} (${account.name})`);
  resetUsageStats();

  try {
    const result = await runFullPipeline({
      accountId: account.id,
      topicCount: 3,
    });

    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.taskRunId) {
      const steps = await prisma.taskRun.findMany({
        where: { parentRunId: result.taskRunId },
        orderBy: { startedAt: 'asc' },
        select: {
          id: true,
          taskType: true,
          status: true,
          durationMs: true,
          startedAt: true,
          finishedAt: true,
          error: true,
        },
      });
      console.log('StepDurations:', JSON.stringify(steps, null, 2));
    }

    console.log('TokenUsage:', JSON.stringify(getUsageStats(), null, 2));
  } catch (err) {
    console.error('Pipeline error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
