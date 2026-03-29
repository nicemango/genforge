import { prisma } from '../src/lib/prisma';

async function main() {
  const result = await prisma.taskRun.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'FAILED', error: 'Cancelled', finishedAt: new Date() }
  });
  console.log(`Cancelled ${result.count} running pipeline(s)`);
  await prisma.$disconnect();
}

main();
