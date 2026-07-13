import { discoverSubmissionTarget } from "@/services/submission-target-discovery";

const websiteUrl = process.argv[2] ?? "https://www.benjaminmarc.com/";

async function main() {
  const result = await discoverSubmissionTarget({
    websiteUrl,
    timeoutMs: 9000
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
