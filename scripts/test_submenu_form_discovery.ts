import { calculateRuleScore } from '../services/discovery/deterministic-ranker';
import { extractUniversalFeatureVector } from '../services/discovery/feature-extractor';
import { scoreAndRankCandidates } from '../services/discovery/hybrid-ranker';

async function runSubmenuDiscoveryTests() {
  console.log('=== Running Submenu & Dropdown Form Discovery Tests ===\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${detail ? `- ${detail}` : ''}`);
    }
  }

  // TEST 1: Direct Contact in Submenu outranks non-contact nav items
  {
    const baseUrl = 'https://example-agency.com';
    const contactInSubmenu = extractUniversalFeatureVector({
      url: 'https://example-agency.com/contact-us',
      text: 'Contact Us',
      location: 'nav'
    }, baseUrl);

    const portfolioInNav = extractUniversalFeatureVector({
      url: 'https://example-agency.com/portfolio/case-study',
      text: 'Case Study & Architecture',
      location: 'header'
    }, baseUrl);

    const subServiceInNav = extractUniversalFeatureVector({
      url: 'https://example-agency.com/sub-service/websites/branding',
      text: 'Branding & Architecture',
      location: 'header'
    }, baseUrl);

    const contactScore = calculateRuleScore(contactInSubmenu);
    const portfolioScore = calculateRuleScore(portfolioInNav);
    const serviceScore = calculateRuleScore(subServiceInNav);

    console.log(`[Test 1] Contact score: ${contactScore}, Portfolio score: ${portfolioScore}, SubService score: ${serviceScore}`);
    assert(contactScore >= 85, 'Submenu Contact link scores >= 85');
    assert(portfolioScore < 50, 'Non-contact portfolio link is demoted below 50');
    assert(contactScore > portfolioScore && contactScore > serviceScore, 'Contact link decisively outranks portfolio & service links');
  }

  // TEST 2: Hybrid Ranker prioritizes Contact link #1 over shorter non-contact links
  {
    const baseUrl = 'https://stormbrain.com';
    const vectors = [
      extractUniversalFeatureVector({ url: 'https://stormbrain.com/sub-service/content/demo-videos/', text: 'Platform Demo Video', location: 'header' }, baseUrl),
      extractUniversalFeatureVector({ url: 'https://stormbrain.com/portfolio/brontide/', text: 'Comprehensive Brand Audit', location: 'header' }, baseUrl),
      extractUniversalFeatureVector({ url: 'https://stormbrain.com/contact-us/', text: 'Contact Us', location: 'nav' }, baseUrl),
      extractUniversalFeatureVector({ url: 'https://stormbrain.com/hire-us/', text: 'Start Your Project', location: 'nav' }, baseUrl)
    ];

    const ranked = scoreAndRankCandidates(vectors, { maxCandidates: 4 });
    console.log('[Test 2] Ranked order:');
    ranked.forEach((r, idx) => console.log(`  ${idx + 1}. "${r.candidateText}" (${r.url}) - score: ${r.finalScore}`));

    assert(ranked[0].candidateText === 'Contact Us', 'Candidate #1 is Contact Us');
    assert(ranked[1].candidateText === 'Start Your Project', 'Candidate #2 is Start Your Project');
    assert(ranked[0].finalScore > ranked[2].finalScore, 'Contact Us has significantly higher score than non-lead links');
  }

  // TEST 3: Booking link in submenu has high priority
  {
    const baseUrl = 'https://clinic.com';
    const bookingInSubmenu = extractUniversalFeatureVector({
      url: 'https://clinic.com/schedule-consultation',
      text: 'Book Free Consultation',
      location: 'nav'
    }, baseUrl);

    const bookingScore = calculateRuleScore(bookingInSubmenu);
    console.log(`[Test 3] Booking score: ${bookingScore}`);
    assert(bookingScore >= 80, 'Booking link in submenu scores >= 80');
  }

  // TEST 4: Quote link in submenu has solid priority
  {
    const baseUrl = 'https://contractor.com';
    const quoteInSubmenu = extractUniversalFeatureVector({
      url: 'https://contractor.com/request-quote',
      text: 'Request a Free Quote',
      location: 'nav'
    }, baseUrl);

    const quoteScore = calculateRuleScore(quoteInSubmenu);
    console.log(`[Test 4] Quote score: ${quoteScore}`);
    assert(quoteScore >= 70, 'Quote link in submenu scores >= 70');
  }

  console.log(`\nResults: ${passed}/${total} submenu & dropdown discovery tests passed cleanly!`);
  if (passed !== total) process.exit(1);
}

runSubmenuDiscoveryTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
