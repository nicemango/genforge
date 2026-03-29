import { prisma } from "@/lib/prisma";

async function main() {
  const account = await prisma.account.findFirst();
  if (!account) {
    console.log("No account found");
    return;
  }

  const wechatConfig = {
    appId: "wxb24d719d002c09f9",
    appSecret: "b05ea5344c91db24c53687a022cff514",
    author: "AI自动生成",
  };

  await prisma.account.update({
    where: { id: account.id },
    data: {
      wechatConfig: JSON.stringify(wechatConfig),
    },
  });

  console.log("Updated account:", account.id, account.name);
  console.log("WeChat config:", JSON.stringify(wechatConfig, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
