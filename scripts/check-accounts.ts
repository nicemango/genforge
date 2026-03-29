import { prisma } from "@/lib/prisma";

async function main() {
  const accounts = await prisma.account.findMany({
    select: { id: true, name: true, wechatConfig: true },
  });

  if (accounts.length === 0) {
    console.log("No accounts found in database.");
    return;
  }

  for (const a of accounts) {
    const config = JSON.parse(a.wechatConfig || "{}");
    console.log("Account:", a.id, "-", a.name);
    console.log("  WeChat appId:", config.appId || "NOT SET");
    console.log("  Has appSecret:", config.appSecret ? "YES" : "NO");
    console.log("  Has author:", config.author ? "YES (" + config.author + ")" : "NO");
    console.log("");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
