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
      captchaApiKey: true,
      proxyEnabled: true,
      proxyProtocol: true,
      proxyHost: true,
      proxyPort: true,
      proxyUsername: true,
      proxyPassword: true,
      proxyBandwidthSaver: true
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

  const initialProxySettings = {
    proxyEnabled: userSettings?.proxyEnabled ?? false,
    proxyProtocol: userSettings?.proxyProtocol ?? "http",
    proxyHost: userSettings?.proxyHost ?? "",
    proxyPort: userSettings?.proxyPort ? String(userSettings.proxyPort) : "",
    proxyUsername: userSettings?.proxyUsername ?? "",
    hasPassword: Boolean(userSettings?.proxyPassword),
    proxyBandwidthSaver: userSettings?.proxyBandwidthSaver ?? true
  };

  return (
    <>
      <PageHeader
        description="Configure automated CAPTCHA bypassing, residential proxies (Proxy-Seller), and bandwidth optimization."
        title="Settings"
      />
      <div className="mt-6">
        <SettingsForm
          initialSettings={initialSettings}
          initialProxySettings={initialProxySettings}
          history={history}
        />
      </div>
    </>
  );
}
