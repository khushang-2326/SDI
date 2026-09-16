import fs from 'node:fs/promises';
import { generatePerformanceReportPdf, PerformanceReportPdfData } from '../services/pdf-report-generator';

async function testPdf() {
  console.log('--- Testing 29-Target PDF Generation ---');
  const mock29Data: PerformanceReportPdfData = {
    jobId: 'cmtl_demo_29_target_job',
    batchStatus: 'completed',
    totalWebsites: 29,
    successWebsitesCount: 20,
    failedWebsitesCount: 9,
    pendingWebsitesCount: 0,
    successRate: '69.0',
    failureRate: '31.0',
    totalTrialsExecuted: 52,
    totalTrialsSuccessful: 20,
    runtime: '4m 12s',
    categoryCounts: {
      SUBMIT_CONTROL_DISCOVERY: 3,
      CAPTCHA_CHALLENGE: 1,
      BOOKING_FLOW: 3,
      NAVIGATION_TIMEOUT: 2
    },
    items: Array.from({ length: 29 }, (_, i) => ({
      index: i + 1,
      name: 'Target Site ' + (i + 1),
      url: 'https://target-site-' + (i + 1) + '.example.com/very/long/path/for/testing/wrapping/contact-us-now',
      status: i < 20 ? 'completed' : 'failed',
      isSuccess: i < 20,
      targetType: i % 4 === 0 ? 'calendly' : 'contact_form',
      trialsCount: i < 20 ? 1 : 2,
      successfulTrialsCount: i < 20 ? 1 : 0,
      filledFieldsCount: 5,
      verifiedFieldsCount: i < 20 ? 5 : 2,
      detail: i < 20 ? 'Dry run ready to book - all required fields filled and verified.' : 'No visible submit button found on page after form scan and modal checks.',
      durationSec: 8.5
    }))
  };

  const start29 = Date.now();
  const res29 = generatePerformanceReportPdf(mock29Data);
  const time29 = Date.now() - start29;
  const buffer29 = Buffer.from(await res29.blob.arrayBuffer());

  console.log('29-Target PDF Generated in', time29, 'ms');
  console.log('Filename:', res29.filename);
  console.log('Filename format check:', /^automation-performance-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.pdf$/.test(res29.filename) ? 'PASS' : 'FAIL');
  console.log('PDF Byte Size:', buffer29.length);
  await fs.mkdir('outputs', { recursive: true });
  await fs.writeFile('outputs/' + res29.filename, buffer29);
  console.log('Saved 29-target PDF to outputs/' + res29.filename);

  console.log('\n--- Testing 100-Target Synthetic Stress Test ---');
  const memBefore = process.memoryUsage().heapUsed;
  const mock100Data: PerformanceReportPdfData = {
    jobId: 'stress_test_100_targets',
    batchStatus: 'completed',
    totalWebsites: 100,
    successWebsitesCount: 75,
    failedWebsitesCount: 25,
    pendingWebsitesCount: 0,
    successRate: '75.0',
    failureRate: '25.0',
    totalTrialsExecuted: 140,
    totalTrialsSuccessful: 75,
    runtime: '14m 30s',
    categoryCounts: {
      SUBMIT_CONTROL_DISCOVERY: 10,
      CAPTCHA_CHALLENGE: 5,
      BOOKING_FLOW: 5,
      NAVIGATION_TIMEOUT: 5
    },
    items: Array.from({ length: 100 }, (_, i) => ({
      index: i + 1,
      name: 'Organization Name ' + (i + 1),
      url: 'https://organization-' + (i + 1) + '-corporate-portal.com/enterprise/solutions/contact-our-specialists-team',
      status: i < 75 ? 'completed' : 'failed',
      isSuccess: i < 75,
      targetType: i % 3 === 0 ? 'calendly' : 'contact_form',
      trialsCount: i < 75 ? 1 : 2,
      successfulTrialsCount: i < 75 ? 1 : 0,
      filledFieldsCount: 6,
      verifiedFieldsCount: i < 75 ? 6 : 3,
      detail: i < 75 ? 'Dry run ready to book - full contact workflow validated' : 'Detailed error diagnostics with extended description text to verify autoTable cell line wrapping behavior.',
      durationSec: 12.3
    }))
  };

  const start100 = Date.now();
  const res100 = generatePerformanceReportPdf(mock100Data);
  const time100 = Date.now() - start100;
  const memAfter = process.memoryUsage().heapUsed;
  const buffer100 = Buffer.from(await res100.blob.arrayBuffer());

  console.log('100-Target PDF Generated in', time100, 'ms');
  console.log('100-Target Filename:', res100.filename);
  console.log('100-Target PDF Byte Size:', buffer100.length);
  console.log('Heap memory delta:', Math.round((memAfter - memBefore) / 1024 / 1024 * 100) / 100, 'MB');
  await fs.writeFile('outputs/automation-performance-report-100-targets.pdf', buffer100);
  console.log('Saved 100-target PDF to outputs/automation-performance-report-100-targets.pdf');
}

testPdf().catch(console.error);
