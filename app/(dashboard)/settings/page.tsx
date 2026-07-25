import { PageHeader } from "@/components/PageHeader";
import { SettingsForm } from "./SettingsForm";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function SettingsPage() {
  const user = await requireUser();

  const userSettings = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      captchaEnabled: true,
      captchaProvider: true,
      captchaApiKey: true
    }
  });

  const history = await prisma.captchaSolveHistory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30
  });

  const initialSettings = {
    captchaEnabled: userSettings?.captchaEnabled ?? false,
    captchaProvider: userSettings?.captchaProvider ?? "mock",
    hasKey: Boolean(userSettings?.captchaApiKey)
  };

  return (
    <>
      <PageHeader
        description="Enable automated CAPTCHA bypassing, select preferred providers, and monitor solve analytics."
        title="Settings"
      />
      <div className="mt-6">
        <SettingsForm initialSettings={initialSettings} history={history} />
      </div>
    </>
  );
}
