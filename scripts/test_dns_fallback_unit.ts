import { getAlternateDnsUrl, isDnsResolutionError } from "../services/dns-fallback";

console.log("=== Testing DNS Fallback Unit Logic ===\n");

const testCases = [
  { input: "https://www.sweethomemedia.com", expected: "https://sweethomemedia.com/" },
  { input: "https://sweethomemedia.com", expected: "https://www.sweethomemedia.com/" },
  { input: "https://www.sweethomemedia.com/contact-us/?ref=1", expected: "https://sweethomemedia.com/contact-us/?ref=1" },
  { input: "https://warnermiller.com/about", expected: "https://www.warnermiller.com/about" },
  { input: "http://sub.domain.co.uk", expected: "http://www.sub.domain.co.uk/" },
  { input: "https://192.168.1.1", expected: null },
  { input: "http://localhost:3000", expected: null },
  { input: "not-a-valid-url", expected: null },
];

let allPassed = true;
for (const tc of testCases) {
  const actual = getAlternateDnsUrl(tc.input);
  const pass = actual === tc.expected;
  if (!pass) allPassed = false;
  console.log(`${pass ? "✅ [PASS]" : "❌ [FAIL]"} Input: "${tc.input}" -> Actual: "${actual}" (Expected: "${tc.expected}")`);
}

console.log("\n=== Testing isDnsResolutionError ===");
const errCases = [
  { err: "net::ERR_NAME_NOT_RESOLVED at https://www.sweethomemedia.com", expected: true },
  { err: new Error("getaddrinfo ENOTFOUND www.launchpointseo.com"), expected: true },
  { err: "getaddrinfo EAI_AGAIN bluboxdigital.com", expected: true },
  { err: "Error: dns_probe_finished_nxdomain", expected: true },
  { err: "Timeout 25000ms exceeded", expected: false },
  { err: "net::ERR_CONNECTION_REFUSED", expected: false },
];

for (const ec of errCases) {
  const actual = isDnsResolutionError(ec.err);
  const pass = actual === ec.expected;
  if (!pass) allPassed = false;
  console.log(`${pass ? "✅ [PASS]" : "❌ [FAIL]"} Error: "${typeof ec.err === 'string' ? ec.err : ec.err.message}" -> Actual: ${actual} (Expected: ${ec.expected})`);
}

if (!allPassed) {
  console.error("\n❌ Some tests failed!");
  process.exit(1);
} else {
  console.log("\n✅ All DNS fallback unit tests passed cleanly!");
}
