import { submitContactForm } from "@/services/contact-form-automation";

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  const result = await submitContactForm({
    websiteUrl: "https://www.benjaminmarc.com/contact/",
    submit: !isDryRun,
    leadData: {
      fullName: "Demo Lead",
      email: "demo.lead@example.com",
      mobile: "5551234567",
      address: "123 Demo Street, New York, NY",
      message:
        "Hello, this is a demo inquiry submitted from an approved Playwright automation test.",
      companyName: "Demo Company"
    }
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
