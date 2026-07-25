import { encrypt, decrypt } from "../lib/crypto";
import { SolverFactory } from "./captcha/solver-factory";
import { prisma } from "../lib/prisma";

async function runTests() {
  console.log("=== Starting CAPTCHA Solving Automation Smoke Tests ===");
  let failed = false;

  // 1. Test Crypto Service
  try {
    const testSecret = "my-super-secret-api-key-123456";
    const encrypted = encrypt(testSecret);
    const decrypted = decrypt(encrypted);

    if (decrypted !== testSecret) {
      throw new Error(`Decrypted string does not match: expected "${testSecret}", got "${decrypted}"`);
    }
    console.log("✓ Test 1: Crypto Encryption/Decryption passed successfully.");
  } catch (error: any) {
    console.error("✗ Test 1: Crypto Encryption/Decryption failed:", error.message);
    failed = true;
  }

  // 2. Test Solver Factory Instantiation
  try {
    const mockSolver = SolverFactory.getSolver("mock", "fake-key");
    const twoCaptchaSolver = SolverFactory.getSolver("2captcha", "fake-key");
    const capsolverSolver = SolverFactory.getSolver("capsolver", "fake-key");

    if (
      mockSolver.constructor.name !== "MockSolver" ||
      twoCaptchaSolver.constructor.name !== "TwoCaptchaSolver" ||
      capsolverSolver.constructor.name !== "CapSolverSolver"
    ) {
      throw new Error("Solver Factory did not instantiate correct class constructors.");
    }
    console.log("✓ Test 2: Solver Factory passed successfully.");
  } catch (error: any) {
    console.error("✗ Test 2: Solver Factory failed:", error.message);
    failed = true;
  }

  // 3. Test Mock Solver Automation
  try {
    const solver = SolverFactory.getSolver("mock", "simulation-mode-key");
    const validation = await solver.validateKey();
    if (!validation.success) {
      throw new Error("Mock validation failed: " + validation.message);
    }

    const reCaptchaResult = await solver.solveReCaptcha("sitekey-recaptcha", "https://example.com/test");
    if (!reCaptchaResult.token.startsWith("mock-g-recaptcha-response")) {
      throw new Error("Mock reCAPTCHA token format incorrect: " + reCaptchaResult.token);
    }

    const hCaptchaResult = await solver.solveHCaptcha("sitekey-hcaptcha", "https://example.com/test");
    if (!hCaptchaResult.token.startsWith("mock-h-captcha-response")) {
      throw new Error("Mock hCaptcha token format incorrect: " + hCaptchaResult.token);
    }

    const turnstileResult = await solver.solveTurnstile("sitekey-turnstile", "https://example.com/test");
    if (!turnstileResult.token.startsWith("mock-cf-turnstile-response")) {
      throw new Error("Mock Turnstile token format incorrect: " + turnstileResult.token);
    }

    const imageResult = await solver.solveImage("data:image/png;base64,fakebase64");
    if (imageResult.text !== "MOCK123") {
      throw new Error("Mock image OCR result incorrect: " + imageResult.text);
    }

    console.log("✓ Test 3: Mock solver bypass functions passed successfully.");
  } catch (error: any) {
    console.error("✗ Test 3: Mock solver failed:", error.message);
    failed = true;
  }

  // 4. Test Database Log Persistence
  try {
    // Find or create the demo user
    let user = await prisma.user.findFirst({
      where: { email: "demo@lead-auto-submitter.local" }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: "Demo User",
          email: "demo@lead-auto-submitter.local",
          passwordHash: "demo-mode"
        }
      });
    }

    // Write a test log
    const testLog = await prisma.captchaSolveHistory.create({
      data: {
        userId: user.id,
        provider: "mock",
        captchaType: "reCAPTCHA",
        status: "Success",
        durationMs: 1200,
        errorMessage: null
      }
    });

    // Verify record exists
    const fetchedLog = await prisma.captchaSolveHistory.findUnique({
      where: { id: testLog.id }
    });

    if (!fetchedLog || fetchedLog.durationMs !== 1200) {
      throw new Error("Database log record not found or fields mismatched.");
    }

    // Clean up
    await prisma.captchaSolveHistory.delete({
      where: { id: testLog.id }
    });

    console.log("✓ Test 4: Database history log write/read/delete passed successfully.");
  } catch (error: any) {
    console.error("✗ Test 4: Database logging failed:", error.message);
    failed = true;
  }

  console.log("======================================================");
  if (failed) {
    console.log("✗ Result: Smoke tests failed. Review logs above.");
    process.exitCode = 1;
  } else {
    console.log("✔ Result: All smoke tests completed successfully!");
  }
}

void runTests().finally(async () => {
  await prisma.$disconnect();
});
