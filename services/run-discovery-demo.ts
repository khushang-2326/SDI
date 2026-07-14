import { discoverSubmissionTarget, discoverSubmissionTargets } from "@/services/submission-target-discovery";

const websiteUrl = process.argv[2] ?? "https://www.benjaminmarc.com/";

async function main() {
  const result = process.argv.includes("--all") ? await discoverSubmissionTargets({
    websiteUrl,
    timeoutMs: 9000
  }) : await discoverSubmissionTarget({
    websiteUrl,
    timeoutMs: 9000
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
